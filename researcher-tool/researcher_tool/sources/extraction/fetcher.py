from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .arxiv import extract_arxiv
from .browser_fallback import extract_with_browser_fallback
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
    query: str = "",
    browser_fallback: bool = False,
    browser_fallback_min_chars: int = 300,
    browser_timeout: float = 30.0,
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
    page = extract_html(clean_url, timeout=timeout, max_chars_per_page=max_chars_per_page, query=query)
    if browser_fallback and _should_use_browser_fallback(page, min_chars=browser_fallback_min_chars):
        browser_page = extract_with_browser_fallback(clean_url, query=query, timeout=browser_timeout, max_chars_per_page=max_chars_per_page)
        if browser_page.status == "success":
            return browser_page
        if page.status != "success":
            return browser_page
    return page


def fetch_many(
    items: Iterable[str | dict[str, Any]],
    *,
    max_urls: int = 5,
    timeout: float = 20.0,
    max_chars_per_page: int = 12000,
    max_pdf_pages: int | None = None,
    query: str = "",
    browser_fallback: bool = False,
    browser_fallback_min_chars: int = 300,
    browser_timeout: float = 30.0,
) -> list[ExtractedPage]:
    """Extract content from distinct URLs in order."""
    urls = _distinct_urls(items, max_urls=max_urls)
    return [
        fetch_url(
            url,
            timeout=timeout,
            max_chars_per_page=max_chars_per_page,
            max_pdf_pages=max_pdf_pages,
            query=query,
            browser_fallback=browser_fallback,
            browser_fallback_min_chars=browser_fallback_min_chars,
            browser_timeout=browser_timeout,
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
    browser_fallback: bool = False,
    browser_fallback_min_chars: int = 300,
    browser_timeout: float = 30.0,
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
            query=query,
            browser_fallback=browser_fallback,
            browser_fallback_min_chars=browser_fallback_min_chars,
            browser_timeout=browser_timeout,
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
                next_item["content"] = _join_snippet_and_content(str(next_item.get("content") or ""), page.raw_content)
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


def _should_use_browser_fallback(page: ExtractedPage, *, min_chars: int) -> bool:
    content = (page.raw_content or "").strip()
    if page.status != "success":
        return True
    if len(content) < max(1, int(min_chars or 1)):
        return True
    if page.title and content == page.title.strip():
        return True
    return False
