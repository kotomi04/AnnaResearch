from __future__ import annotations

import time
from typing import Any, Callable

from ..executor import SourceCallResult, SourceTestResult
from .duckduckgo import DuckDuckGoSearchError, search_duckduckgo

NativeSearchFn = Callable[[str], list[dict[str, Any]]]


class NativeResearchSourceExecutor:
    """Executes built-in native research source adapters."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] | None = None,
        adapters: dict[str, NativeSearchFn] | None = None,
    ):
        self._clock = clock or time.monotonic
        self._adapters = adapters or {}

    def call(self, definition: dict[str, Any], query: str) -> SourceCallResult:
        source_id = str(definition.get("id") or "")
        source_name = str(definition.get("name") or source_id)
        clean_query = str(query or "").strip()
        started = self._clock()

        try:
            items = self._search(definition, clean_query)
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

    def _search(self, definition: dict[str, Any], query: str) -> list[dict[str, Any]]:
        if not query:
            return []
        native = definition.get("native") or {}
        if not isinstance(native, dict):
            raise NativeSourceError("bad_definition", "native source definition must include a native object")
        adapter = str(native.get("adapter") or "").strip()
        if not adapter:
            raise NativeSourceError("bad_definition", "native source adapter is required")

        if adapter in self._adapters:
            return self._adapters[adapter](query)
        if adapter == "ddgs":
            try:
                return search_duckduckgo(
                    query,
                    max_results=int(native.get("max_results") or 5),
                    region=str(native.get("region") or "wt-wt"),
                )
            except DuckDuckGoSearchError as exc:
                raise NativeSourceError("upstream_5xx", str(exc)) from exc
        raise NativeSourceError("bad_definition", f"unknown native source adapter: {adapter}")


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
