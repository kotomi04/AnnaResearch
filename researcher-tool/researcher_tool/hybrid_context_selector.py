from __future__ import annotations

import heapq
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from .context_selector import build_selected_context, domain_of
from .embedding import MAX_PARALLEL_EMBEDDING_BATCHES, AnnaEmbeddingsClient, EmbeddingsError
from .lexical_ranking import BM25Okapi, tokenize
from .sources.extraction.utils import same_url_without_fragment
from .web_documents import WebDocumentStore

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 100
RANK_TOP_K = 20
RRF_K = 20
MAX_SELECTED_CHUNKS = 12
MAX_CHUNKS_PER_URL = 4
EMBEDDING_BATCH_SIZE = 2
EMBEDDING_MODEL = "anna-managed-v1"
EMBEDDING_TIMEOUT_SECONDS = 45.0


@dataclass
class EvidenceChunk:
    chunk_id: str
    document_id: str
    chunk_index: int
    start: int
    end: int
    text: str
    url: str
    title: str
    query: str
    source_id: str
    source_name: str
    icon: str
    content_type: str
    source_order: int
    document_text: str
    bm25_ranks: dict[str, int] = field(default_factory=dict)
    embedding_ranks: dict[str, int] = field(default_factory=dict)
    rrf_score: float = 0.0
    best_rank: int = 10**9


