from __future__ import annotations

import io
import json
import os
from typing import Any

from .context_selector import LexicalContextSelector
from .errors import ConfigurationError, ValidationError
from .job_store import JobStore, normalize_query_for_dedup
from .result_transfer import LocalResultTransferServer
from .settings import SettingsStore, default_research_root
from .sources import (
    CredentialStore,
    EnvelopeError,
    ResearchSourceExecutor,
    ResearchSourceRegistry,
    validate_envelope,
    migrate_legacy_tavily_key,
)
from .views import compact_job_view, source_view, status_view


class _FakeResponse:
    def __init__(self, body: bytes):
        self._body = body
        self.status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self) -> bytes:
        return self._body


def _fake_tavily_http(request, timeout=None):
    """Synthesize Tavily-shaped responses when ANNA_RESEARCHER_FAKE_TAVILY=1.

    The real Tavily endpoint is never hit in fake mode; results are synthesized
    deterministically from the query so integration tests stay offline."""
    try:
        body = json.loads(request.data.decode("utf-8")) if getattr(request, "data", None) else {}
    except Exception:
        body = {}
    query = str(body.get("query") or "anna").strip() or "anna"
    payload = {
        "results": [
            {
                "url": f"https://example.test/{i}",
                "title": f"{query} result {i}",
                "content": f"Synthetic result {i} for query {query}.",
            }
            for i in range(1, 4)
        ]
    }
    return _FakeResponse(json.dumps(payload).encode("utf-8"))


