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
    if not chunks:
        raise ValidationError("attachment_context does not contain usable chunks")

    clean_query = str(query or job.get("query") or "").strip()
    if not clean_query:
        raise ValidationError("query is required")
    selected = select_top_attachment_chunks(chunks, query=clean_query, embeddings=embeddings, top_k=top_k)
    if not selected:
        raise ValidationError("no attachment chunks could be selected")

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
    context = _apply_ai_summary(context, parsed=parsed, selected=selected, query=clean_query, top_k=len(selected))
    job = jobs.update_metadata(research_id, {"attachment_context": context})
    view = compact_job_view(job)
    view["attachment_context_summary"] = {
        "chunk_count": len(context.get("chunks") or []),
        "selected_chunk_count": len(selected),
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
    chunks = [chunk for chunk in (context.get("chunks") or []) if isinstance(chunk, dict) and str(chunk.get("text") or "").strip()]
    if not chunks:
        return {"selected_context": "", "selected_chunks": [], "selected_chunk_count": 0}

    clean_query = str(query or job.get("query") or "").strip()
    if not clean_query:
        raise ValidationError("query is required")
    selected = select_top_attachment_chunks(chunks, query=clean_query, embeddings=embeddings, top_k=top_k)
    return {
        "selected_context": _selected_context_text(selected),
        "selected_chunks": [
            {
                "chunk_id": chunk.get("chunk_id"),
                "file_id": chunk.get("file_id"),
                "file_name": chunk.get("file_name"),
                "index": chunk.get("index"),
                "score": chunk.get("score"),
                "quote": _quote_for_citation(str(chunk.get("text") or "")),
            }
            for chunk in selected
        ],
        "selected_chunk_count": len(selected),
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


def _selected_context_text(chunks: list[dict[str, Any]]) -> str:
    if not chunks:
        return ""
    parts = []
    for group in _group_chunks_by_file(chunks):
        parts.append(f"File: {group.get('file_name')} ({group.get('file_id')})")
        for chunk in group.get("chunks") or []:
            parts.append(f"[{chunk.get('chunk_id')}, score={chunk.get('score')}]\n{chunk.get('text')}")
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
            '"files":[{"file_id":"file-1","summary":"...","key_points":["..."],"relevance":"..."}]}.'
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


def _apply_ai_summary(
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
            file["ai_summary"] = str(summary.get("summary") or "").strip()
            file["ai_key_points"] = [str(point).strip() for point in (summary.get("key_points") or []) if str(point or "").strip()]
            file["ai_relevance"] = str(summary.get("relevance") or "").strip()
        file["summary_selected_chunk_ids"] = selected_by_file.get(file_id, [])

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
        if isinstance(file, dict) and file.get("ai_summary"):
            parts.append(f"{file.get('name')}: {file.get('ai_summary')}")
    return "\n".join(parts)
