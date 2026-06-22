from __future__ import annotations

from collections.abc import Iterable
from typing import Any


class DuckDuckGoSearchError(RuntimeError):
    """Raised when the DuckDuckGo native adapter cannot complete a search."""


def search_duckduckgo(
    query: str,
    *,
    max_results: int = 5,
    region: str = "wt-wt",
) -> list[dict[str, Any]]:
    """Search DuckDuckGo through ddgs and return normalized research items."""
    clean_query = str(query or "").strip()
    if not clean_query:
        return []

    limit = _clamp_max_results(max_results)
    ddgs = _create_client()

    try:
        results = ddgs.text(clean_query, region=region or "wt-wt", max_results=limit)
    except Exception as exc:
        raise DuckDuckGoSearchError(f"duckduckgo search failed: {exc}") from exc

    return [
        normalized
        for normalized in (_normalize_item(item, query=clean_query) for item in _iter_results(results))
        if normalized is not None
    ]


def _create_client() -> Any:
    try:
        from ddgs import DDGS
    except ImportError as exc:
        raise DuckDuckGoSearchError("ddgs is not installed") from exc
    return DDGS()


def _iter_results(results: Any) -> Iterable[dict[str, Any]]:
    if results is None:
        return []
    if isinstance(results, dict):
        return [results]
    if isinstance(results, Iterable) and not isinstance(results, (str, bytes)):
        return (item for item in results if isinstance(item, dict))
    return []


def _normalize_item(item: dict[str, Any], *, query: str) -> dict[str, Any] | None:
    url = str(item.get("href") or item.get("url") or "").strip()
    title = str(item.get("title") or url or "DuckDuckGo result").strip()
    content = str(item.get("body") or item.get("content") or item.get("snippet") or "").strip()
    if not url and not content:
        return None
    return {
        "query": query,
        "url": url,
        "title": title,
        "content": content,
    }


def _clamp_max_results(value: int) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = 5
    return max(1, min(20, numeric))
