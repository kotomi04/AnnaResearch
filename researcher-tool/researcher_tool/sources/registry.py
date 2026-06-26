from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from ..errors import NotFoundError, StoreError, ValidationError
from .credentials import CredentialStore
from .envelope import EnvelopeError, validate_envelope

BUILTIN_SOURCE_IDS = frozenset({"tavily", "duckduckgo"})


def builtin_tavily_definition() -> dict[str, Any]:
    return {
        "id": "tavily",
        "name": "Tavily",
        "kind": "builtin",
        "description": "Tavily 通用 Web 搜索 API。适用于英文为主、需要权威新闻或公开网页证据的研究。",
        "max_parallel": 3,
        "request": {
            "method": "POST",
            "url": "https://api.tavily.com/search",
            "headers": {"Content-Type": "application/json"},
            "body": {
                "api_key": "{token}",
                "query": "{query}",
                "search_depth": "basic",
                "topic": "general",
                "max_results": 5,
                "include_answer": False,
                "include_raw_content": False,
                "use_cache": True,
            },
        },
        "pagination": {"mode": "none", "max_pages": 1, "page_size": 5, "start_page": 1},
        "result": {
            "items_path": "results[]",
            "url": {"mode": "path", "value": "url"},
            "title": {"mode": "path", "value": "title"},
            "content": {"mode": "paths", "value": ["content"]},
        },
        "response": {"content_type": "application/json"},
    }

def builtin_duckduckgo_definition() -> dict[str, Any]:
    return {
        "id": "duckduckgo",
        "name": "DuckDuckGo",
        "kind": "builtin",
        "description": "Anna 默认 Web Search 源，适合轻量 research 和公开网页发现。",
        "max_parallel": 2,
        "credential_required": False,
        "native": {
            "adapter": "ddgs",
            "max_results": 5,
            "region": "wt-wt",
            "max_urls": 5,
            "max_chars_per_page": 8000,
            "browser_fallback": True,
            "browser_fallback_min_chars": 300,
            "browser_timeout": 15,
        },
    }

class ResearchSourceRegistry:
    """Holds Built-in and User-Configured Research Source definitions."""

    def __init__(
        self,
        root: Path,
        *,
        credentials: CredentialStore,
        builtins: dict[str, dict[str, Any]] | None = None,
    ):
        self.root = root
        self.path = root / "sources.json"
        self.credentials = credentials
        self._builtins = builtins if builtins is not None else {
            "tavily": builtin_tavily_definition(),
            "duckduckgo": builtin_duckduckgo_definition(),
        }
        self._enabled_path = root / "source_enabled.json"

    def _read_user_sources(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        try:
            with self.path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as exc:
            raise StoreError("sources file is malformed") from exc
        if not isinstance(data, dict):
            raise StoreError("sources file root must be an object")
        return data

    def _write_user_sources(self, data: dict[str, dict[str, Any]]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        tmp.replace(self.path)

    def _read_enabled(self) -> dict[str, bool]:
        if not self._enabled_path.exists():
            return {}
        try:
            with self._enabled_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as exc:
            raise StoreError("source_enabled file is malformed") from exc
        if not isinstance(data, dict):
            raise StoreError("source_enabled file root must be an object")
        return {str(k): bool(v) for k, v in data.items()}

    def _write_enabled(self, data: dict[str, bool]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self._enabled_path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        tmp.replace(self._enabled_path)

    def is_builtin(self, source_id: str) -> bool:
        return source_id in self._builtins

    def get_definition(self, source_id: str) -> dict[str, Any]:
        if source_id in self._builtins:
            return self._builtins[source_id]
        user = self._read_user_sources().get(source_id)
        if user is None:
            raise NotFoundError(f"unknown research source: {source_id}")
        return user

    def get_view(self, source_id: str) -> dict[str, Any]:
        return self._view_for(source_id, self.get_definition(source_id))

    def list_views(self) -> list[dict[str, Any]]:
        views = [self._view_for(sid, defn) for sid, defn in self._builtins.items()]
        for sid, defn in self._read_user_sources().items():
            views.append(self._view_for(sid, defn))
        return views

    def list_enabled_definitions(self) -> list[dict[str, Any]]:
        enabled = self._read_enabled()
        items: list[dict[str, Any]] = []
        for sid, defn in self._builtins.items():
            if enabled.get(sid, True):
                items.append(defn)
        for sid, defn in self._read_user_sources().items():
            if enabled.get(sid, False):
                items.append(defn)
        return items

    def is_enabled(self, source_id: str) -> bool:
        enabled = self._read_enabled()
        default = source_id in self._builtins
        return enabled.get(source_id, default)

    def set_enabled(self, source_id: str, enabled: bool) -> dict[str, Any]:
        self.get_definition(source_id)
        data = self._read_enabled()
        data[source_id] = bool(enabled)
        self._write_enabled(data)
        return self.get_view(source_id)

    def upsert_user_source(self, definition: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(definition, dict):
            raise ValidationError("definition must be an object")
        source_id = str(definition.get("id") or "").strip()
        if not source_id:
            raise ValidationError("source id is required")
        if source_id in self._builtins:
            raise ValidationError(
                f"cannot modify builtin research source: {source_id}",
                data={"reason": "builtin_protected"},
            )
        name = str(definition.get("name") or "").strip()
        if not name:
            raise ValidationError("source name is required")
        validate_envelope(definition, kind="user")
        normalized = dict(definition)
        normalized["id"] = source_id
        normalized["name"] = name
        normalized["kind"] = "user"
        normalized.setdefault("enabled", True)
        normalized.setdefault("max_parallel", 1)
        normalized.setdefault("description", "")
        data = self._read_user_sources()
        data[source_id] = normalized
        self._write_user_sources(data)
        enabled = self._read_enabled()
        enabled.setdefault(source_id, bool(normalized.get("enabled", True)))
        self._write_enabled(enabled)
        return self.get_view(source_id)

    def delete_user_source(self, source_id: str) -> None:
        clean = str(source_id or "").strip()
        if not clean:
            raise ValidationError("source id is required")
        if clean in self._builtins:
            raise ValidationError(
                f"cannot delete builtin research source: {clean}",
                data={"reason": "builtin_protected"},
            )
        data = self._read_user_sources()
        if clean not in data:
            raise NotFoundError(f"unknown research source: {clean}")
        data.pop(clean, None)
        self._write_user_sources(data)
        enabled = self._read_enabled()
        enabled.pop(clean, None)
        self._write_enabled(enabled)
        self.credentials.remove(clean)

    def _view_for(self, source_id: str, definition: dict[str, Any]) -> dict[str, Any]:
        cred = self.credentials.status(source_id)
        if definition.get("credential_required") is False:
            cred = {"credential_status": "configured", "credential": ""}
        enabled = self.is_enabled(source_id)
        kind = "builtin" if source_id in self._builtins else "user"
        view = {
            "id": source_id,
            "name": definition.get("name") or source_id,
            "kind": kind,
            "description": definition.get("description") or "",
            "max_parallel": int(definition.get("max_parallel") or 1),
            "enabled": bool(enabled),
            "credential_status": cred["credential_status"],
            "credential": cred["credential"],
        }
        view["definition"] = _public_definition(definition)
        return view


def _public_definition(definition: dict[str, Any]) -> dict[str, Any]:
    """Strip any fields that must not leave the backend."""
    data = dict(definition)
    data.pop("credential", None)
    data.pop("token", None)
    return data
