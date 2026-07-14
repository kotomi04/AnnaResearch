from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Iterator, MutableMapping
from pathlib import Path
from typing import Any

from .job_store import JobStore, utc_now
from .sources.extraction.models import ExtractedPage
from .sources.extraction.utils import same_url_without_fragment


class WebDocumentStore:
    """Stores one complete extracted document per normalized URL."""

    def __init__(self, jobs: JobStore):
        self.jobs = jobs
        self._lock = threading.RLock()

    def document_id_for(self, url: str) -> str:
        key = same_url_without_fragment(url)
        return hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]

    def put_page(self, research_id: str, page: ExtractedPage) -> str:
        with self._lock:
            return self._put_page(research_id, page)

    def _put_page(self, research_id: str, page: ExtractedPage) -> str:
        key = same_url_without_fragment(page.url)
        document_id = self.document_id_for(key)
        directory = self._directory(research_id)
        directory.mkdir(parents=True, exist_ok=True)
        existing = self.get(research_id, document_id) or {}
        document = {
            "schema_version": 1,
            "document_id": document_id,
            "url_key": key,
            "url": key,
            "title": page.title or existing.get("title") or "",
            "icon": page.icon or existing.get("icon") or "",
            "content_type": page.content_type or existing.get("content_type") or "unknown",
            "status": page.status,
            "error": page.error,
            "content": page.raw_content if page.raw_content else existing.get("content") or "",
            "updated_at": utc_now(),
        }
        self._write_json(directory / f"{document_id}.json", document)
        index = self._read_index(research_id)
        index[key] = document_id
        self._write_json(directory / "index.json", index)
        return document_id

    def get(self, research_id: str, document_id: str) -> dict[str, Any] | None:
        path = self._directory(research_id) / f"{document_id}.json"
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else None

    def get_by_url(self, research_id: str, url: str) -> dict[str, Any] | None:
        document_id = self._read_index(research_id).get(same_url_without_fragment(url))
        return self.get(research_id, document_id) if document_id else None

    def page_cache(self, research_id: str) -> MutableMapping[str, ExtractedPage]:
        return _StoredPageCache(self, research_id)

    def detach_contents(self, research_id: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        detached: list[dict[str, Any]] = []
        for item in items:
            value = dict(item)
            url = str(value.get("url") or value.get("href") or "").strip()
            body = str(value.pop("raw_content", value.pop("url_body", value.pop("body", ""))) or "").strip()
            if url and body:
                document_id = self.put_page(
                    research_id,
                    ExtractedPage(
                        url=url,
                        title=str(value.get("title") or ""),
                        icon=str(value.get("icon") or ""),
                        content_type=str(value.get("content_type") or "unknown"),
                        raw_content=body,
                        status=str(value.get("extraction_status") or "success"),
                        error=value.get("extraction_error"),
                    ),
                )
                value["document_id"] = document_id
            elif url:
                existing = self.get_by_url(research_id, url)
                if existing:
                    value["document_id"] = existing.get("document_id")
            detached.append(value)
        return detached

    def _directory(self, research_id: str) -> Path:
        return self.jobs.job_dir_for(research_id) / "web_documents"

    def _read_index(self, research_id: str) -> dict[str, str]:
        path = self._directory(research_id) / "index.json"
        if not path.exists():
            return {}
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        return {str(key): str(document_id) for key, document_id in value.items()} if isinstance(value, dict) else {}

    @staticmethod
    def _write_json(path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + ".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
        temporary.replace(path)


class _StoredPageCache(MutableMapping[str, ExtractedPage]):
    def __init__(self, store: WebDocumentStore, research_id: str):
        self.store = store
        self.research_id = research_id
        self.index = store._read_index(research_id)

    def __getitem__(self, key: str) -> ExtractedPage:
        document_id = self.index[key]
        document = self.store.get(self.research_id, document_id)
        if not document:
            raise KeyError(key)
        return ExtractedPage(
            url=str(document.get("url") or key),
            title=str(document.get("title") or ""),
            icon=str(document.get("icon") or ""),
            raw_content=str(document.get("content") or ""),
            content_type=str(document.get("content_type") or "unknown"),
            status=str(document.get("status") or "success"),
            error=document.get("error"),
        )

    def __setitem__(self, key: str, value: ExtractedPage) -> None:
        document_id = self.store.put_page(self.research_id, value)
        self.index[same_url_without_fragment(key)] = document_id

    def __delitem__(self, key: str) -> None:
        raise TypeError("stored page cache does not support deletion")

    def __iter__(self) -> Iterator[str]:
        return iter(self.index)

    def __len__(self) -> int:
        return len(self.index)
