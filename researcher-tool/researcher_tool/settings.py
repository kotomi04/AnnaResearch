from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .errors import StoreError


def default_research_root() -> Path:
    workspace = os.getenv("ANNA_RESEARCHER_WORKSPACE")
    root = Path(workspace).expanduser() if workspace else Path("~/anna-workspace").expanduser()
    return root / ".research"


class SettingsStore:
    def __init__(self, root: Path | None = None):
        self.root = root or default_research_root()
        self.path = self.root / "settings.json"

    def read_raw(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            with self.path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as exc:
            raise StoreError("settings file is malformed") from exc
        if not isinstance(data, dict):
            raise StoreError("settings file root must be an object")
        return data

    def get_tavily_key(self) -> str:
        value = self.read_raw().get("tavily_api_key") or ""
        return str(value).strip()

    def view(self) -> dict[str, Any]:
        key = self.get_tavily_key()
        return {
            "research_root": str(self.root),
            "tavily": {
                "configured": bool(key),
                "masked": mask_secret(key) if key else "",
            }
        }

    def update(self, *, tavily_api_key: str | None = None, clear_tavily_api_key: bool = False) -> dict[str, Any]:
        data = self.read_raw()
        if clear_tavily_api_key:
            data.pop("tavily_api_key", None)
        elif tavily_api_key is not None:
            key = str(tavily_api_key).strip()
            if key:
                data["tavily_api_key"] = key
        self._write(data)
        return self.view()

    def _write(self, data: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        tmp.replace(self.path)


def mask_secret(value: str) -> str:
    """Front-0-back-4 mask shared with the credential store."""
    text = (value or "").strip()
    if not text:
        return ""
    if len(text) <= 4:
        return "*" * len(text)
    return "***" + text[-4:]
