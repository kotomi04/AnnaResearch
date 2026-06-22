from __future__ import annotations

import urllib.error
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup

from .models import ExtractedPage
from .utils import is_http_url, normalize_whitespace, truncate_text

NOISE_TAGS = [
    "script",
    "style",
    "footer",
    "header",
    "nav",
    "menu",
    "aside",
    "form",
    "iframe",
    "noscript",
    "svg",
]
NOISE_CLASSES = {"nav", "menu", "sidebar", "footer", "header", "cookie", "advertisement", "ads"}


class HtmlExtractionError(RuntimeError):
    """Raised when HTML extraction fails."""


def extract_html(
    source: str,
    *,
    timeout: float = 20.0,
    max_chars_per_page: int = 12000,
    user_agent: str = "AnnaResearcher/0.1",
) -> ExtractedPage:
    """Extract readable text from a local or remote HTML document."""
    clean_source = str(source or "").strip()
    if not clean_source:
        return ExtractedPage(url="", content_type="html", status="failed", error="empty_source")

    try:
        html = _load_html(clean_source, timeout=timeout, user_agent=user_agent)
        title, content = extract_html_content(html, max_chars_per_page=max_chars_per_page)
    except HtmlExtractionError as exc:
        return ExtractedPage(url=clean_source, content_type="html", status="failed", error=str(exc))

    if not content:
        return ExtractedPage(url=clean_source, title=title, content_type="html", status="failed", error="empty_content")
    return ExtractedPage(url=clean_source, title=title, raw_content=content, content_type="html")


def extract_html_content(html: str | bytes, *, max_chars_per_page: int = 12000) -> tuple[str, str]:
    soup = BeautifulSoup(html, "lxml")
    title = _extract_title(soup)
    _clean_soup(soup)
    content = _extract_text(soup)
    return title, truncate_text(content, max_chars_per_page)


def _load_html(source: str, *, timeout: float, user_agent: str) -> bytes:
    if is_http_url(source):
        request = urllib.request.Request(source, headers={"User-Agent": user_agent}, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.URLError as exc:
            raise HtmlExtractionError(f"failed to download html: {exc}") from exc

    path = Path(source)
    try:
        return path.read_bytes()
    except OSError as exc:
        raise HtmlExtractionError(f"failed to read html file: {exc}") from exc


def _clean_soup(soup: BeautifulSoup) -> None:
    for tag in soup.find_all(NOISE_TAGS):
        tag.decompose()

    def has_noise_class(tag) -> bool:
        classes = tag.get("class", []) if hasattr(tag, "get") else []
        return any(str(cls).lower() in NOISE_CLASSES for cls in classes)

    for tag in soup.find_all(has_noise_class):
        tag.decompose()


def _extract_title(soup: BeautifulSoup) -> str:
    if soup.title and soup.title.string:
        return normalize_whitespace(soup.title.string)
    heading = soup.find(["h1", "h2"])
    return normalize_whitespace(heading.get_text(" ", strip=True)) if heading else ""


def _extract_text(soup: BeautifulSoup) -> str:
    container = soup.find("article") or soup.find("main") or soup.body or soup
    text = container.get_text("\n", strip=True)
    return normalize_whitespace(text)
