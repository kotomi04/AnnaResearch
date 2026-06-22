from __future__ import annotations

import re
import urllib.parse
from typing import Any

from .models import ExtractedPage

_ARXIV_ID_RE = re.compile(r"(?P<id>\d{4}\.\d{4,5})(?:v\d+)?")


class ArxivExtractionError(RuntimeError):
    """Raised when arXiv extraction fails."""


def extract_arxiv(source: str, *, max_results: int = 2) -> ExtractedPage:
    """Extract paper metadata and abstract text from an arXiv URL or id."""
    clean_source = str(source or "").strip()
    if not clean_source:
        return ExtractedPage(url="", content_type="arxiv", status="failed", error="empty_source")

    query = _query_from_source(clean_source)
    if not query:
        return ExtractedPage(url=clean_source, content_type="arxiv", status="failed", error="empty_query")

    try:
        paper = _load_arxiv_document(query, max_results=max_results)
    except ArxivExtractionError as exc:
        return ExtractedPage(url=clean_source, content_type="arxiv", status="failed", error=str(exc))

    title = str(paper.get("title") or "").strip()
    raw_content = _format_arxiv_content(paper)
    if not raw_content:
        return ExtractedPage(url=clean_source, title=title, content_type="arxiv", status="failed", error="empty_content")
    return ExtractedPage(url=clean_source, title=title, raw_content=raw_content, content_type="arxiv")


def _query_from_source(source: str) -> str:
    parsed = urllib.parse.urlparse(source)
    candidate = source
    if parsed.scheme and parsed.netloc:
        candidate = parsed.path.rstrip("/").split("/")[-1]
    candidate = urllib.parse.unquote(candidate).strip()
    match = _ARXIV_ID_RE.search(candidate)
    return match.group("id") if match else candidate


def _load_arxiv_document(query: str, *, max_results: int) -> dict[str, Any]:
    try:
        import arxiv
    except ImportError as exc:
        raise ArxivExtractionError("arxiv is not installed") from exc

    try:
        if _ARXIV_ID_RE.fullmatch(query):
            search = arxiv.Search(id_list=[query], max_results=max(1, int(max_results or 1)))
        else:
            search = arxiv.Search(query=query, max_results=max(1, int(max_results or 1)))
        client = arxiv.Client()
        result = next(client.results(search), None)
    except Exception as exc:
        raise ArxivExtractionError(f"failed to load arxiv document: {exc}") from exc

    if result is None:
        raise ArxivExtractionError("arxiv returned no documents")

    authors = ", ".join(str(author) for author in getattr(result, "authors", []) or [])
    published = getattr(result, "published", None)
    return {
        "title": getattr(result, "title", "") or "",
        "authors": authors,
        "published": published.isoformat() if published else "",
        "summary": getattr(result, "summary", "") or "",
        "entry_id": getattr(result, "entry_id", "") or "",
        "pdf_url": getattr(result, "pdf_url", "") or "",
    }


def _format_arxiv_content(paper: dict[str, Any]) -> str:
    parts = [
        f"Published: {paper.get('published') or ''}",
        f"Author: {paper.get('authors') or ''}",
        f"Content: {paper.get('summary') or ''}",
    ]
    return "; ".join(part for part in parts if part.split(": ", 1)[-1].strip()).strip()
