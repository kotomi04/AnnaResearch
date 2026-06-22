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
    "research_log",
    "iteration",
    "max_iterations",
    "enabled_sources",
    "active_section_index",
}


def normalize_query_for_dedup(query: str) -> str:
    return " ".join((query or "").lower().split())


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
            "iterations": [],
            "research_log": [],
            "enabled_sources": [],
            "iteration": 0,
            "max_iterations": 5,
            "workflow": "sectioned_research",
            "confirmed_role": None,
            "confirmed_focuses": [],
            "confirmed_outline": [],
            "active_section_index": None,
            "section_iterations": {},
            "section_selected_context": {},
            "section_results": {},
            "report_framing": None,
            "assembled_result": None,
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

    def save_confirmed_role(self, research_id: str, role: dict[str, Any]) -> dict[str, Any]:
        server = str(role.get("server") or role.get("agent_name") or "").strip()
        prompt = str(role.get("agent_role_prompt") or "").strip()
        if not server:
            raise ValidationError("server is required")
        if not prompt:
            raise ValidationError("agent_role_prompt is required")
        job = self.load(research_id)
        job["confirmed_role"] = {"server": server, "agent_role_prompt": prompt}
        job["agent_name"] = server
        job["agent_role_prompt"] = prompt
        job["stage"] = "brainstorm_focus"
        job["progress"] = max(int(job.get("progress") or 0), 15)
        return self.save(job)

    def save_confirmed_focuses(self, research_id: str, focuses: list[Any]) -> dict[str, Any]:
        cleaned = [str(item).strip() for item in focuses if str(item or "").strip()]
        if not 1 <= len(cleaned) <= 5:
            raise ValidationError("confirmed_focuses must contain 1 to 5 entries")
        job = self.load(research_id)
        job["confirmed_focuses"] = cleaned
        job["stage"] = "plan_outline"
        job["progress"] = max(int(job.get("progress") or 0), 25)
        return self.save(job)

    def save_confirmed_outline(self, research_id: str, sections: list[dict[str, Any]]) -> dict[str, Any]:
        cleaned = [_normalize_section(section, idx) for idx, section in enumerate(sections)]
        if not 1 <= len(cleaned) <= 8:
            raise ValidationError("confirmed_outline must contain 1 to 8 sections")
        for section in cleaned:
            if not section["allowed_source_ids"]:
                raise ValidationError("each section must allow at least one research source", data={"section_id": section["id"]})
        job = self.load(research_id)
        job["confirmed_outline"] = cleaned
        job["active_section_index"] = 0
        job["stage"] = "section_research"
        job["progress"] = max(int(job.get("progress") or 0), 35)
        job.setdefault("section_iterations", {})
        job.setdefault("section_selected_context", {})
        job.setdefault("section_results", {})
        return self.save(job)

    def append_section_iteration(
        self,
        research_id: str,
        *,
        section_id: str,
        iteration: int,
        source_id: str,
        source_name: str,
        queries: list[str],
        source_calls: list[dict[str, Any]],
        raw_results: list[dict[str, Any]],
    ) -> dict[str, Any]:
        job = self.load(research_id)
        section_id = _require_section(job, section_id)["id"]
        all_iterations = dict(job.get("section_iterations") or {})
        iterations = list(all_iterations.get(section_id) or [])
        entry = {
            "iteration": iteration,
            "source_id": source_id,
            "source_name": source_name,
            "queries": list(queries),
            "source_calls": list(source_calls),
            "results_count": sum(len(c.get("items", [])) for c in source_calls),
            "raw_results": list(raw_results),
            "appended_at": utc_now(),
        }
        iterations = [it for it in iterations if int(it.get("iteration") or -1) != iteration]
        iterations.append(entry)
        iterations.sort(key=lambda it: int(it.get("iteration") or 0))
        all_iterations[section_id] = iterations
        job["section_iterations"] = all_iterations
        job["iteration"] = max(int(job.get("iteration") or 0), iteration)
        job["research_log"] = _flatten_section_research_log(job)
        job["source_urls"] = _all_section_source_urls(job)
        job["source_count"] = len(job["source_urls"])
        return self.save(job)

    def has_section_called(self, research_id: str, section_id: str, source_id: str, normalized_query: str) -> bool:
        job = self.load(research_id)
        _require_section(job, section_id)
        for entry in (job.get("section_iterations") or {}).get(section_id, []) or []:
            for query in entry.get("queries") or []:
                if str(entry.get("source_id") or "") == source_id and normalize_query_for_dedup(str(query)) == normalized_query:
                    return True
        return False

    def save_section_selected_context(self, research_id: str, section_id: str, selected: dict[str, Any]) -> dict[str, Any]:
        job = self.load(research_id)
        section_id = _require_section(job, section_id)["id"]
        contexts = dict(job.get("section_selected_context") or {})
        contexts[section_id] = {
            "selected_context": selected.get("selected_context") or "",
            "selected_sources": selected.get("selected_sources") or [],
            "source_urls": selected.get("source_urls") or [],
            "selected_at": utc_now(),
        }
        job["section_selected_context"] = contexts
        return self.save(job)

    def save_section_result(self, research_id: str, section_id: str, result: dict[str, Any]) -> dict[str, Any]:
        job = self.load(research_id)
        section_id = _require_section(job, section_id)["id"]
        markdown = str(result.get("section_markdown") or "").strip()
        summary = str(result.get("section_summary") or "").strip()
        status = str(result.get("status") or ("completed" if markdown else "failed"))
        results = dict(job.get("section_results") or {})
        results[section_id] = {
            "section_id": section_id,
            "status": status,
            "section_markdown": markdown,
            "section_summary": summary,
            "source_urls": result.get("source_urls") or [],
            "error": result.get("error"),
            "completed_at": utc_now() if status == "completed" else None,
            "updated_at": utc_now(),
        }
        job["section_results"] = results
        if status == "failed":
            job["status"] = "failed"
            job["stage"] = "failed"
            job["error"] = result.get("error") or {"message": f"section failed: {section_id}"}
        return self.save(job)

    def fail_section(self, research_id: str, section_id: str, error: Any) -> dict[str, Any]:
        return self.save_section_result(research_id, section_id, {"status": "failed", "error": error})

    def save_report_framing(self, research_id: str, framing: dict[str, Any]) -> dict[str, Any]:
        job = self.load(research_id)
        job["report_framing"] = {
            "title": str(framing.get("title") or "").strip(),
            "introduction": str(framing.get("introduction") or "").strip(),
            "conclusion": str(framing.get("conclusion") or "").strip(),
            "created_at": utc_now(),
        }
        job["stage"] = "assemble_report"
        job["progress"] = max(int(job.get("progress") or 0), 96)
        return self.save(job)

    def save_assembled_result(self, research_id: str, result: dict[str, Any]) -> dict[str, Any]:
        job = self.save_result(research_id, result)
        job["assembled_result"] = {
            "source": "sectioned_research",
            "section_ids": [section.get("id") for section in job.get("confirmed_outline") or []],
            "created_at": job.get("completed_at") or utc_now(),
        }
        return self.save(job)

    def save_search_results(self, research_id: str, *, search_queries: list[str], search_results: list[dict[str, Any]]) -> dict[str, Any]:
        job = self.load(research_id)
        job["search_queries"] = search_queries
        job["search_results"] = search_results
        job["source_urls"] = sorted({str(item.get("url")) for item in search_results if item.get("url")})
        job["source_count"] = len(job["source_urls"])
        return self.save(job)

    def append_iteration(
        self,
        research_id: str,
        *,
        iteration: int,
        source_id: str,
        source_name: str,
        queries: list[str],
        source_calls: list[dict[str, Any]],
        raw_results: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Append (or merge) one iteration entry. ``raw_results`` is stored on
        the job record only — callers never expose it to the frontend."""
        job = self.load(research_id)
        iterations = list(job.get("iterations") or [])
        entry = {
            "iteration": iteration,
            "source_id": source_id,
            "source_name": source_name,
            "queries": list(queries),
            "source_calls": list(source_calls),
            "results_count": sum(len(c.get("items", [])) for c in source_calls),
            "raw_results": list(raw_results),
            "appended_at": utc_now(),
        }
        replaced = False
        for idx, existing in enumerate(iterations):
            if int(existing.get("iteration") or -1) == iteration:
                iterations[idx] = entry
                replaced = True
                break
        if not replaced:
            iterations.append(entry)
        job["iterations"] = iterations
        accumulated = [item for it in iterations for item in (it.get("raw_results") or [])]
        job["search_results"] = accumulated
        job["search_queries"] = sorted({q for it in iterations for q in (it.get("queries") or [])})
        job["source_urls"] = sorted({str(item.get("url")) for item in accumulated if item.get("url")})
        job["source_count"] = len(job["source_urls"])
        log_entries = list(job.get("research_log") or [])
        for call in source_calls:
            log_entries.append(
                {
                    "iteration": iteration,
                    "source_id": source_id,
                    "source_name": source_name,
                    "query": call.get("query"),
                    "results_count": len(call.get("items") or []),
                    "top_titles": [str(item.get("title") or "") for item in (call.get("items") or [])[:3]],
                    "duration_ms": int(call.get("duration_ms") or 0),
                    "error": call.get("error"),
                }
            )
        job["research_log"] = log_entries
        job["iteration"] = max(int(job.get("iteration") or 0), iteration)
        return self.save(job)

    def has_called(self, research_id: str, source_id: str, normalized_query: str) -> bool:
        job = self.load(research_id)
        for entry in job.get("research_log") or []:
            existing_query = str(entry.get("query") or "")
            if (
                str(entry.get("source_id") or "") == source_id
                and normalize_query_for_dedup(existing_query) == normalized_query
            ):
                return True
        return False

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

    def list_jobs(self, *, limit: int = 50) -> list[dict[str, Any]]:
        if not self.jobs_dir.exists():
            return []
        jobs: list[dict[str, Any]] = []
        for path in self.jobs_dir.glob("*.json"):
            try:
                with path.open("r", encoding="utf-8") as f:
                    data = json.load(f)
            except json.JSONDecodeError as exc:
                raise StoreError(f"malformed job record: {path.stem}") from exc
            if isinstance(data, dict) and data.get("research_id"):
                jobs.append(data)
        jobs.sort(key=lambda job: str(job.get("updated_at") or job.get("created_at") or ""), reverse=True)
        return jobs[: max(1, min(int(limit or 50), 200))]

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


def _normalize_section(section: dict[str, Any], idx: int) -> dict[str, Any]:
    if not isinstance(section, dict):
        raise ValidationError("section must be an object")
    section_id = str(section.get("id") or f"section-{idx + 1}").strip()
    title = str(section.get("title") or "").strip()
    outline = str(section.get("outline") or section.get("content") or "").strip()
    sources = section.get("allowed_source_ids") or section.get("allowed_sources") or []
    allowed = [str(source).strip() for source in sources if str(source or "").strip()]
    max_iterations = int(section.get("max_iterations") or 5)
    if not section_id:
        raise ValidationError("section id is required")
    if not title:
        raise ValidationError("section title is required")
    if not outline:
        raise ValidationError("section outline is required")
    if not 1 <= max_iterations <= 10:
        raise ValidationError("section max_iterations must be between 1 and 10", data={"section_id": section_id})
    return {
        "id": section_id,
        "title": title,
        "outline": outline,
        "allowed_source_ids": sorted(set(allowed)),
        "max_iterations": max_iterations,
    }


def _require_section(job: dict[str, Any], section_id: str) -> dict[str, Any]:
    clean = str(section_id or "").strip()
    if not clean:
        raise ValidationError("section_id is required")
    for section in job.get("confirmed_outline") or []:
        if str(section.get("id") or "") == clean:
            return section
    raise ValidationError("unknown section_id", data={"section_id": clean})


def _flatten_section_research_log(job: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for section_id, iterations in (job.get("section_iterations") or {}).items():
        for entry in iterations or []:
            for call in entry.get("source_calls") or []:
                out.append(
                    {
                        "section_id": section_id,
                        "iteration": entry.get("iteration"),
                        "source_id": entry.get("source_id"),
                        "source_name": entry.get("source_name"),
                        "query": call.get("query"),
                        "results_count": len(call.get("items") or []),
                        "top_titles": [str(item.get("title") or "") for item in (call.get("items") or [])[:3]],
                        "duration_ms": int(call.get("duration_ms") or 0),
                        "error": call.get("error"),
                    }
                )
    return out


def _all_section_source_urls(job: dict[str, Any]) -> list[str]:
    urls = set()
    for iterations in (job.get("section_iterations") or {}).values():
        for entry in iterations or []:
            for item in entry.get("raw_results") or []:
                url = str(item.get("url") or "")
                if url:
                    urls.add(url)
    for result in (job.get("section_results") or {}).values():
        for url in result.get("source_urls") or []:
            if url:
                urls.add(str(url))
    return sorted(urls)
