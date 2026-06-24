from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from .chunking import split_text_chunks
from .similarity import cosine_similarity

EmbeddingProvider = Callable[[list[str]], list[list[float]]]


@dataclass(frozen=True)
class EmbeddingChunk:
    index: int
    text: str
    score: float


@dataclass(frozen=True)
class EmbeddingSelection:
    page_score: float
    chunks: list[EmbeddingChunk]


def select_relevant_chunks_by_embedding(
    *,
    query: str,
    text: str,
    embed: EmbeddingProvider,
    top_k: int = 3,
    chunk_chars: int = 1200,
) -> list[EmbeddingChunk]:
    return select_page_chunks_by_embedding(
        query=query,
        text=text,
        embed=embed,
        top_k=top_k,
        chunk_chars=chunk_chars,
    ).chunks


def select_page_chunks_by_embedding(
    *,
    query: str,
    text: str,
    embed: EmbeddingProvider,
    top_k: int = 3,
    chunk_chars: int = 1200,
) -> EmbeddingSelection:
    clean_query = str(query or "").strip()
    chunks = split_text_chunks(text, chunk_chars=chunk_chars)
    if not clean_query or not chunks:
        return EmbeddingSelection(page_score=0.0, chunks=[])

    vectors = embed([clean_query, *chunks])
    if len(vectors) < len(chunks) + 1:
        raise ValueError("embedding provider returned fewer vectors than requested")

    query_vector = vectors[0]
    scored = [
        EmbeddingChunk(index=index, text=chunk, score=cosine_similarity(query_vector, vectors[index + 1]))
        for index, chunk in enumerate(chunks)
    ]
    limit = max(1, int(top_k or 1))
    ranked = sorted(scored, key=lambda chunk: chunk.score, reverse=True)
    page_score = ranked[0].score if ranked else 0.0
    return EmbeddingSelection(page_score=page_score, chunks=ranked[:limit])
