from __future__ import annotations

from typing import Any

from .embedding import AnnaEmbeddingsClient
from .errors import ValidationError
from .job_store import JobStore
from .views import compact_job_view

EMBEDDING_BATCH_SIZE = 2
EMBEDDING_MODEL = "anna-managed-v1"
EMBEDDING_TIMEOUT_SECONDS = 45.0


def embed_attachment_chunks(
    *,
    jobs: JobStore,
    embeddings: AnnaEmbeddingsClient,
    research_id: str,
) -> dict[str, Any]:
    job = jobs.load(research_id)
    context = job.get("attachment_context")
    if not isinstance(context, dict):
        raise ValidationError("attachment_context is not prepared")
    chunks = context.get("chunks")
    if not isinstance(chunks, list):
        raise ValidationError("attachment_context.chunks must be an array")
    pending = [chunk for chunk in chunks if isinstance(chunk, dict) and str(chunk.get("text") or "").strip() and not chunk.get("embedding")]
    for start in range(0, len(pending), EMBEDDING_BATCH_SIZE):
        batch = pending[start : start + EMBEDDING_BATCH_SIZE]
        texts = [str(chunk.get("text") or "") for chunk in batch]
        result = embeddings.create(texts=texts, model=EMBEDDING_MODEL, timeout=EMBEDDING_TIMEOUT_SECONDS)
        vectors = _extract_vectors(result)
        if len(vectors) < len(batch):
            raise ValidationError(
                "Anna embedding returned fewer vectors than requested",
                data={"requested": len(batch), "returned": len(vectors)},
            )
        dimensions = _dimensions(result, vectors)
        for index, chunk in enumerate(batch):
            vector = vectors[index]
            chunk["embedding"] = vector
            chunk["embedding_model"] = EMBEDDING_MODEL
            chunk["embedding_dimensions"] = dimensions or len(vector)

    context["embedding_model"] = EMBEDDING_MODEL
    context["embedding_batch_size"] = EMBEDDING_BATCH_SIZE
    context["embedding_status"] = "ready"
    job = jobs.update_metadata(research_id, {"attachment_context": context})
    view = compact_job_view(job)
    view["attachment_context_summary"] = {
        "chunk_count": len(chunks),
        "embedded_chunk_count": sum(1 for chunk in chunks if isinstance(chunk, dict) and chunk.get("embedding")),
        "embedding_model": EMBEDDING_MODEL,
        "embedding_batch_size": EMBEDDING_BATCH_SIZE,
        "embedding_status": "ready",
    }
    return {"job": view}


def _extract_vectors(result: dict[str, Any]) -> list[list[Any]]:
    vectors: list[list[Any]] = []
    for item in result.get("data") or []:
        if isinstance(item, dict) and isinstance(item.get("embedding"), list):
            vectors.append(item["embedding"])
    return vectors


def _dimensions(result: dict[str, Any], vectors: list[list[Any]]) -> int:
    meta = result.get("_meta") if isinstance(result.get("_meta"), dict) else {}
    try:
        return int(meta.get("dimensions") or 0)
    except (TypeError, ValueError):
        return len(vectors[0]) if vectors else 0
