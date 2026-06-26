from __future__ import annotations

import time
from typing import Any, Callable

from ..executor import SourceCallResult, SourceTestResult
from .duckduckgo import DuckDuckGoSearchError, search_duckduckgo

NativeSearchFn = Callable[[str], list[dict[str, Any]]]
NativeExtractorFn = Callable[..., list[dict[str, Any]]]


class NativeResearchSourceExecutor:
    """Executes built-in native research source adapters."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] | None = None,
        adapters: dict[str, NativeSearchFn] | None = None,
        extractor: NativeExtractorFn | None = None,
    ):
        self._clock = clock or time.monotonic
        self._adapters = adapters or {}
        self._extractor = extractor

    def call(self, definition: dict[str, Any], query: str, *, extraction_cache: dict[str, Any] | None = None) -> SourceCallResult:
        source_id = str(definition.get("id") or "")
        source_name = str(definition.get("name") or source_id)
        clean_query = str(query or "").strip()
        started = self._clock()

        try:
            items = self._search(definition, clean_query, extraction_cache=extraction_cache)
            error = None if items else "empty_result"
        except NativeSourceError as exc:
            items = []
            error = exc.code

        return SourceCallResult(
            source_id=source_id,
            source_name=source_name,
            query=clean_query,
            items=[_with_source_metadata(item, source_id=source_id, source_name=source_name) for item in items],
            duration_ms=int((self._clock() - started) * 1000),
            error=error,
        )

    def test(self, definition: dict[str, Any], query: str) -> SourceTestResult:
        source_id = str(definition.get("id") or "")
        source_name = str(definition.get("name") or source_id)
        clean_query = str(query or "").strip()
        started = self._clock()

        try:
            items = self._search(definition, clean_query)
            extracted = [_with_source_metadata(item, source_id=source_id, source_name=source_name) for item in items]
            error = None if extracted else {"code": "empty_result", "message": "native source returned no results"}
        except NativeSourceError as exc:
            extracted = []
            error = {"code": exc.code, "message": exc.message}

        return SourceTestResult(
            source_id=source_id,
            source_name=source_name,
            query=clean_query,
            pages=[],
            extracted=extracted,
            duration_ms=int((self._clock() - started) * 1000),
            error=error,
        )

    def _search(self, definition: dict[str, Any], query: str, *, extraction_cache: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        if not query:
            return []
        native = definition.get("native") or {}
        if not isinstance(native, dict):
            raise NativeSourceError("bad_definition", "native source definition must include a native object")
        adapter = str(native.get("adapter") or "").strip()
        if not adapter:
            raise NativeSourceError("bad_definition", "native source adapter is required")

        if adapter in self._adapters:
            return self._maybe_extract(definition, self._adapters[adapter](query), extraction_cache=extraction_cache)
        if adapter == "ddgs":
            try:
                items = search_duckduckgo(
                    query,
                    max_results=int(native.get("max_results") or 5),
                    region=str(native.get("region") or "wt-wt"),
                )
                return self._maybe_extract(definition, items, extraction_cache=extraction_cache)
            except DuckDuckGoSearchError as exc:
                raise NativeSourceError("upstream_5xx", str(exc)) from exc
        raise NativeSourceError("bad_definition", f"unknown native source adapter: {adapter}")

    def _maybe_extract(self, definition: dict[str, Any], items: list[dict[str, Any]], *, extraction_cache: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        native = definition.get("native") or {}
        if not isinstance(native, dict) or not items:
            return items
        try:
            extractor = self._extractor or _default_extractor
            return extractor(
                items,
                query=str(items[0].get("query") or ""),
                max_urls=_clamp_int(native.get("max_urls"), default=len(items), minimum=0, maximum=20),
                timeout=float(native.get("extract_timeout") or 20.0),
                max_chars_per_page=_clamp_int(native.get("max_chars_per_page"), default=8000, minimum=1000, maximum=50000),
                max_pdf_pages=_optional_clamp_int(native.get("max_pdf_pages"), minimum=1, maximum=100),
                browser_fallback=bool(native.get("browser_fallback", False)),
                browser_fallback_min_chars=_clamp_int(native.get("browser_fallback_min_chars"), default=300, minimum=1, maximum=5000),
                browser_timeout=float(native.get("browser_timeout") or 30.0),
                page_cache=extraction_cache,
            )
        except Exception as exc:  # noqa: BLE001
            raise NativeSourceError("upstream_5xx", f"native extraction failed: {exc}") from exc


class NativeSourceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _with_source_metadata(item: dict[str, Any], *, source_id: str, source_name: str) -> dict[str, Any]:
    data = dict(item)
    data["source_id"] = source_id
    data["source_name"] = source_name
    return data


def _clamp_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = default
    return max(minimum, min(maximum, numeric))


def _optional_clamp_int(value: Any, *, minimum: int, maximum: int) -> int | None:
    if value in (None, ""):
        return None
    return _clamp_int(value, default=minimum, minimum=minimum, maximum=maximum)


def _default_extractor(items: list[dict[str, Any]], **kwargs: Any) -> list[dict[str, Any]]:
    from ..extraction.fetcher import enrich_items_with_extracted_content

    return enrich_items_with_extracted_content(items, **kwargs)
