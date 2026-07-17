from __future__ import annotations

import time
from typing import Any

from .embedding import MAX_PARALLEL_EMBEDDING_BATCHES, AnnaEmbeddingsClient, EmbeddingBatchOutcome, EmbeddingsError
from .errors import ValidationError
from .job_store import JobStore
from .views import compact_job_view

EMBEDDING_BATCH_SIZE = 1
EMBEDDING_MODEL = "anna-managed-v1"
EMBEDDING_TIMEOUT_SECONDS = 45.0
MAX_EMBEDDING_RETRY_ROUNDS = 1
EMBEDDING_RETRY_DELAY_SECONDS = 1.0


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
    failures: list[dict[str, Any]] = []
    job = None
    for round_index in range(MAX_EMBEDDING_RETRY_ROUNDS + 1):
        pending = _pending_chunks(chunks)
        if not pending:
            break
        if round_index:
            time.sleep(EMBEDDING_RETRY_DELAY_SECONDS)
        failures = _process_pending_round(
            jobs=jobs,
            embeddings=embeddings,
            research_id=research_id,
            context=context,
            chunks=chunks,
            pending=pending,
            round_number=round_index + 1,
        )
        job = jobs.load(research_id)

    if job is None:
        _set_embedding_state(context, chunks)
        job = jobs.update_metadata(research_id, {"attachment_context": context})

    remaining = _pending_chunks(chunks)
    if remaining:
        raise EmbeddingsError(
            -32507,
            f"{len(failures)} embedding batch(es) still failed after automatic retry; successful batches were checkpointed",
            data={
                "failed_batches": failures,
                "retry_rounds": MAX_EMBEDDING_RETRY_ROUNDS,
                "embedded_chunk_count": sum(1 for chunk in chunks if isinstance(chunk, dict) and chunk.get("embedding")),
                "pending_chunk_count": len(remaining),
            },
        )

    view = compact_job_view(job)
    view["attachment_context_summary"] = {
        "chunk_count": len(chunks),
        "embedded_chunk_count": sum(1 for chunk in chunks if isinstance(chunk, dict) and chunk.get("embedding")),
        "embedding_model": EMBEDDING_MODEL,
        "embedding_batch_size": EMBEDDING_BATCH_SIZE,
        "embedding_status": "ready",
    }
    return {"job": view}


def _process_pending_round(
    *,
    jobs: JobStore,
    embeddings: AnnaEmbeddingsClient,
    research_id: str,
    context: dict[str, Any],
    chunks: list[Any],
    pending: list[dict[str, Any]],
    round_number: int,
) -> list[dict[str, Any]]:
    batches = [pending[start : start + EMBEDDING_BATCH_SIZE] for start in range(0, len(pending), EMBEDDING_BATCH_SIZE)]
    failures: list[dict[str, Any]] = []
    for wave_start in range(0, len(batches), MAX_PARALLEL_EMBEDDING_BATCHES):
        wave = batches[wave_start : wave_start + MAX_PARALLEL_EMBEDDING_BATCHES]
        outcomes = embeddings.create_batches_settled(
            batches=[[str(chunk.get("text") or "") for chunk in batch] for batch in wave],
            model=EMBEDDING_MODEL,
            timeout=EMBEDDING_TIMEOUT_SECONDS,
        )
        for wave_index, (batch, outcome) in enumerate(zip(wave, outcomes, strict=True)):
            batch_number = wave_start + wave_index + 1
            failure = _apply_batch_outcome(batch, outcome, batch_number=batch_number)
            if failure:
                failures.append({"round": round_number, **failure})
        _set_embedding_state(context, chunks)
        jobs.update_metadata(research_id, {"attachment_context": context})
    return failures


def _pending_chunks(chunks: list[Any]) -> list[dict[str, Any]]:
    return [chunk for chunk in chunks if isinstance(chunk, dict) and str(chunk.get("text") or "").strip() and not chunk.get("embedding")]


def _apply_batch_outcome(batch: list[dict[str, Any]], outcome: EmbeddingBatchOutcome, *, batch_number: int) -> dict[str, Any] | None:
    if outcome.error is not None:
        return {"batch": batch_number, "error": str(outcome.error)}
    result = outcome.result or {}
    vectors = _extract_vectors(result)
    if len(vectors) != len(batch):
        return {
            "batch": batch_number,
            "error": "Anna embedding returned an unexpected vector count",
            "requested": len(batch),
            "returned": len(vectors),
        }
    dimensions = _dimensions(result, vectors)
    for index, chunk in enumerate(batch):
        vector = vectors[index]
        chunk["embedding"] = vector
        chunk["embedding_model"] = EMBEDDING_MODEL
        chunk["embedding_dimensions"] = dimensions or len(vector)
    return None


def _set_embedding_state(context: dict[str, Any], chunks: list[Any]) -> None:
    pending_count = sum(1 for chunk in chunks if isinstance(chunk, dict) and str(chunk.get("text") or "").strip() and not chunk.get("embedding"))
    context["embedding_model"] = EMBEDDING_MODEL
    context["embedding_batch_size"] = EMBEDDING_BATCH_SIZE
    context["embedding_status"] = "partial" if pending_count else "ready"


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