class HybridContextSelector:
    """Selects web evidence with per-query BM25 and embedding RRF."""

    def __init__(self, *, embeddings: AnnaEmbeddingsClient, documents: WebDocumentStore):
        self.embeddings = embeddings
        self.documents = documents

    def select(
        self,
        *,
        query: str,
        search_queries: list[str],
        search_results: list[dict[str, Any]],
        research_id: str = "",
    ) -> dict[str, Any]:
        queries = _unique_texts(search_queries) or _unique_texts([query])
        chunks = self._build_chunks(research_id, search_results)
        if not chunks or not queries:
            return {"selected_sources": [], "source_urls": [], "selected_context": ""}

        rankings: list[tuple[str, str, list[EvidenceChunk]]] = []
        tokenized = [tokenize(chunk.title + "\n" + chunk.text) for chunk in chunks]
        bm25 = BM25Okapi(tokenized)
        for sub_query in queries:
            scores = bm25.get_scores(tokenize(sub_query))
            ranked = [
                chunks[index]
                for index in sorted(range(len(chunks)), key=lambda index: (-scores[index], chunks[index].source_order, chunks[index].chunk_index))
                if scores[index] > 0
            ][:RANK_TOP_K]
            rankings.append(("bm25", sub_query, ranked))

        embedding_rankings = self._embedding_rankings(queries, chunks)
        rankings.extend(("embedding", sub_query, ranked) for sub_query, ranked in zip(queries, embedding_rankings, strict=True))

        for rank_type, sub_query, ranked in rankings:
            for rank, chunk in enumerate(ranked, 1):
                chunk.rrf_score += 1.0 / (RRF_K + rank)
                chunk.best_rank = min(chunk.best_rank, rank)
                target = chunk.bm25_ranks if rank_type == "bm25" else chunk.embedding_ranks
                target[sub_query] = rank

        candidates = [chunk for chunk in chunks if chunk.rrf_score > 0]
        candidates.sort(key=lambda chunk: (-chunk.rrf_score, chunk.best_rank, chunk.source_order, chunk.chunk_index, chunk.chunk_id))
        selected_chunks: list[EvidenceChunk] = []
        per_url: dict[str, int] = defaultdict(int)
        for chunk in candidates:
            source_key = same_url_without_fragment(chunk.url) or chunk.document_id
            if per_url[source_key] >= MAX_CHUNKS_PER_URL:
                continue
            selected_chunks.append(chunk)
            per_url[source_key] += 1
            if len(selected_chunks) >= MAX_SELECTED_CHUNKS:
                break

        selected_sources = _group_selected_chunks(selected_chunks)
        return {
            "selected_sources": selected_sources,
            "source_urls": [source["url"] for source in selected_sources if source.get("url")],
            "selected_context": build_selected_context(selected_sources),
        }

    def _build_chunks(self, research_id: str, results: list[dict[str, Any]]) -> list[EvidenceChunk]:
        documents: dict[str, dict[str, Any]] = {}
        for source_order, result in enumerate(results):
            if str(result.get("extraction_status") or "").lower() == "failed":
                continue
            url = str(result.get("url") or result.get("href") or "").strip()
            document_id = str(result.get("document_id") or "").strip()
            stored = self.documents.get(research_id, document_id) if research_id and document_id else None
            legacy_body = str(result.get("url_body") or result.get("body") or result.get("raw_content") or "").strip()
            summary = str(result.get("content") or result.get("summary") or "").strip()
            body = str((stored or {}).get("content") or legacy_body).strip()
            content = body or summary
            if not content:
                continue
            normalized_url = same_url_without_fragment(str((stored or {}).get("url") or url))
            identity = f"url:{normalized_url}" if normalized_url else document_id or f"source:{result.get('source_id')}:{result.get('title')}"
            existing = documents.get(identity)
            candidate = {
                "document_id": document_id or identity,
                "url": str((stored or {}).get("url") or url),
                "title": str((stored or {}).get("title") or result.get("title") or domain_of(url) or url or "(无标题)"),
                "content": content,
                "query": str(result.get("query") or ""),
                "source_id": str(result.get("source_id") or ""),
                "source_name": str(result.get("source_name") or result.get("source_id") or ""),
                "icon": str((stored or {}).get("icon") or result.get("icon") or ""),
                "content_type": str((stored or {}).get("content_type") or result.get("content_type") or "summary"),
                "source_order": source_order,
                "is_full_document": bool(body),
            }
            if existing is None or (candidate["is_full_document"] and not existing["is_full_document"]):
                documents[identity] = candidate

        chunks: list[EvidenceChunk] = []
        for document in sorted(documents.values(), key=lambda value: value["source_order"]):
            text = document["content"]
            ranges = split_text_ranges(text) if document["is_full_document"] else [(0, len(text))]
            for chunk_index, (start, end) in enumerate(ranges, 1):
                chunks.append(
                    EvidenceChunk(
                        chunk_id=f"{document['document_id']}:{chunk_index}",
                        document_id=document["document_id"],
                        chunk_index=chunk_index,
                        start=start,
                        end=end,
                        text=text[start:end],
                        url=document["url"],
                        title=document["title"],
                        query=document["query"],
                        source_id=document["source_id"],
                        source_name=document["source_name"],
                        icon=document["icon"],
                        content_type=document["content_type"],
                        source_order=document["source_order"],
                        document_text=text,
                    )
                )
        return chunks

    def _embedding_rankings(self, queries: list[str], chunks: list[EvidenceChunk]) -> list[list[EvidenceChunk]]:
        query_vectors = _embed_texts(self.embeddings, queries)
        query_norms = [_vector_norm(vector) for vector in query_vectors]
        heaps: list[list[tuple[float, int, int, str]]] = [[] for _query in queries]
        chunk_by_id = {chunk.chunk_id: chunk for chunk in chunks}
        wave_size = MAX_PARALLEL_EMBEDDING_BATCHES * EMBEDDING_BATCH_SIZE
        for wave_start in range(0, len(chunks), wave_size):
            wave = chunks[wave_start : wave_start + wave_size]
            vectors = _embed_texts(self.embeddings, [chunk.title + "\n" + chunk.text for chunk in wave])
            expected_dimensions = len(query_vectors[0]) if query_vectors else 0
            for chunk, vector in zip(wave, vectors, strict=True):
                if len(vector) != expected_dimensions:
                    raise EmbeddingsError(-32508, "embedding dimensions do not match")
                vector_norm = _vector_norm(vector)
                for query_index, query_vector in enumerate(query_vectors):
                    similarity = _cosine(query_vector, query_norms[query_index], vector, vector_norm)
                    entry = (similarity, -chunk.source_order, -chunk.chunk_index, chunk.chunk_id)
                    heap = heaps[query_index]
                    if len(heap) < RANK_TOP_K:
                        heapq.heappush(heap, entry)
                    elif entry > heap[0]:
                        heapq.heapreplace(heap, entry)
            del vectors

        rankings: list[list[EvidenceChunk]] = []
        for heap in heaps:
            ordered = sorted(heap, key=lambda entry: (-entry[0], -entry[1], -entry[2], entry[3]))
            rankings.append([chunk_by_id[entry[3]] for entry in ordered])
        return rankings


