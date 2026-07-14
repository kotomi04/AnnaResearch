from __future__ import annotations

import asyncio
from collections.abc import Iterable

from .models import ExtractedPage


class BrowserFallbackError(RuntimeError):
    """Raised when optional crawl4ai browser fallback cannot extract content."""


def extract_with_browser_fallback(
    url: str,
    *,
    query: str = "",
    timeout: float = 30.0,
    max_chars_per_page: int = 12000,
) -> ExtractedPage:
    """Extract a dynamic page through crawl4ai when the optional dependency exists."""
    clean_url = str(url or "").strip()
    if not clean_url:
        return ExtractedPage(url="", content_type="html", status="failed", error="empty_url")
    try:
        title, icon, markdown = asyncio.run(
            _extract_with_crawl4ai(
                clean_url,
                query=query,
                timeout=timeout,
            )
        )
    except BrowserFallbackError as exc:
        return ExtractedPage(url=clean_url, content_type="html", status="failed", error=str(exc))
    except Exception as exc:  # noqa: BLE001
        return ExtractedPage(url=clean_url, content_type="html", status="failed", error=f"browser_fallback_failed: {type(exc).__name__}: {exc}")

    content = markdown.strip()
    if not content:
        return ExtractedPage(url=clean_url, title=title, icon=icon, content_type="html", status="failed", error="empty_content")
    return ExtractedPage(url=clean_url, title=title, icon=icon, raw_content=content, content_type="html")


def extract_many_with_browser_fallback(
    urls: Iterable[str],
    *,
    query: str = "",
    timeout: float = 30.0,
    max_chars_per_page: int = 12000,
) -> list[ExtractedPage]:
    """Extract multiple dynamic pages while reusing one crawl4ai browser session."""
    clean_urls = [str(url or "").strip() for url in urls]
    if not clean_urls:
        return []
    try:
        results = asyncio.run(
            _extract_many_with_crawl4ai(
                clean_urls,
                query=query,
                timeout=timeout,
            )
        )
    except BrowserFallbackError as exc:
        return [
            ExtractedPage(url=url, content_type="html", status="failed", error=str(exc)) if url else ExtractedPage(url="", content_type="html", status="failed", error="empty_url")
            for url in clean_urls
        ]
    except Exception as exc:  # noqa: BLE001
        return [
            ExtractedPage(url=url, content_type="html", status="failed", error=f"browser_fallback_failed: {type(exc).__name__}: {exc}") if url else ExtractedPage(url="", content_type="html", status="failed", error="empty_url")
            for url in clean_urls
        ]

    pages: list[ExtractedPage] = []
    for url, result in zip(clean_urls, results):
        if isinstance(result, ExtractedPage):
            page = result
        else:
            title, icon, markdown = result
            content = markdown.strip()
            if content:
                page = ExtractedPage(url=url, title=title, icon=icon, raw_content=content, content_type="html")
            else:
                page = ExtractedPage(url=url, title=title, icon=icon, content_type="html", status="failed", error="empty_content")
        pages.append(page)
    return pages


async def _extract_with_crawl4ai(url: str, *, query: str, timeout: float) -> tuple[str, str, str]:
    crawler_cls, config = _crawl4ai_runtime(query=query, timeout=timeout)
    async with crawler_cls() as crawler:
        return await _crawl_one(crawler, url, config=config)


async def _extract_many_with_crawl4ai(urls: list[str], *, query: str, timeout: float) -> list[tuple[str, str, str] | ExtractedPage]:
    crawler_cls, config = _crawl4ai_runtime(query=query, timeout=timeout)
    results: list[tuple[str, str, str] | ExtractedPage] = []
    async with crawler_cls() as crawler:
        for url in urls:
            if not url:
                results.append(ExtractedPage(url="", content_type="html", status="failed", error="empty_url"))
                continue
            try:
                results.append(await _crawl_one(crawler, url, config=config))
            except BrowserFallbackError as exc:
                results.append(ExtractedPage(url=url, content_type="html", status="failed", error=str(exc)))
            except Exception as exc:  # noqa: BLE001
                results.append(ExtractedPage(url=url, content_type="html", status="failed", error=f"browser_fallback_failed: {type(exc).__name__}: {exc}"))
    return results


def _crawl4ai_runtime(*, query: str, timeout: float):
    try:
        from crawl4ai import AsyncWebCrawler, CrawlerRunConfig
    except ImportError as exc:
        raise BrowserFallbackError("crawl4ai is not installed") from exc

    page_timeout = max(1000, int(timeout * 1000))
    config = CrawlerRunConfig(
        wait_until="domcontentloaded",
        page_timeout=page_timeout,
        wait_for_timeout=page_timeout,
        remove_overlay_elements=True,
        remove_consent_popups=True,
        scan_full_page=True,
        max_scroll_steps=5,
        delay_before_return_html=0.5,
        word_count_threshold=20,
    )
    return AsyncWebCrawler, config


async def _crawl_one(crawler: object, url: str, *, config: object) -> tuple[str, str, str]:
    result = await crawler.arun(url=url, config=config)
    success = bool(getattr(result, "success", True))
    if not success:
        error = getattr(result, "error_message", "") or "crawl4ai returned failure"
        raise BrowserFallbackError(str(error))

    markdown_obj = getattr(result, "markdown", None)
    markdown = _markdown_text(markdown_obj)
    title = _title_from_result(result)
    icon = _icon_from_result(result)
    if not markdown:
        markdown = _first_non_empty_text(getattr(result, "cleaned_html", ""))
    return title, icon, markdown


def _markdown_text(markdown_obj: object) -> str:
    if markdown_obj is None:
        return ""
    return _first_non_empty_text(
        getattr(markdown_obj, "raw_markdown", None),
        getattr(markdown_obj, "fit_markdown", None),
        markdown_obj,
    )


def _first_non_empty_text(*values: object) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _title_from_result(result: object) -> str:
    metadata = getattr(result, "metadata", None)
    if isinstance(metadata, dict):
        title = metadata.get("title")
        if title:
            return str(title)
    return ""


def _icon_from_result(result: object) -> str:
    metadata = getattr(result, "metadata", None)
    if not isinstance(metadata, dict):
        return ""
    for key in ("icon", "favicon", "favicon_url", "icon_url", "image"):
        value = metadata.get(key)
        if value:
            return str(value)
    return ""
