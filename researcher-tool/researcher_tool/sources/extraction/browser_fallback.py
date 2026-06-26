from __future__ import annotations

import asyncio

from .models import ExtractedPage
from .utils import truncate_text


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
        title, markdown = asyncio.run(
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

    content = truncate_text(markdown.strip(), max_chars_per_page)
    if not content:
        return ExtractedPage(url=clean_url, title=title, content_type="html", status="failed", error="empty_content")
    return ExtractedPage(url=clean_url, title=title, raw_content=content, content_type="html")


async def _extract_with_crawl4ai(url: str, *, query: str, timeout: float) -> tuple[str, str]:
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
    if query:
        try:
            from crawl4ai import BM25ContentFilter, DefaultMarkdownGenerator

            config.markdown_generator = DefaultMarkdownGenerator(content_filter=BM25ContentFilter(user_query=query))
        except Exception:
            pass

    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, config=config)

    success = bool(getattr(result, "success", True))
    if not success:
        error = getattr(result, "error_message", "") or "crawl4ai returned failure"
        raise BrowserFallbackError(str(error))

    markdown_obj = getattr(result, "markdown", None)
    markdown = _markdown_text(markdown_obj)
    title = _title_from_result(result)
    if not markdown:
        markdown = str(getattr(result, "cleaned_html", "") or "")
    return title, markdown


def _markdown_text(markdown_obj: object) -> str:
    if markdown_obj is None:
        return ""
    fit = getattr(markdown_obj, "fit_markdown", None)
    if fit:
        return str(fit)
    raw = getattr(markdown_obj, "raw_markdown", None)
    if raw:
        return str(raw)
    return str(markdown_obj or "")


def _title_from_result(result: object) -> str:
    metadata = getattr(result, "metadata", None)
    if isinstance(metadata, dict):
        title = metadata.get("title")
        if title:
            return str(title)
    return ""