def split_text_ranges(text: str, *, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[tuple[int, int]]:
    value = str(text or "")
    if not value:
        return []
    if len(value) <= chunk_size:
        return [(0, len(value))]
    ranges: list[tuple[int, int]] = []
    start = 0
    minimum_boundary = max(1, int(chunk_size * 0.6))
    separators = ("\n\n", "\n", "。", ". ", "；", "; ", "，", ", ", " ")
    while start < len(value):
        hard_end = min(len(value), start + chunk_size)
        end = hard_end
        if hard_end < len(value):
            window = value[start + minimum_boundary : hard_end]
            for separator in separators:
                boundary = window.rfind(separator)
                if boundary >= 0:
                    end = start + minimum_boundary + boundary + len(separator)
                    break
        if end <= start:
            end = hard_end
        ranges.append((start, end))
        if end >= len(value):
            break
        start = max(start + 1, end - overlap)
    return ranges


def _embed_texts(client: AnnaEmbeddingsClient, texts: list[str]) -> list[list[float]]:
    batches = [texts[index : index + EMBEDDING_BATCH_SIZE] for index in range(0, len(texts), EMBEDDING_BATCH_SIZE)]
    results = client.create_batches(batches=batches, model=EMBEDDING_MODEL, timeout=EMBEDDING_TIMEOUT_SECONDS)
    vectors: list[list[float]] = []
    for batch, result in zip(batches, results, strict=True):
        batch_vectors = [item.get("embedding") for item in result.get("data") or [] if isinstance(item, dict) and isinstance(item.get("embedding"), list)]
        if len(batch_vectors) != len(batch):
            raise EmbeddingsError(-32507, "Anna embedding returned an unexpected vector count")
        vectors.extend([[float(value) for value in vector] for vector in batch_vectors])
    if vectors and (not vectors[0] or any(len(vector) != len(vectors[0]) for vector in vectors)):
        raise EmbeddingsError(-32508, "embedding dimensions do not match")
    return vectors


def _vector_norm(vector: list[float]) -> float:
    return math.sqrt(sum(value * value for value in vector))


def _cosine(left: list[float], left_norm: float, right: list[float], right_norm: float) -> float:
    if not left_norm or not right_norm:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True)) / (left_norm * right_norm)


def _group_selected_chunks(selected: list[EvidenceChunk]) -> list[dict[str, Any]]:
    groups: dict[str, list[EvidenceChunk]] = {}
    group_order: list[str] = []
    for chunk in selected:
        key = same_url_without_fragment(chunk.url) or chunk.document_id
        if key not in groups:
            groups[key] = []
            group_order.append(key)
        groups[key].append(chunk)

    sources: list[dict[str, Any]] = []
    for key in group_order:
        chunks = sorted(groups[key], key=lambda chunk: chunk.chunk_index)
        sources.append(
            {
                "query": chunks[0].query,
                "url": chunks[0].url,
                "title": chunks[0].title,
                "content": _reassemble(chunks),
                "source_id": chunks[0].source_id,
                "source_name": chunks[0].source_name,
                "score": round(max(chunk.rrf_score for chunk in chunks), 8),
                "rrf_score": round(max(chunk.rrf_score for chunk in chunks), 8),
                "content_type": chunks[0].content_type,
                "icon": chunks[0].icon,
                "selected_chunks": [
                    {
                        "chunk_id": chunk.chunk_id,
                        "chunk_index": chunk.chunk_index,
                        "start": chunk.start,
                        "end": chunk.end,
                        "rrf_score": round(chunk.rrf_score, 8),
                        "bm25_ranks": chunk.bm25_ranks,
                        "embedding_ranks": chunk.embedding_ranks,
                    }
                    for chunk in chunks
                ],
            }
        )
    return sources


def _reassemble(chunks: list[EvidenceChunk]) -> str:
    parts: list[str] = []
    run: list[EvidenceChunk] = []
    for chunk in chunks:
        if run and chunk.start > run[-1].end:
            parts.append(_render_run(run))
            run = []
        run.append(chunk)
    if run:
        parts.append(_render_run(run))
    return "\n\n[... omitted ...]\n\n".join(parts)


def _render_run(run: list[EvidenceChunk]) -> str:
    first, last = run[0], run[-1]
    label = f"Chunk {first.chunk_index}" if first.chunk_index == last.chunk_index else f"Chunks {first.chunk_index}-{last.chunk_index}"
    return f"[{label}]\n{first.document_text[first.start:last.end]}"


def _unique_texts(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        clean = " ".join(str(value or "").split())
        key = clean.casefold()
        if clean and key not in seen:
            seen.add(key)
            output.append(clean)
    return output
