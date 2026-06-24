from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ...embedding import select_page_chunks_by_embedding
from .arxiv import extract_arxiv
from .html import extract_html
from .models import ExtractedPage
from .pdf import extract_pdf
from .utils import same_url_without_fragment


def fetch_url(
    url: str,
    *,
    timeout: float = 20.0,
    max_chars_per_page: int = 12000,
    max_pdf_pages: int | None = None,
) -> ExtractedPage:
    """Route a URL to the appropriate extraction backend."""
    clean_url = str(url or "").strip()
    if not clean_url:
        return ExtractedPage(url="", status="failed", error="empty_url")
    lower = clean_url.lower()
    if lower.endswith(".pdf"):
        return extract_pdf(clean_url, timeout=timeout, max_pages=max_pdf_pages, max_chars_per_page=max_chars_per_page)
    if "arxiv.org" in lower:
        return extract_arxiv(clean_url)
    return extract_html(clean_url, timeout=timeout, max_chars_per_page=max_chars_per_page)


def fetch_many(
    items: Iterable[str | dict[str, Any]],
    *,
    max_urls: int = 5,
    timeout: float = 20.0,
    max_chars_per_page: int = 12000,
    max_pdf_pages: int | None = None,
) -> list[ExtractedPage]:
    """Extract content from distinct URLs in order."""
    urls = _distinct_urls(items, max_urls=max_urls)
    return [
        fetch_url(
            url,
            timeout=timeout,
            max_chars_per_page=max_chars_per_page,
            max_pdf_pages=max_pdf_pages,
        )
        for url in urls
    ]


def enrich_items_with_extracted_content(
    items: Iterable[dict[str, Any]],
    *,
    query: str = "",
    max_urls: int = 5,
    timeout: float = 20.0,
    max_chars_per_page: int = 12000,
    max_pdf_pages: int | None = None,
    embedding_provider: Any = None,
    embedding_top_k: int = 3,
    embedding_chunk_chars: int = 1200,
    embedding_min_page_score: float = 0.35,
) -> list[dict[str, Any]]:
    """Return search items with successful extraction content appended."""
    original = [dict(item) for item in items]
    pages = {
        same_url_without_fragment(page.url): page
        for page in fetch_many(
            original,
            max_urls=max_urls,
            timeout=timeout,
            max_chars_per_page=max_chars_per_page,
            max_pdf_pages=max_pdf_pages,
        )
    }
    enriched: list[dict[str, Any]] = []
    for item in original:
        url_key = same_url_without_fragment(str(item.get("url") or item.get("href") or ""))
        page = pages.get(url_key)
        next_item = dict(item)
        if page:
            next_item["extraction_status"] = page.status
            next_item["extraction_error"] = page.error
            next_item["content_type"] = page.content_type
            if page.title and not next_item.get("title"):
                next_item["title"] = page.title
            if page.status == "success" and page.raw_content:
                next_item["raw_content"] = page.raw_content
                content_to_join = page.raw_content
                if page.content_type == "html" and embedding_provider is not None and query:
                    try:
                        selection = select_page_chunks_by_embedding(
                            query=query,
                            text=page.raw_content,
                            embed=embedding_provider,
                            top_k=embedding_top_k,
                            chunk_chars=embedding_chunk_chars,
                        )
                    except Exception as exc:  # noqa: BLE001
                        next_item["embedding_filter_status"] = "failed"
                        next_item["embedding_filter_error"] = f"{type(exc).__name__}: {exc}"
                    else:
                        next_item["embedding_page_score"] = selection.page_score
                        next_item["embedding_selected_chunks"] = [
                            {"index": chunk.index, "score": chunk.score, "text": chunk.text}
                            for chunk in selection.chunks
                        ]
                        if selection.page_score < float(embedding_min_page_score):
                            next_item["embedding_filter_status"] = "irrelevant"
                            next_item["embedding_min_page_score"] = float(embedding_min_page_score)
                            content_to_join = ""
                        elif selection.chunks:
                            next_item["embedding_filter_status"] = "success"
                            content_to_join = "\n\n".join(chunk.text for chunk in selection.chunks)
                        else:
                            next_item["embedding_filter_status"] = "empty"
                            content_to_join = ""
                next_item["content"] = _join_snippet_and_content(str(next_item.get("content") or ""), content_to_join)
        enriched.append(next_item)
    return enriched


def _distinct_urls(items: Iterable[str | dict[str, Any]], *, max_urls: int) -> list[str]:
    limit = max(0, int(max_urls or 0))
    urls: list[str] = []
    seen: set[str] = set()
    for item in items:
        url = item if isinstance(item, str) else str(item.get("url") or item.get("href") or "")
        clean = str(url or "").strip()
        key = same_url_without_fragment(clean)
        if not clean or not key or key in seen:
            continue
        seen.add(key)
        urls.append(clean)
        if len(urls) >= limit:
            break
    return urls


def _join_snippet_and_content(snippet: str, raw_content: str) -> str:
    clean_snippet = snippet.strip()
    clean_content = raw_content.strip()
    if not clean_content:
        return clean_snippet
    if not clean_snippet:
        return clean_content
    if clean_snippet in clean_content:
        return clean_content
    return f"{clean_snippet}\n\nRelevant excerpts:\n{clean_content}"
