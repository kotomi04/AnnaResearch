from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from .domains import normalize_domains
from .errors import NotFoundError, StoreError, ValidationError
from .settings import default_research_root

ALLOWED_UPDATE_FIELDS = {
    "status",
    "stage",
    "progress",
    "agent_name",
    "agent_role_prompt",
    "search_queries",
    "error",
}


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class JobStore:
    def __init__(self, root: Path | None = None):
        self.root = root or default_research_root()
        self.jobs_dir = self.root / "jobs"
        self.latest_path = self.root / "latest_research_id"

    def create(self, *, query: str, query_domains: Any = None) -> dict[str, Any]:
        clean_query = str(query or "").strip()
        if not clean_query:
            raise ValidationError("query is required")
        now = utc_now()
        research_id = f"research_{uuid.uuid4().hex[:12]}"
        job = {
            "schema_version": 2,
            "research_id": research_id,
            "query": clean_query,
            "query_domains": normalize_domains(query_domains),
            "report_type": "research_report",
            "status": "created",
            "stage": "select_role",
            "progress": 0,
            "agent_name": "",
            "agent_role_prompt": "",
            "search_queries": [],
            "search_results": [],
            "selected_context": "",
            "selected_sources": [],
            "source_urls": [],
            "report_markdown": "",
            "error": None,
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
        }
        self.save(job)
        self._write_latest(research_id)
        return job

    def update_metadata(self, research_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        job = self.load(research_id)
        unknown = sorted(set(updates) - ALLOWED_UPDATE_FIELDS)
        if unknown:
            raise ValidationError("unsupported job update fields", data={"fields": unknown})
        for key, value in updates.items():
            job[key] = value
        return self.save(job)

    def save_search_results(self, research_id: str, *, search_queries: list[str], search_results: list[dict[str, Any]]) -> dict[str, Any]:
        job = self.load(research_id)
        job["search_queries"] = search_queries
        job["search_results"] = search_results
        job["source_urls"] = sorted({str(item.get("url")) for item in search_results if item.get("url")})
        job["source_count"] = len(job["source_urls"])
        return self.save(job)

    def save_selected_context(self, research_id: str, selected: dict[str, Any]) -> dict[str, Any]:
        job = self.load(research_id)
        job["selected_context"] = selected.get("selected_context") or ""
        job["selected_sources"] = selected.get("selected_sources") or []
        job["source_urls"] = selected.get("source_urls") or []
        job["source_count"] = len(job["source_urls"])
        return self.save(job)

    def save_result(self, research_id: str, result: dict[str, Any]) -> dict[str, Any]:
        job = self.load(research_id)
        job["report_markdown"] = str(result.get("report_markdown") or "")
        job["source_urls"] = result.get("source_urls") or job.get("source_urls") or []
        job["selected_sources"] = result.get("selected_sources") or job.get("selected_sources") or []
        job["status"] = str(result.get("status") or "completed")
        job["stage"] = str(result.get("stage") or "completed")
        job["progress"] = int(result.get("progress") or 100)
        job["error"] = result.get("error")
        job["completed_at"] = result.get("completed_at") or utc_now()
        return self.save(job)

    def path_for(self, research_id: str) -> Path:
        return self.jobs_dir / f"{research_id}.json"

    def load(self, research_id: str) -> dict[str, Any]:
        clean_id = str(research_id or "").strip()
        if not clean_id:
            raise ValidationError("research_id is required")
        path = self.path_for(clean_id)
        if not path.exists():
            raise NotFoundError(f"research job not found: {clean_id}")
        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as exc:
            raise StoreError(f"malformed job record: {clean_id}") from exc
        if not isinstance(data, dict) or data.get("research_id") != clean_id:
            raise StoreError(f"invalid job record: {clean_id}")
        return data

    def load_latest(self) -> dict[str, Any] | None:
        if not self.latest_path.exists():
            return None
        research_id = self.latest_path.read_text(encoding="utf-8").strip()
        if not research_id:
            return None
        return self.load(research_id)

    def save(self, job: dict[str, Any]) -> dict[str, Any]:
        research_id = str(job.get("research_id") or "").strip()
        if not research_id:
            raise StoreError("job is missing research_id")
        job["updated_at"] = utc_now()
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        path = self.path_for(research_id)
        tmp = path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(job, f, ensure_ascii=False, indent=2, sort_keys=True)
        tmp.replace(path)
        return job

    def _write_latest(self, research_id: str) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.latest_path.write_text(research_id, encoding="utf-8")

