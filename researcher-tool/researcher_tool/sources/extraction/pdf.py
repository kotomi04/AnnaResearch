from __future__ import annotations

import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from .models import ExtractedPage


class PdfExtractionError(RuntimeError):
    """Raised when PDF extraction fails."""


def extract_pdf(
    source: str,
    *,
    timeout: float = 30.0,
    max_pages: int | None = None,
    max_chars_per_page: int = 12000,
    user_agent: str = "AnnaResearcher/0.1",
) -> ExtractedPage:
    """Extract text from a local or remote PDF."""
    clean_source = str(source or "").strip()
    if not clean_source:
        return ExtractedPage(url="", content_type="pdf", status="failed", error="empty_source")

    temp_path = ""
    try:
        path = _download_pdf(clean_source, timeout=timeout, user_agent=user_agent) if _is_url(clean_source) else clean_source
        if path != clean_source:
            temp_path = path
        title, content = _extract_pdf_file(path, max_pages=max_pages, max_chars_per_page=max_chars_per_page)
        if not content.strip():
            return ExtractedPage(url=clean_source, title=title, content_type="pdf", status="failed", error="empty_content")
        return ExtractedPage(url=clean_source, title=title, raw_content=content, content_type="pdf")
    except PdfExtractionError as exc:
        return ExtractedPage(url=clean_source, content_type="pdf", status="failed", error=str(exc))
    finally:
        if temp_path:
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _extract_pdf_file(path: str, *, max_pages: int | None, max_chars_per_page: int) -> tuple[str, str]:
    try:
        import fitz
    except ImportError as exc:
        raise PdfExtractionError("pymupdf is not installed") from exc

    try:
        doc = fitz.open(path)
    except Exception as exc:
        raise PdfExtractionError(f"failed to open pdf: {exc}") from exc

    try:
        metadata: dict[str, Any] = getattr(doc, "metadata", {}) or {}
        title = str(metadata.get("title") or Path(path).stem or "").strip()
        page_count = len(doc)
        limit = page_count if max_pages is None else max(0, min(page_count, int(max_pages)))
        chunks: list[str] = []
        for page_index in range(limit):
            text = str(doc.load_page(page_index).get_text("text") or "").strip()
            if not text:
                continue
            chunks.append(_truncate(text, max_chars_per_page))
        return title, "\n\n".join(chunks).strip()
    finally:
        doc.close()


def _download_pdf(source_url: str, *, timeout: float, user_agent: str) -> str:
    request = urllib.request.Request(source_url, headers={"User-Agent": user_agent}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.URLError as exc:
        raise PdfExtractionError(f"failed to download pdf: {exc}") from exc
    if not body:
        raise PdfExtractionError("downloaded pdf is empty")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as handle:
        handle.write(body)
        return handle.name


def _is_url(value: str) -> bool:
    parsed = urllib.parse.urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _truncate(value: str, max_chars: int) -> str:
    limit = max(1, int(max_chars or 1))
    return value if len(value) <= limit else value[:limit]
