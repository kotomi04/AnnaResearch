from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .arxiv import extract_arxiv
from .browser_fallback import extract_many_with_browser_fallback, extract_with_browser_fallback
from .html import extract_html
from .models import ExtractedPage
from .pdf import extract_pdf
from .utils import same_url_without_fragment

LOW_VALUE_CONTENT_ERROR = "low_value_content"


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
        if browser_page.status == "success" and not is_low_value_extraction(browser_page.raw_content or "", title=browser_page.title, min_chars=browser_fallback_min_chars):
            return browser_page
        if page.status != "success" or is_low_value_extraction(page.raw_content or "", title=page.title, min_chars=browser_fallback_min_chars):
            if browser_page.status == "success":
                return _failed_low_value_page(clean_url, title=browser_page.title or page.title)
            return browser_page
    if page.status == "success" and is_low_value_extraction(page.raw_content or "", title=page.title, min_chars=browser_fallback_min_chars):
        return _failed_low_value_page(clean_url, title=page.title)
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
    page_cache: dict[str, ExtractedPage] | None = None,
) -> list[ExtractedPage]:
    """Extract content from distinct URLs in order."""
    urls = _distinct_urls(items, max_urls=max_urls)
    cache = page_cache if page_cache is not None else {}
    fallback_candidates: list[tuple[str, ExtractedPage]] = []
    pages_by_key: dict[str, ExtractedPage] = {}

    for url in urls:
        key = same_url_without_fragment(url)
        if key in cache:
            pages_by_key[key] = cache[key]
            continue
        page = _fetch_without_browser_fallback(
            url,
            timeout=timeout,
            max_chars_per_page=max_chars_per_page,
            max_pdf_pages=max_pdf_pages,
            query=query,
        )
        if browser_fallback and _is_html_url(url) and _should_use_browser_fallback(page, min_chars=browser_fallback_min_chars):
            fallback_candidates.append((url, page))
            continue
        resolved = _finalize_static_page(url, page, min_chars=browser_fallback_min_chars)
        cache[key] = resolved
        pages_by_key[key] = resolved

    if fallback_candidates:
        browser_pages = extract_many_with_browser_fallback(
            [url for url, _page in fallback_candidates],
            query=query,
            timeout=browser_timeout,
            max_chars_per_page=max_chars_per_page,
        )
        for (url, static_page), browser_page in zip(fallback_candidates, browser_pages):
            key = same_url_without_fragment(url)
            resolved = _resolve_fallback_page(url, static_page, browser_page, min_chars=browser_fallback_min_chars)
            cache[key] = resolved
            pages_by_key[key] = resolved

    return [pages_by_key[same_url_without_fragment(url)] for url in urls if same_url_without_fragment(url) in pages_by_key]


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
    page_cache: dict[str, ExtractedPage] | None = None,
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
            page_cache=page_cache,
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


def _fetch_without_browser_fallback(
    url: str,
    *,
    timeout: float,
    max_chars_per_page: int,
    max_pdf_pages: int | None,
    query: str,
) -> ExtractedPage:
    clean_url = str(url or "").strip()
    if not clean_url:
        return ExtractedPage(url="", status="failed", error="empty_url")
    lower = clean_url.lower()
    if lower.endswith(".pdf"):
        return extract_pdf(clean_url, timeout=timeout, max_pages=max_pdf_pages, max_chars_per_page=max_chars_per_page)
    if "arxiv.org" in lower:
        return extract_arxiv(clean_url)
    return extract_html(clean_url, timeout=timeout, max_chars_per_page=max_chars_per_page, query=query)


def _is_html_url(url: str) -> bool:
    lower = str(url or "").strip().lower()
    return bool(lower) and not lower.endswith(".pdf") and "arxiv.org" not in lower


def _finalize_static_page(url: str, page: ExtractedPage, *, min_chars: int) -> ExtractedPage:
    if page.status == "success" and is_low_value_extraction(page.raw_content or "", title=page.title, min_chars=min_chars):
        return _failed_low_value_page(url, title=page.title)
    return page


def _resolve_fallback_page(url: str, static_page: ExtractedPage, browser_page: ExtractedPage, *, min_chars: int) -> ExtractedPage:
    if browser_page.status == "success" and not is_low_value_extraction(browser_page.raw_content or "", title=browser_page.title, min_chars=min_chars):
        return browser_page
    if static_page.status != "success" or is_low_value_extraction(static_page.raw_content or "", title=static_page.title, min_chars=min_chars):
        if browser_page.status == "success":
            return _failed_low_value_page(url, title=browser_page.title or static_page.title)
        return browser_page
    return static_page


def _should_use_browser_fallback(page: ExtractedPage, *, min_chars: int) -> bool:
    content = (page.raw_content or "").strip()
    if page.status != "success":
        return True
    return is_low_value_extraction(content, title=page.title, min_chars=min_chars)


def is_low_value_extraction(content: str, *, title: str = "", min_chars: int = 300) -> bool:
    """Return true for shell/verification pages that should not enter context."""
    text = _normalize_content(content)
    if not text:
        return True
    if len(text) < max(1, int(min_chars or 1)):
        return True
    title_text = _normalize_content(title)
    if title_text and _roughly_same_text(text, title_text):
        return True
    lower = text.lower()
    exact_shells = {
        "ad",
        "html",
        "contact support",
        "menu",
        "stores",
        "# stores",
        "# stock quotes",
        "top of page bottom of page",
        "please wait while your request is being verified...",
    }
    if lower in exact_shells:
        return True
    low_value_patterns = (
        "please wait while your request is being verified",
        "performing security verification",
        "checking if the site connection is secure",
        "verify you are human",
        "verification successful",
        "cloudflare",
        "ray id:",
        "403 forbidden",
        "access denied",
        "enable javascript and cookies to continue",
        "blocked by anti-bot protection",
        "\"_waf_",
        "top of page bottom of page",
    )
    if any(pattern in lower for pattern in low_value_patterns):
        return True
    words = text.split()
    unique_words = set(word.lower() for word in words)
    if len(words) >= 8 and len(unique_words) <= 3:
        return True
    return False


def _failed_low_value_page(url: str, *, title: str = "") -> ExtractedPage:
    return ExtractedPage(url=url, title=title, content_type="html", status="failed", error=LOW_VALUE_CONTENT_ERROR)


def _normalize_content(value: str) -> str:
    return " ".join(str(value or "").strip().split())


def _roughly_same_text(value: str, other: str) -> bool:
    left = value.strip().casefold().strip("# ")
    right = other.strip().casefold().strip("# ")
    if not left or not right:
        return False
    if left == right:
        return True
    shorter, longer = sorted((left, right), key=len)
    return len(shorter) >= 8 and longer.startswith(shorter) and len(longer) <= len(shorter) + 24