class AppDispatcher:
    def __init__(
        self,
        *,
        settings: SettingsStore | None = None,
        jobs: JobStore | None = None,
        selector: LexicalContextSelector | None = None,
        transfer_server: LocalResultTransferServer | None = None,
        registry: ResearchSourceRegistry | None = None,
        credentials: CredentialStore | None = None,
        executor: ResearchSourceExecutor | None = None,
    ):
        self.settings = settings or SettingsStore()
        self.jobs = jobs or JobStore()
        self.selector = selector or LexicalContextSelector()
        self.transfer_server = transfer_server or LocalResultTransferServer(self.jobs)
        root = self.settings.root if hasattr(self.settings, "root") else default_research_root()
        self.credentials = credentials or CredentialStore(root)
        self.registry = registry or ResearchSourceRegistry(root, credentials=self.credentials)
        if executor is not None:
            self.executor = executor
        elif os.getenv("ANNA_RESEARCHER_FAKE_TAVILY") == "1":
            self.executor = ResearchSourceExecutor(token_provider=self._token_for, http_open=_fake_tavily_http)
        else:
            self.executor = ResearchSourceExecutor(token_provider=self._token_for)
        migrate_legacy_tavily_key(self.settings, self.credentials)

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
        if method == "app_save_confirmed_research_role":
            research_id = required_string(args, "research_id")
            role = args.get("role")
            if not isinstance(role, dict):
                raise ValidationError("role must be an object")
            return {"job": status_view(self.jobs.save_confirmed_role(research_id, role))}
        if method == "app_save_confirmed_research_focuses":
            research_id = required_string(args, "research_id")
            focuses = args.get("focuses")
            if not isinstance(focuses, list):
                raise ValidationError("focuses must be an array")
            return {"job": status_view(self.jobs.save_confirmed_focuses(research_id, focuses))}
        if method == "app_save_confirmed_research_outline":
            research_id = required_string(args, "research_id")
            sections = args.get("sections")
            if not isinstance(sections, list):
                raise ValidationError("sections must be an array")
            return {"job": compact_job_view(self.jobs.save_confirmed_outline(research_id, sections))}
        if method == "app_get_research_job":
            research_id = str(args.get("research_id") or "").strip()
            job = self.jobs.load(research_id) if research_id else self.jobs.load_latest()
            if not job:
                return {"job": None}
            view = status_view(job)
            view["job_transfer"] = self.transfer_server.job_descriptor(str(job.get("research_id")))
            if job.get("report_markdown"):
                view["result_transfer"] = self.transfer_server.result_descriptor(str(job.get("research_id")), method="GET")
            return {"job": view}
        if method == "app_list_research_sources":
            return {"sources": self.registry.list_views()}
        if method == "app_update_research_source_credential":
            return self._update_credential(args)
        if method == "app_set_research_source_enabled":
            return self._set_enabled(args)
        if method == "app_upsert_research_source":
            return self._upsert_source(args)
        if method == "app_delete_research_source":
            return self._delete_source(args)
        if method == "app_test_research_source":
            return self._test_source(args)
        if method == "app_call_research_source":
            return self._call_source(args)
        if method == "app_call_section_research_source":
            return self._call_section_source(args)
        if method == "app_select_context":
            return self._select_context(args)
        if method == "app_select_section_context":
            return self._select_section_context(args)
        if method == "app_save_section_result":
            return self._save_section_result(args)
        if method == "app_fail_section":
            research_id = required_string(args, "research_id")
            section_id = required_string(args, "section_id")
            return {"job": status_view(self.jobs.fail_section(research_id, section_id, args.get("error")))}
        if method == "app_save_report_framing":
            research_id = required_string(args, "research_id")
            self.jobs.load(research_id)
            return {"transfer": self.transfer_server.report_framing_descriptor(research_id)}
        if method == "app_save_assembled_research_result":
            research_id = required_string(args, "research_id")
            self.jobs.load(research_id)
            return {"transfer": self.transfer_server.assembled_result_descriptor(research_id)}
        if method == "app_save_research_result":
            return self._save_result(args)
        raise ValidationError(f"unknown app method: {method}")

    def _token_for(self, source_id: str) -> str:
        token = self.credentials.get_token(source_id)
        if token:
            return token
        if source_id == "tavily":
            env = os.getenv("TAVILY_API_KEY", "").strip()
            if env:
                return env
            legacy = self.settings.get_tavily_key()
            if legacy:
                return legacy
            if os.getenv("ANNA_RESEARCHER_FAKE_TAVILY") == "1":
                return "fake-tavily-token"
        return ""

    def _update_credential(self, args: dict[str, Any]) -> dict[str, Any]:
        source_id = required_string(args, "id")
        if not self._source_exists(source_id):
            raise ValidationError(f"unknown research source: {source_id}")
        if args.get("clear"):
            self.credentials.clear(source_id)
        else:
            credential = args.get("credential")
            if credential is None:
                raise ValidationError("credential is required")
            cleaned = str(credential).strip()
            if not cleaned:
                raise ValidationError("credential cannot be empty")
            self.credentials.set_token(source_id, cleaned)
        return {"source": self.registry.get_view(source_id)}

    def _set_enabled(self, args: dict[str, Any]) -> dict[str, Any]:
        source_id = required_string(args, "id")
        if not self._source_exists(source_id):
            raise ValidationError(f"unknown research source: {source_id}")
        enabled = bool(args.get("enabled"))
        view = self.registry.set_enabled(source_id, enabled)
        return {"source": view}

    def _upsert_source(self, args: dict[str, Any]) -> dict[str, Any]:
        definition = args.get("definition") or args
        view = self.registry.upsert_user_source(definition)
        credential = args.get("credential")
        if credential is not None:
            cleaned = str(credential).strip()
            if cleaned:
                self.credentials.set_token(view["id"], cleaned)
                view = self.registry.get_view(view["id"])
        return {"source": view}

    def _delete_source(self, args: dict[str, Any]) -> dict[str, Any]:
        source_id = required_string(args, "id")
        self.registry.delete_user_source(source_id)
        return {"id": source_id, "deleted": True}

    def _test_source(self, args: dict[str, Any]) -> dict[str, Any]:
        source_id = required_string(args, "id")
        query = required_string(args, "query")
        definition = args.get("definition")
        if not isinstance(definition, dict):
            raise ValidationError("definition must be an object")
        if not self._source_exists(source_id):
            raise ValidationError(f"unknown research source: {source_id}")

        test_definition = dict(definition)
        test_definition["id"] = source_id
        test_definition.setdefault("name", definition.get("name") or source_id)
        try:
            validate_envelope(test_definition, kind="builtin" if self.registry.is_builtin(source_id) else "user")
        except EnvelopeError:
            raise

        token = self._token_for(source_id)
        if not token:
            raise ConfigurationError(f"credential missing for source: {source_id}")

        result = self.executor.test(test_definition, query)
        test = {
            "source_id": result.source_id,
            "source_name": result.source_name,
            "query": result.query,
            "duration_ms": result.duration_ms,
            "pages": result.pages,
            "extracted": result.extracted,
            "error": result.error,
        }
        return {"test_transfer": self.transfer_server.source_test_descriptor(test)}

    def _call_source(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        source_id = required_string(args, "source_id")
        iteration = int(args.get("iteration") or 0)
        queries = normalize_queries(args.get("queries"))
        if not queries:
            raise ValidationError("queries is required")
        try:
            definition = self.registry.get_definition(source_id)
        except Exception as exc:
            raise ValidationError(f"unknown source: {source_id}") from exc

        token = self._token_for(source_id)
        if not token:
            raise ConfigurationError(f"credential missing for source: {source_id}")

        accepted_queries: list[str] = []
        for query in queries:
            normalized = normalize_query_for_dedup(query)
            if not normalized:
                continue
            if self.jobs.has_called(research_id, source_id, normalized):
                raise ValidationError(
                    "duplicate source call rejected",
                    data={"source_id": source_id, "query": query, "reason": "duplicate"},
                )
            accepted_queries.append(query)
        if not accepted_queries:
            raise ValidationError("queries must contain at least one new entry")

        call_summaries: list[dict[str, Any]] = []
        raw_results: list[dict[str, Any]] = []
        first_error: str | None = None
        for query in accepted_queries:
            result = self.executor.call(definition, query)
            error_code = result.error if result.error not in (None, "empty_result") else None
            if error_code and first_error is None:
                first_error = error_code
            summary = {
                "source_id": result.source_id,
                "source_name": result.source_name,
                "query": result.query,
                "results_count": len(result.items),
                "top_titles": [str(item.get("title") or "") for item in result.items[:3]],
                "duration_ms": result.duration_ms,
                "error": result.error,
                "items": result.items,
            }
            call_summaries.append(summary)
            raw_results.extend(result.items)

        job = self.jobs.append_iteration(
            research_id,
            iteration=iteration,
            source_id=source_id,
            source_name=str(definition.get("name") or source_id),
            queries=accepted_queries,
            source_calls=call_summaries,
            raw_results=raw_results,
        )
        return {
            "job": status_view(job),
            "source_call": {
                "source_id": source_id,
                "source_name": str(definition.get("name") or source_id),
                "queries": accepted_queries,
                "results_count": len(raw_results),
                "top_titles": [str(item.get("title") or "") for item in raw_results[:3]],
                "duration_ms": sum(int(c.get("duration_ms") or 0) for c in call_summaries),
                "error": first_error,
                "calls": [
                    {k: v for k, v in c.items() if k != "items"}
                    for c in call_summaries
                ],
            },
        }

    def _call_section_source(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        section_id = required_string(args, "section_id")
        source_id = required_string(args, "source_id")
        iteration = int(args.get("iteration") or 0)
        queries = normalize_queries(args.get("queries"))
        if not queries:
            raise ValidationError("queries is required")
        job = self.jobs.load(research_id)
        section = _find_section(job, section_id)
        allowed = set(section.get("allowed_source_ids") or [])
        if source_id not in allowed:
            raise ValidationError(
                "source is not allowed for section",
                data={"section_id": section_id, "source_id": source_id, "allowed_source_ids": sorted(allowed)},
            )
        try:
            definition = self.registry.get_definition(source_id)
        except Exception as exc:
            raise ValidationError(f"unknown source: {source_id}") from exc

        token = self._token_for(source_id)
        if not token:
            raise ConfigurationError(f"credential missing for source: {source_id}")

        accepted_queries: list[str] = []
        for query in queries:
            normalized = normalize_query_for_dedup(query)
            if not normalized:
                continue
            if self.jobs.has_section_called(research_id, section_id, source_id, normalized):
                raise ValidationError(
                    "duplicate section source call rejected",
                    data={"section_id": section_id, "source_id": source_id, "query": query, "reason": "duplicate"},
                )
            accepted_queries.append(query)
        if not accepted_queries:
            raise ValidationError("queries must contain at least one new entry")

        call_summaries: list[dict[str, Any]] = []
        raw_results: list[dict[str, Any]] = []
        first_error: str | None = None
        for query in accepted_queries:
            result = self.executor.call(definition, query)
            error_code = result.error if result.error not in (None, "empty_result") else None
            if error_code and first_error is None:
                first_error = error_code
            summary = {
                "source_id": result.source_id,
                "source_name": result.source_name,
                "query": result.query,
                "results_count": len(result.items),
                "top_titles": [str(item.get("title") or "") for item in result.items[:3]],
                "duration_ms": result.duration_ms,
                "error": result.error,
                "items": result.items,
            }
            call_summaries.append(summary)
            raw_results.extend(result.items)

        job = self.jobs.append_section_iteration(
            research_id,
            section_id=section_id,
            iteration=iteration,
            source_id=source_id,
            source_name=str(definition.get("name") or source_id),
            queries=accepted_queries,
            source_calls=call_summaries,
            raw_results=raw_results,
        )
        return {
            "job": status_view(job),
            "source_call": {
                "section_id": section_id,
                "source_id": source_id,
                "source_name": str(definition.get("name") or source_id),
                "queries": accepted_queries,
                "results_count": len(raw_results),
                "top_titles": [str(item.get("title") or "") for item in raw_results[:3]],
                "duration_ms": sum(int(c.get("duration_ms") or 0) for c in call_summaries),
                "error": first_error,
                "calls": [{k: v for k, v in c.items() if k != "items"} for c in call_summaries],
            },
        }

    def _select_context(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        job = self.jobs.load(research_id)
        search_results = args.get("search_results") or job.get("search_results") or []
        selected = self.selector.select(
            query=str(args.get("query") or job.get("query") or ""),
            search_queries=normalize_queries(args.get("search_queries") or job.get("search_queries") or [job.get("query")]),
            search_results=search_results,
        )
        job = self.jobs.save_selected_context(research_id, selected)
        return {"job": status_view(job), "context_transfer": self.transfer_server.context_descriptor(research_id)}

    def _select_section_context(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        section_id = required_string(args, "section_id")
        job = self.jobs.load(research_id)
        section = _find_section(job, section_id)
        iterations = (job.get("section_iterations") or {}).get(section_id, []) or []
        search_results = [
            item
            for iteration in iterations
            for item in (iteration.get("raw_results") or [])
        ]
        search_queries = sorted({query for iteration in iterations for query in (iteration.get("queries") or [])})
        selected = self.selector.select(
            query=f"{job.get('query')}\n\nSection: {section.get('title')}\n{section.get('outline')}",
            search_queries=search_queries or [job.get("query")],
            search_results=search_results,
        )
        job = self.jobs.save_section_selected_context(research_id, section_id, selected)
        return {
            "job": status_view(job),
            "context_transfer": self.transfer_server.section_context_descriptor(research_id, section_id),
        }

    def _save_section_result(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        section_id = required_string(args, "section_id")
        _find_section(self.jobs.load(research_id), section_id)
        return {"transfer": self.transfer_server.section_result_descriptor(research_id, section_id)}

    def _save_result(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        self.jobs.load(research_id)
        return {"transfer": self.transfer_server.descriptor(research_id)}

    def _source_exists(self, source_id: str) -> bool:
        try:
            self.registry.get_definition(source_id)
            return True
        except Exception:
            return False


def required_string(args: dict[str, Any], key: str) -> str:
    value = str(args.get(key) or "").strip()
    if not value:
        raise ValidationError(f"{key} is required")
    return value


def _find_section(job: dict[str, Any], section_id: str) -> dict[str, Any]:
    for section in job.get("confirmed_outline") or []:
        if str(section.get("id") or "") == section_id:
            return section
    raise ValidationError("unknown section_id", data={"section_id": section_id})


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
