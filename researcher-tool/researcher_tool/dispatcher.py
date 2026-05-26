from __future__ import annotations

import os
from typing import Any

from .context_selector import LexicalContextSelector
from .domains import normalize_domains
from .errors import ConfigurationError, ValidationError
from .job_store import JobStore
from .settings import SettingsStore
from .tavily_retrieval import TavilySummaryRetriever


class AppDispatcher:
    def __init__(
        self,
        *,
        settings: SettingsStore | None = None,
        jobs: JobStore | None = None,
        selector: LexicalContextSelector | None = None,
    ):
        self.settings = settings or SettingsStore()
        self.jobs = jobs or JobStore()
        self.selector = selector or LexicalContextSelector()

    def dispatch(self, method: str, args: dict[str, Any]) -> dict[str, Any]:
        if method == "app_get_settings":
            return {"settings": self.settings.view()}
        if method == "app_update_settings":
            return {
                "settings": self.settings.update(
                    tavily_api_key=args.get("tavily_api_key"),
                    clear_tavily_api_key=bool(args.get("clear_tavily_api_key")),
                )
            }
        if method == "app_create_research_job":
            return {"job": status_view(self.jobs.create(query=args.get("query"), query_domains=args.get("query_domains")))}
        if method == "app_update_research_job":
            research_id = required_string(args, "research_id")
            updates = args.get("updates")
            if not isinstance(updates, dict):
                raise ValidationError("updates must be an object")
            return {"job": status_view(self.jobs.update_metadata(research_id, updates))}
        if method == "app_get_research_job":
            research_id = str(args.get("research_id") or "").strip()
            job = self.jobs.load(research_id) if research_id else self.jobs.load_latest()
            return {"job": job_view(job) if job else None}
        if method == "app_search_web":
            return self._search_web(args)
        if method == "app_select_context":
            return self._select_context(args)
        if method == "app_save_research_result":
            return self._save_result(args)
        raise ValidationError(f"unknown app method: {method}")

    def _search_web(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        job = self.jobs.load(research_id)
        search_queries = normalize_queries(args.get("search_queries") or job.get("search_queries") or [job.get("query")])
        if not search_queries:
            search_queries = [str(job.get("query") or "")]
        query_domains = normalize_domains(args.get("query_domains", job.get("query_domains")))
        api_key = self.settings.get_tavily_key()
        if not api_key and os.getenv("ANNA_RESEARCHER_FAKE_TAVILY") != "1":
            raise ConfigurationError("Tavily API key is not configured")
        retriever = TavilySummaryRetriever(api_key=api_key)
        search_results = retriever.search_many(search_queries, query_domains=query_domains, max_results=int(args.get("max_results") or 5))
        job = self.jobs.save_search_results(research_id, search_queries=search_queries, search_results=search_results)
        return {
            "job": status_view(job),
            "search_queries": search_queries,
            "search_results": search_results,
            "source_urls": job.get("source_urls") or [],
        }

    def _select_context(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        job = self.jobs.load(research_id)
        selected = self.selector.select(
            query=str(args.get("query") or job.get("query") or ""),
            search_queries=normalize_queries(args.get("search_queries") or job.get("search_queries") or [job.get("query")]),
            search_results=args.get("search_results") or job.get("search_results") or [],
        )
        job = self.jobs.save_selected_context(research_id, selected)
        return {"job": status_view(job), **selected}

    def _save_result(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        result = {
            "report_markdown": args.get("report_markdown") or "",
            "source_urls": args.get("source_urls") or [],
            "selected_sources": args.get("selected_sources") or [],
            "status": args.get("status") or "completed",
            "stage": args.get("stage") or "completed",
            "progress": args.get("progress") or 100,
            "error": args.get("error"),
        }
        if not str(result["report_markdown"]).strip() and result["status"] == "completed":
            raise ValidationError("report_markdown is required for a completed result")
        job = self.jobs.save_result(research_id, result)
        return {"job": job_view(job), "result": result_view(job)}


def required_string(args: dict[str, Any], key: str) -> str:
    value = str(args.get(key) or "").strip()
    if not value:
        raise ValidationError(f"{key} is required")
    return value


def normalize_queries(value: Any) -> list[str]:
    if value is None:
        return []
    raw = value if isinstance(value, list) else [value]
    queries: list[str] = []
    for item in raw:
        text = str(item or "").strip()
        if text and text not in queries:
            queries.append(text)
    return queries


def status_view(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "research_id": job.get("research_id"),
        "status": job.get("status"),
        "stage": job.get("stage"),
        "progress": job.get("progress", 0),
        "query": job.get("query"),
        "report_type": "research_report",
        "source_count": len(job.get("source_urls") or []),
        "search_total": len(job.get("search_queries") or []),
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "completed_at": job.get("completed_at"),
    }


def result_view(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "research_id": job.get("research_id"),
        "status": job.get("status"),
        "query": job.get("query"),
        "report_type": "research_report",
        "report_markdown": job.get("report_markdown") or "",
        "source_urls": job.get("source_urls") or [],
        "sources": job.get("selected_sources") or [],
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "completed_at": job.get("completed_at"),
    }


def job_view(job: dict[str, Any]) -> dict[str, Any]:
    data = dict(job)
    data["result"] = result_view(job) if job.get("report_markdown") else None
    data["source_count"] = len(job.get("source_urls") or [])
    return data

