from __future__ import annotations

from collections.abc import Iterable, MutableMapping
from typing import Any, Callable

from .browser_fallback import extract_many_with_browser_fallback
from .fetcher import is_low_value_extraction
from .models import ExtractedPage
from .utils import same_url_without_fragment

TAVILY_PREFETCH_MIN_CHARS = 100
TAVILY_CRAWL_TIMEOUT_SECONDS = 15.0

BrowserExtractor = Callable[..., list[ExtractedPage]]


def enrich_tavily_items(
    items: Iterable[dict[str, Any]],
    *,
    page_cache: MutableMapping[str, ExtractedPage] | None = None,
    browser_extractor: BrowserExtractor | None = None,
) -> list[dict[str, Any]]:
    """Treat useful Tavily content as prefetched text and crawl only short results."""
    original = [dict(item) for item in items]
    cache = page_cache if page_cache is not None else {}
    extractor = browser_extractor or extract_many_with_browser_fallback
    resolved_pages: dict[str, ExtractedPage] = {}
    fallback_reasons: dict[str, str] = {}
    crawl_urls: list[str] = []
    seen_crawl_urls: set[str] = set()

    for item in original:
        url = str(item.get("url") or item.get("href") or "").strip()
        key = same_url_without_fragment(url)
        if key and key in cache:
            cached_page = cache[key]
            if cached_page.status == "success" and cached_page.raw_content:
                resolved_pages[key] = cached_page
                continue
        summary = str(item.get("content") or item.get("summary") or "").strip()
        if len(summary) > TAVILY_PREFETCH_MIN_CHARS:
            page = ExtractedPage(
                url=url,
                title=str(item.get("title") or ""),
                icon=str(item.get("icon") or ""),
                raw_content=summary,
                content_type="tavily_summary",
            )
            if key:
                cache[key] = page
                resolved_pages[key] = page
            continue
        if key and key not in seen_crawl_urls:
            seen_crawl_urls.add(key)
            crawl_urls.append(url)

    if crawl_urls:
        pages = extractor(crawl_urls, timeout=TAVILY_CRAWL_TIMEOUT_SECONDS)
        for index, url in enumerate(crawl_urls):
            page = pages[index] if index < len(pages) else ExtractedPage(
                url=url,
                content_type="html",
                status="failed",
                error="browser_extractor_result_missing",
            )
            key = same_url_without_fragment(url)
            if page.status == "success" and is_low_value_extraction(
                page.raw_content or "",
                title=page.title,
                min_chars=TAVILY_PREFETCH_MIN_CHARS,
            ):
                page = ExtractedPage(
                    url=url,
                    title=page.title,
                    icon=page.icon,
                    content_type=page.content_type,
                    status="failed",
                    error="low_value_content",
                )
            if page.status == "success" and page.raw_content:
                cache[key] = page
                resolved_pages[key] = page
                continue

            fallback_summary = next(
                (
                    str(item.get("content") or item.get("summary") or "").strip()
                    for item in original
                    if same_url_without_fragment(str(item.get("url") or item.get("href") or "").strip()) == key
                    and str(item.get("content") or item.get("summary") or "").strip()
                ),
                "",
            )
            if fallback_summary:
                fallback_page = ExtractedPage(
                    url=url,
                    title=next(
                        (
                            str(item.get("title") or "")
                            for item in original
                            if same_url_without_fragment(str(item.get("url") or item.get("href") or "").strip()) == key
                        ),
                        "",
                    ),
                    raw_content=fallback_summary,
                    content_type="tavily_summary_fallback",
                )
                cache[key] = fallback_page
                resolved_pages[key] = fallback_page
                fallback_reasons[key] = str(page.error or "browser_extraction_failed")
            else:
                resolved_pages[key] = page

    enriched: list[dict[str, Any]] = []
    for item in original:
        next_item = dict(item)
        url = str(item.get("url") or item.get("href") or "").strip()
        key = same_url_without_fragment(url)
        page = resolved_pages.get(key)
        if page is None:
            next_item["extraction_status"] = "failed"
            next_item["extraction_error"] = "empty_url"
            enriched.append(next_item)
            continue
        next_item["extraction_status"] = page.status
        next_item["extraction_error"] = page.error
        next_item["content_type"] = page.content_type
        if key in fallback_reasons:
            next_item["extraction_fallback_reason"] = fallback_reasons[key]
        if page.title and not next_item.get("title"):
            next_item["title"] = page.title
        if page.icon:
            next_item["icon"] = page.icon
        if page.status == "success" and page.raw_content:
            next_item["raw_content"] = page.raw_content
        enriched.append(next_item)
    return enriched
