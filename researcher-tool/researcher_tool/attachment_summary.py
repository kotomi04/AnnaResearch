from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import re
from typing import Any

from .attachment_embeddings import EMBEDDING_MODEL
from .embedding import AnnaEmbeddingsClient
from .errors import ValidationError
from .job_store import JobStore
from .sampling import AnnaSamplingClient, sampling_text
from .views import compact_job_view

DEFAULT_TOP_K = 8
MAX_TOP_K = 16
MAX_CHUNK_CHARS = 1800
SUMMARY_TIMEOUT_SECONDS = 75.0
ATTACHMENT_EVIDENCE_POLICY = (
    "Use this analysis as supporting evidence only when the claim is directly grounded in visible content. "
    "Do not use it to verify external facts, dates, source credibility, or causal explanations unless those "
    "are explicitly visible in the attachment content."
)


def summarize_attachment_context(
    *,
    jobs: JobStore,
    embeddings: AnnaEmbeddingsClient,
    sampling: AnnaSamplingClient,
    research_id: str,
    query: str = "",
    top_k: int = DEFAULT_TOP_K,
    invoke_id: str = "",
) -> dict[str, Any]:
    job = jobs.load(research_id)
    context = job.get("attachment_context")
    if not isinstance(context, dict):
        raise ValidationError("attachment_context is not prepared")
    chunks = [chunk for chunk in (context.get("chunks") or []) if isinstance(chunk, dict) and str(chunk.get("text") or "").strip()]
    image_files = _relevant_image_files(context)

    clean_query = str(query or job.get("query") or "").strip()
    if not clean_query:
        raise ValidationError("query is required")
    selected = select_top_attachment_chunks(chunks, query=clean_query, embeddings=embeddings, top_k=top_k) if chunks else []
    if not selected and not image_files:
        context["summary"] = ""
        context["summary_status"] = "ready"
        context["summary_mode"] = "no_relevant_attachment_context"
        context["summary_query"] = clean_query
        context["summary_top_k"] = 0
        context["summary_generated_at"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        job = jobs.update_metadata(research_id, {"attachment_context": context})
        view = compact_job_view(job)
        view["attachment_context_summary"] = {
            "chunk_count": len(context.get("chunks") or []),
            "selected_item_count": 0,
            "file_count": len(context.get("files") or []),
            "summary_chars": 0,
            "summary_status": "ready",
            "summary_query": clean_query,
        }
        return {"job": view}

    if selected:
        messages = [
            {
                "role": "user",
                "content": {
                    "type": "text",
                    "text": _summary_prompt(query=clean_query, grouped_chunks=_group_chunks_by_file(selected)),
                },
            }
        ]
        result = sampling.create_message(
            messages=messages,
            system_prompt=(
                "你是研究附件分析助手。基于给定 query 和附件片段，为每个文件写与研究任务相关的摘要。"
                "不要编造未出现在片段中的事实。只返回严格 JSON。"
            ),
            max_tokens=1200,
            temperature=0.2,
            metadata={"executa_invoke_id": invoke_id, "tool": "app_summarize_attachments", "research_id": research_id},
            timeout=SUMMARY_TIMEOUT_SECONDS,
        )
        parsed = _parse_summary_json(sampling_text(result))
    else:
        parsed = {"summary": _fallback_global_summary(image_files), "files": []}
    context = _apply_attachment_analysis(context, parsed=parsed, selected=selected, query=clean_query, top_k=len(selected))
    job = jobs.update_metadata(research_id, {"attachment_context": context})
    view = compact_job_view(job)
    view["attachment_context_summary"] = {
        "chunk_count": len(context.get("chunks") or []),
        "selected_item_count": len(selected) + len(image_files),
        "file_count": len(context.get("files") or []),
        "summary_chars": len(str(context.get("summary") or "")),
        "summary_status": context.get("summary_status") or "ready",
        "summary_query": clean_query,
    }
    return {"job": view}


def select_attachment_context(
    *,
    jobs: JobStore,
    embeddings: AnnaEmbeddingsClient,
    research_id: str,
    query: str = "",
    top_k: int = DEFAULT_TOP_K,
) -> dict[str, Any]:
    job = jobs.load(research_id)
    context = job.get("attachment_context")
    if not isinstance(context, dict):
        raise ValidationError("attachment_context is not prepared")
    relevant_file_ids = _relevant_file_ids(context)
    image_files = _relevant_image_files(context)
    chunks = [
        chunk
        for chunk in (context.get("chunks") or [])
        if isinstance(chunk, dict)
        and str(chunk.get("text") or "").strip()
        and str(chunk.get("file_id") or "") in relevant_file_ids
    ]
    if not chunks and not image_files:
        return {"selected_context": "", "selected_items": [], "selected_item_count": 0}

    clean_query = str(query or job.get("query") or "").strip()
    if not clean_query:
        raise ValidationError("query is required")
    selected = select_top_attachment_chunks(chunks, query=clean_query, embeddings=embeddings, top_k=top_k) if chunks else []
    selected_images = _selected_image_summaries(image_files)
    return {
        "selected_context": _selected_context_text(selected, selected_images),
        "selected_items": [
            {
                "kind": "chunk",
                "item_id": chunk.get("chunk_id"),
                "file_id": chunk.get("file_id"),
                "file_name": chunk.get("file_name"),
                "path": chunk.get("path"),
                "content_type": chunk.get("content_type"),
                "index": chunk.get("index"),
                "score": chunk.get("score"),
                "quote": _quote_for_citation(str(chunk.get("text") or "")),
            }
            for chunk in selected
        ]
        + [
            {
                "kind": "image_analysis",
                "item_id": image.get("item_id"),
                "file_id": image.get("file_id"),
                "file_name": image.get("file_name"),
                "path": image.get("path"),
                "content_type": image.get("content_type"),
                "index": 0,
                "score": image.get("score"),
                "quote": "",
            }
            for image in selected_images
        ],
        "selected_item_count": len(selected) + len(selected_images),
    }


def select_top_attachment_chunks(
    chunks: list[dict[str, Any]],
    *,
    query: str,
    embeddings: AnnaEmbeddingsClient,
    top_k: int = DEFAULT_TOP_K,
) -> list[dict[str, Any]]:
    limit = max(1, min(int(top_k or DEFAULT_TOP_K), MAX_TOP_K))
    query_vector = _query_embedding(query, embeddings=embeddings)
    scored: list[tuple[float, dict[str, Any]]] = []
    for chunk in chunks:
        score = _cosine_similarity(query_vector, chunk.get("embedding"))
        if score <= 0:
            score = _lexical_score(query, str(chunk.get("text") or ""))
        if score <= 0:
            continue
        scored.append((score, chunk))
    scored.sort(key=lambda item: item[0], reverse=True)

    selected: list[dict[str, Any]] = []
    for score, chunk in scored[:limit]:
        view = {
            "chunk_id": chunk.get("chunk_id"),
            "file_id": chunk.get("file_id"),
            "file_name": chunk.get("file_name"),
            "index": chunk.get("index"),
            "score": round(float(score), 6),
            "text": str(chunk.get("text") or "")[:MAX_CHUNK_CHARS],
        }
        selected.append(view)
    return selected


def _selected_context_text(chunks: list[dict[str, Any]], images: list[dict[str, Any]] | None = None) -> str:
    images = images or []
    if not chunks and not images:
        return ""
    parts = [f"Uploaded-file evidence policy: {ATTACHMENT_EVIDENCE_POLICY}"]
    for group in _group_chunks_by_file(chunks):
        parts.append(f"File: {group.get('file_name')}")
        for chunk in group.get("chunks") or []:
            parts.append(f"[Uploaded file excerpt, score={chunk.get('score')}]\n{chunk.get('text')}")
    for image in images:
        parts.append(f"Image file: {image.get('file_name')}")
        parts.append(f"[Image analysis, score={image.get('score')}]\n{image.get('text')}")
    return "\n\n".join(parts)


def _quote_for_citation(text: str) -> str:
    clean = re.sub(r"\s+", " ", str(text or "")).strip()
    return clean[:500]


def _query_embedding(query: str, *, embeddings: AnnaEmbeddingsClient) -> list[float]:
    result = embeddings.create(texts=[query], model=EMBEDDING_MODEL, timeout=30.0)
    for item in result.get("data") or []:
        if isinstance(item, dict) and isinstance(item.get("embedding"), list):
            return [float(value) for value in item["embedding"] if isinstance(value, int | float)]
    return []


def _cosine_similarity(query_vector: list[float], chunk_vector: Any) -> float:
    if not query_vector or not isinstance(chunk_vector, list) or len(query_vector) != len(chunk_vector):
        return 0.0
    vector = [float(value) for value in chunk_vector if isinstance(value, int | float)]
    if len(vector) != len(query_vector):
        return 0.0
    dot = sum(a * b for a, b in zip(query_vector, vector, strict=True))
    q_norm = math.sqrt(sum(value * value for value in query_vector))
    c_norm = math.sqrt(sum(value * value for value in vector))
    if not q_norm or not c_norm:
        return 0.0
    return dot / (q_norm * c_norm)


def _lexical_score(query: str, text: str) -> float:
    terms = {term for term in re.findall(r"[\w\u4e00-\u9fff]+", query.lower()) if len(term) > 1}
    if not terms:
        return 0.0
    haystack = text.lower()
    hits = sum(1 for term in terms if term in haystack)
    return hits / len(terms)


def _group_chunks_by_file(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for chunk in chunks:
        file_id = str(chunk.get("file_id") or "file-unknown")
        group = grouped.setdefault(file_id, {"file_id": file_id, "file_name": chunk.get("file_name") or file_id, "chunks": []})
        group["chunks"].append(chunk)
    return list(grouped.values())


def _summary_prompt(*, query: str, grouped_chunks: list[dict[str, Any]]) -> str:
    parts = [
        f"Research query:\n{query}",
        (
            'Return strict JSON only, in this shape: {"summary":"overall attachment summary",'
            '"files":[{"file_id":"file-1","summary":"...","key_points":["..."],'
            '"relevance":"how this file relates to the research task",'
            '"relevance_score":"number from 0 to 1"}]}. '
            "Set relevance_score from 0 to 1, where 0 means unrelated and 1 means directly useful for the research query. "
            "Use this relevance_score rubric: "
            "0.0-0.2 = unrelated, do not use for planning or writing; "
            "0.21-0.5 = weak background relevance; "
            "0.51-0.75 = relevant supporting context; "
            "0.76-1.0 = directly relevant evidence for planning or writing."
        ),
        "Attachment chunks grouped by file:",
    ]
    for group in grouped_chunks:
        parts.append(f"\nFile {group['file_id']} - {group.get('file_name')}:")
        for chunk in group.get("chunks") or []:
            parts.append(f"[{chunk.get('chunk_id')}, score={chunk.get('score')}]\n{chunk.get('text')}")
    return "\n\n".join(parts)


def _parse_summary_json(text: str) -> dict[str, Any]:
    raw = str(text or "").strip()
    if not raw:
        raise ValidationError("attachment summary LLM returned empty text")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, flags=re.S)
        if not match:
            raise ValidationError("attachment summary LLM did not return JSON")
        parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValidationError("attachment summary JSON must be an object")
    return parsed


def _apply_attachment_analysis(
    context: dict[str, Any],
    *,
    parsed: dict[str, Any],
    selected: list[dict[str, Any]],
    query: str,
    top_k: int,
) -> dict[str, Any]:
    selected_by_file: dict[str, list[str]] = {}
    for chunk in selected:
        file_id = str(chunk.get("file_id") or "")
        if file_id:
            selected_by_file.setdefault(file_id, []).append(str(chunk.get("chunk_id") or ""))

    summaries_by_file: dict[str, dict[str, Any]] = {}
    for item in parsed.get("files") or []:
        if isinstance(item, dict):
            file_id = str(item.get("file_id") or "").strip()
            if file_id:
                summaries_by_file[file_id] = item

    for file in context.get("files") or []:
        if not isinstance(file, dict):
            continue
        file_id = str(file.get("id") or "")
        summary = summaries_by_file.get(file_id) or {}
        if summary:
            file["analysis"] = {
                "type": "text",
                "source": "summary_llm",
                "summary": str(summary.get("summary") or "").strip(),
                "key_points": [str(point).strip() for point in (summary.get("key_points") or []) if str(point or "").strip()],
                "relevance": str(summary.get("relevance") or "").strip(),
                "relevance_score": _optional_float(summary.get("relevance_score")),
                "selected_chunk_ids": selected_by_file.get(file_id, []),
                "payload": {},
            }
        elif file.get("analysis"):
            analysis = file.get("analysis")
            if isinstance(analysis, dict):
                analysis["selected_chunk_ids"] = selected_by_file.get(file_id, analysis.get("selected_chunk_ids") or [])

    context["summary"] = str(parsed.get("summary") or "").strip() or _fallback_global_summary(context.get("files") or [])
    context["summary_status"] = "ready"
    context["summary_mode"] = "ai_topk_by_file"
    context["summary_query"] = query
    context["summary_top_k"] = top_k
    context["summary_generated_at"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return context


def _fallback_global_summary(files: list[Any]) -> str:
    parts = []
    for file in files:
        analysis = file.get("analysis") if isinstance(file, dict) else None
        if isinstance(analysis, dict) and analysis.get("summary"):
            parts.append(f"{file.get('name')}: {analysis.get('summary')}")
    return "\n".join(parts)


def _relevant_file_ids(context: dict[str, Any]) -> set[str]:
    files = [file for file in (context.get("files") or []) if isinstance(file, dict) and file.get("status") == "ready"]
    if not files:
        return set()
    relevant = {str(file.get("id") or "") for file in files if _attachment_file_is_relevant(file) and _analysis_type(file) != "image"}
    return {file_id for file_id in relevant if file_id}


def _relevant_image_files(context: dict[str, Any]) -> list[dict[str, Any]]:
    files = [file for file in (context.get("files") or []) if isinstance(file, dict) and file.get("status") == "ready"]
    return [
        file
        for file in files
        if _analysis_type(file) == "image"
        and _attachment_file_is_relevant(file)
        and isinstance(_analysis_payload(file), dict)
        and str(_analysis_summary(file)).strip()
    ]


def _selected_image_summaries(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected = []
    for file in files:
        file_id = str(file.get("id") or "file-unknown")
        text = _image_summary_text(file)
        if not text:
            continue
        selected.append(
            {
                "item_id": f"{file_id}:image-summary",
                "file_id": file_id,
                "file_name": file.get("name") or file_id,
                "path": file.get("path"),
                "content_type": file.get("content_type"),
                "score": _analysis_relevance_score(file) or 0.0,
                "text": text,
            }
        )
    selected.sort(key=lambda item: float(item.get("score") or 0.0), reverse=True)
    return selected


def _image_summary_text(file: dict[str, Any]) -> str:
    parts = [f"Image analysis JSON for {file.get('name') or file.get('id') or 'image'}:"]
    payload = _analysis_payload(file)
    if isinstance(payload, dict):
        parts.append(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        summary = _analysis_summary(file)
        if summary:
            parts.append(summary)
    relevance = _analysis_relevance(file)
    if relevance:
        parts.extend(["Research relevance:", relevance])
    return "\n".join(parts).strip()


def _attachment_file_is_relevant(file: dict[str, Any]) -> bool:
    score = _analysis_relevance_score(file)
    if score is not None:
        return score >= 0.25
    return False


def _analysis(file: dict[str, Any]) -> dict[str, Any]:
    value = file.get("analysis")
    return value if isinstance(value, dict) else {}


def _analysis_type(file: dict[str, Any]) -> str:
    return str(_analysis(file).get("type") or "").strip()


def _analysis_summary(file: dict[str, Any]) -> str:
    return str(_analysis(file).get("summary") or "").strip()


def _analysis_relevance(file: dict[str, Any]) -> str:
    return str(_analysis(file).get("relevance") or "").strip()


def _analysis_relevance_score(file: dict[str, Any]) -> float | None:
    return _optional_float(_analysis(file).get("relevance_score"))


def _analysis_payload(file: dict[str, Any]) -> Any:
    return _analysis(file).get("payload")


def _optional_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return max(0.0, min(1.0, number))
