from __future__ import annotations

import io
import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from .attachments import prepare_attachments
from .aps_transfer import ApsJsonTransferStore, research_transfer_prefix, source_test_transfer_prefix
from .context_selector import LexicalContextSelector, build_selected_context
from .errors import ConfigurationError, ValidationError
from .hybrid_context_selector import HybridContextSelector
from .job_store import JobStore, normalize_query_for_dedup
from .settings import SettingsStore, default_research_root
from .sources import (
    CredentialStore,
    EnvelopeError,
    ResearchSourceExecutor,
    ResearchSourceRegistry,
    validate_envelope,
    migrate_legacy_tavily_key,
)
from .sources.native.executor import NativeResearchSourceExecutor
from .sources.extraction.tavily import enrich_tavily_items
from .views import compact_job_view, result_view, section_result_view, source_view, status_view
from .web_documents import WebDocumentStore

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
                "content": (
                    f"Synthetic result {i} for query {query}. "
                    "This offline fixture contains enough research context for selector tests, "
                    "including evidence summary, source framing, and report-relevant details. "
                    "It is intentionally verbose so production short-content filtering does not "
                    "discard every fake Tavily item during integration tests. "
                )
                * 2,
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
        transfers: ApsJsonTransferStore | None = None,
        registry: ResearchSourceRegistry | None = None,
        credentials: CredentialStore | None = None,
        executor: ResearchSourceExecutor | None = None,
        native_executor: NativeResearchSourceExecutor | None = None,
        web_documents: WebDocumentStore | None = None,
        embeddings: Any = None,
        tavily_enricher: Callable[..., list[dict[str, Any]]] | None = None,
    ):
        self.settings = settings or SettingsStore()
        self.jobs = jobs or JobStore()
        self.selector = selector
        self.transfers = transfers
        root = self.settings.root if hasattr(self.settings, "root") else default_research_root()
        self.credentials = credentials or CredentialStore(root)
        self.registry = registry or ResearchSourceRegistry(root, credentials=self.credentials)
        if executor is not None:
            self.executor = executor
        elif os.getenv("ANNA_RESEARCHER_FAKE_TAVILY") == "1":
            self.executor = ResearchSourceExecutor(token_provider=self._token_for, http_open=_fake_tavily_http)
        else:
            self.executor = ResearchSourceExecutor(token_provider=self._token_for)
        self.native_executor = native_executor or NativeResearchSourceExecutor()
        self.web_documents = web_documents or WebDocumentStore(self.jobs)
        self.tavily_enricher = tavily_enricher or enrich_tavily_items
        if self.selector is None:
            self.selector = HybridContextSelector(embeddings=embeddings, documents=self.web_documents) if embeddings is not None else LexicalContextSelector()
        migrate_legacy_tavily_key(self.settings, self.credentials)

    def dispatch(self, method: str, args: dict[str, Any]) -> dict[str, Any]:
        if method == "app_get_settings":
            return {"settings": self.settings.view()}
        if method == "app_create_research_job":
            return {"job": status_view(self.jobs.create(query=args.get("query"), query_domains=args.get("query_domains")))}
        if method == "app_update_research_job":
            research_id = required_string(args, "research_id")
            updates = args.get("updates")
            if not isinstance(updates, dict):
                raise ValidationError("updates must be an object")
            return {"job": status_view(self.jobs.update_metadata(research_id, updates))}
        if method == "app_prepare_attachments":
            return self._prepare_attachments(args)
        if method == "app_save_confirmed_research_role":
            research_id = required_string(args, "research_id")
            role = args.get("role")
            if not isinstance(role, dict):
                raise ValidationError("role must be an object")
            return {"job": status_view(self.jobs.save_confirmed_role(research_id, role))}
        if method == "app_save_confirmed_research_outline":
            research_id = required_string(args, "research_id")
            sections = args.get("sections")
            if not isinstance(sections, list):
                raise ValidationError("sections must be an array")
            return {"job": compact_job_view(self.jobs.save_confirmed_outline(research_id, sections))}
        if method == "app_get_research_job":
            research_id = str(args.get("research_id") or "").strip()
            job = self.jobs.load(research_id) if research_id else next(iter(self.jobs.list_jobs(limit=1)), None)
            return {"job": compact_job_view(job) if job else None}
        if method == "app_get_research_job_payload":
            research_id = required_string(args, "research_id")
            job = self.jobs.load(research_id)
            payload: dict[str, Any] = {"job": compact_job_view(job, include_section_markdown=True)}
            if job.get("report_markdown"):
                payload["result"] = result_view(job, include_sources=True)
            return {
                "transfer": self._require_transfers().upload(
                    prefix=research_transfer_prefix(research_id),
                    kind="job-payload",
                    payload=payload,
                )
            }
        if method == "app_list_research_jobs":
            limit = int(args.get("limit") or 50)
            return {"jobs": [status_view(job) for job in self.jobs.list_jobs(limit=limit)]}
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
        if method == "app_call_section_research_source":
            return self._call_section_source(args)
        if method == "app_select_section_context":
            return self._select_section_context(args)
        if method == "app_save_section_result":
            return self._save_section_result(args)
        if method == "app_get_section_result":
            return self._get_section_result(args)
        if method == "app_save_report_framing":
            return self._save_report_framing(args)
        if method == "app_save_assembled_research_result":
            return self._save_assembled_result(args)
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

    def _prepare_attachments(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        attachments = args.get("attachments")
        if not isinstance(attachments, list):
            raise ValidationError("attachments must be an array")
        self.jobs.load(research_id)
        context = prepare_attachments(
            research_id=research_id,
            job_dir=self.jobs.job_dir_for(research_id),
            attachments=attachments,
        )
        job = self.jobs.update_metadata(research_id, {"attachment_context": context})
        view = compact_job_view(job)
        view["attachment_context_summary"] = {
            "chunk_count": len(context.get("chunks") or []),
            "file_count": len(context.get("files") or []),
            "ready_file_count": sum(1 for file in (context.get("files") or []) if isinstance(file, dict) and file.get("status") == "ready"),
            "summary_chars": len(str(context.get("summary") or "")),
        }
        return {"job": view}

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
        if not self._is_native_source(test_definition):
            try:
                validate_envelope(test_definition, kind="builtin" if self.registry.is_builtin(source_id) else "user")
            except EnvelopeError:
                raise

        self._ensure_source_credential(source_id, test_definition)

        result = self._executor_for(test_definition).test(test_definition, query)
        test = {
            "source_id": result.source_id,
            "source_name": result.source_name,
            "query": result.query,
            "duration_ms": result.duration_ms,
            "pages": result.pages,
            "extracted": result.extracted,
            "error": result.error,
        }
        test_id = uuid.uuid4().hex
        transfer = self._require_transfers().upload(
            prefix=source_test_transfer_prefix(test_id),
            kind="source-test",
            payload={"test": test},
        )
        return {"test_transfer": transfer}

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

        self._ensure_source_credential(source_id, definition)

        accepted_queries: list[str] = []
        skipped_queries: list[str] = []
        for query in queries:
            normalized = normalize_query_for_dedup(query)
            if not normalized:
                continue
            if self.jobs.has_section_called(research_id, section_id, source_id, normalized):
                skipped_queries.append(query)
                continue
            accepted_queries.append(query)
        if not accepted_queries:
            job = self.jobs.load(research_id)
            return {
                "job": status_view(job),
                "source_call": {
                    "section_id": section_id,
                    "source_id": source_id,
                    "source_name": str(definition.get("name") or source_id),
                    "queries": [],
                    "skipped_queries": skipped_queries,
                    "results_count": 0,
                    "top_titles": [],
                    "duration_ms": 0,
                    "error": None,
                    "calls": [],
                },
            }

        call_summaries: list[dict[str, Any]] = []
        raw_results: list[dict[str, Any]] = []
        first_error: str | None = None
        executor = self._executor_for(definition)
        extraction_cache = self.web_documents.page_cache(research_id)

        def execute(query: str):
            if self._is_native_source(definition):
                return executor.call(definition, query, extraction_cache=extraction_cache)
            return executor.call(definition, query)

        max_workers = min(max(1, int(definition.get("max_parallel") or 1)), len(accepted_queries))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            query_results = list(pool.map(execute, accepted_queries))

        self._enrich_tavily_query_results(research_id, definition, query_results)

        for result in query_results:
            usable_items = _usable_result_items(result.items)
            error_code = result.error if result.error not in (None, "empty_result") else None
            if error_code and first_error is None:
                first_error = error_code
            summary = {
                "source_id": result.source_id,
                "source_name": result.source_name,
                "query": result.query,
                "results_count": len(usable_items),
                "candidate_count": len(result.items),
                "top_titles": [str(item.get("title") or "") for item in usable_items[:3]],
                "duration_ms": result.duration_ms,
                "error": result.error,
                "items": result.items,
            }
            call_summaries.append(summary)
            stored_items = self.web_documents.detach_contents(research_id, result.items) if self._stores_web_documents(definition) else result.items
            summary["items"] = stored_items
            raw_results.extend(stored_items)

        job = self.jobs.append_section_iteration(
            research_id,
            section_id=section_id,
            iteration=iteration,
            source_id=source_id,
            source_name=str(definition.get("name") or source_id),
            queries=accepted_queries,
            source_calls=call_summaries,
            raw_results=raw_results,
            research_decision=args.get("research_decision") if isinstance(args.get("research_decision"), dict) else None,
        )
        return {
            "job": status_view(job),
            "source_call": {
                "section_id": section_id,
                "source_id": source_id,
                "source_name": str(definition.get("name") or source_id),
                "queries": accepted_queries,
                "skipped_queries": skipped_queries,
                "results_count": len(_usable_result_items(raw_results)),
                "candidate_count": len(raw_results),
                "top_titles": [str(item.get("title") or "") for item in _usable_result_items(raw_results)[:3]],
                "duration_ms": sum(int(c.get("duration_ms") or 0) for c in call_summaries),
                "error": first_error,
                "calls": [{k: v for k, v in c.items() if k != "items"} for c in call_summaries],
            },
        }

    def _call_outline_discovery_source(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        source_id = required_string(args, "source_id")
        phase = str(args.get("phase") or "").strip()
        if phase not in {"seed", "research"}:
            raise ValidationError("phase must be seed or research")
        query_ids = _normalize_query_ids(args.get("query_ids"))
        if not query_ids:
            raise ValidationError("query_ids is required")
        job = self.jobs.load(research_id)
        query_plan = _outline_query_plan(job)
        unknown_query_ids = [query_id for query_id in query_ids if query_id not in query_plan]
        if unknown_query_ids:
            raise ValidationError("unknown outline query id", data={"query_ids": unknown_query_ids})
        try:
            definition = self.registry.get_definition(source_id)
        except Exception as exc:
            raise ValidationError(f"unknown source: {source_id}") from exc
        self._ensure_source_credential(source_id, definition)

        accepted_query_ids: list[str] = []
        skipped_query_ids: list[str] = []
        for query_id in query_ids:
            if self.jobs.has_outline_discovery_called(research_id, phase, source_id, query_id):
                skipped_query_ids.append(query_id)
            else:
                accepted_query_ids.append(query_id)
        if not accepted_query_ids:
            return {
                "job": status_view(self.jobs.load(research_id)),
                "source_call": {
                    "phase": phase,
                    "source_id": source_id,
                    "source_name": str(definition.get("name") or source_id),
                    "query_ids": [],
                    "skipped_query_ids": skipped_query_ids,
                    "results_count": 0,
                    "top_titles": [],
                    "duration_ms": 0,
                    "error": None,
                    "calls": [],
                },
            }

        call_summaries: list[dict[str, Any]] = []
        raw_results: list[dict[str, Any]] = []
        first_error: str | None = None
        executor = self._executor_for(definition)
        max_workers = min(max(1, int(definition.get("max_parallel") or 1)), len(accepted_query_ids))

        def execute(query_id: str):
            query = query_plan[query_id]
            if self._is_native_source(definition):
                return query_id, executor.call(definition, query, extraction_cache=self.web_documents.page_cache(research_id))
            return query_id, executor.call(definition, query)

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            query_results = list(pool.map(execute, accepted_query_ids))

        self._enrich_tavily_query_results(research_id, definition, [result for _query_id, result in query_results])

        for query_id, result in query_results:
            usable_items = _usable_result_items(result.items)
            error_code = result.error if result.error not in (None, "empty_result") else None
            if error_code and first_error is None:
                first_error = error_code
            summary = {
                "source_id": result.source_id,
                "source_name": result.source_name,
                "query_id": query_id,
                "results_count": len(usable_items),
                "candidate_count": len(result.items),
                "top_titles": [str(item.get("title") or "") for item in usable_items[:3]],
                "duration_ms": result.duration_ms,
                "error": result.error,
                "items": result.items,
            }
            stored_items = self.web_documents.detach_contents(research_id, result.items) if self._stores_web_documents(definition) else result.items
            stored_items = [{**{key: value for key, value in item.items() if key != "query"}, "query_id": query_id} for item in stored_items]
            summary["items"] = stored_items
            call_summaries.append(summary)
            raw_results.extend(stored_items)

        job = self.jobs.append_outline_discovery(
            research_id,
            phase=phase,
            source_id=source_id,
            source_name=str(definition.get("name") or source_id),
            query_ids=accepted_query_ids,
            source_calls=call_summaries,
            raw_results=raw_results,
        )
        return {
            "job": status_view(job),
            "source_call": {
                "phase": phase,
                "source_id": source_id,
                "source_name": str(definition.get("name") or source_id),
                "query_ids": accepted_query_ids,
                "skipped_query_ids": skipped_query_ids,
                "results_count": len(_usable_result_items(raw_results)),
                "candidate_count": len(raw_results),
                "top_titles": [str(item.get("title") or "") for item in _usable_result_items(raw_results)[:3]],
                "duration_ms": sum(int(call.get("duration_ms") or 0) for call in call_summaries),
                "error": first_error,
                "calls": [{key: value for key, value in call.items() if key != "items"} for call in call_summaries],
            },
        }

    def _select_outline_discovery(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        phase = str(args.get("phase") or "").strip()
        if phase not in {"seed", "research"}:
            raise ValidationError("phase must be seed or research")
        job = self.jobs.load(research_id)
        discovery = job.get("outline_discovery") or {}
        entries = [discovery.get("seed") or {}] if phase == "seed" else discovery.get("research_calls") or []
        query_plan = _outline_query_plan(job)
        search_results = [item for entry in entries for item in entry.get("raw_results") or []]
        query_ids = _unique_queries_in_order(query_id for entry in entries for query_id in entry.get("query_ids") or [])
        search_queries = [query_plan[query_id] for query_id in query_ids if query_id in query_plan]
        facet_queries = [
            str(facet.get("task") or "").strip()
            for facet in ((discovery.get("query_plan") or {}).get("facets") or [])
            if isinstance(facet, dict) and str(facet.get("task") or "").strip()
        ]
        selected = self.selector.select(
            query=str(args.get("query") or "").strip() or str(job.get("query") or ""),
            search_queries=(facet_queries if phase == "seed" and facet_queries else normalize_queries(args.get("search_queries")) or search_queries or [job.get("query")]),
            search_results=search_results,
            research_id=research_id,
            diversify_queries=phase == "seed",
        )
        self.jobs.save_outline_discovery_context(research_id, phase, selected)
        return selected

    def _select_section_context(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        section_id = required_string(args, "section_id")
        job = self.jobs.load(research_id)
        section = _find_section(job, section_id)
        iterations = (job.get("section_iterations") or {}).get(section_id, []) or []
        iteration_filter = args.get("iteration")
        if iteration_filter is not None:
            try:
                requested_iteration = int(iteration_filter)
            except (TypeError, ValueError) as exc:
                raise ValidationError("iteration must be an integer") from exc
            if requested_iteration < 1:
                raise ValidationError("iteration must be at least 1")
            iterations = [entry for entry in iterations if int(entry.get("iteration") or 0) == requested_iteration]
        search_results = [
            item
            for iteration in iterations
            for item in (iteration.get("raw_results") or [])
        ]
        search_queries = _unique_queries_in_order(query for iteration in iterations for query in (iteration.get("queries") or []))
        query_override = str(args.get("query") or "").strip()
        search_query_override = normalize_queries(args.get("search_queries"))
        selected = self.selector.select(
            query=query_override or f"{job.get('query')}\n\nSection: {section.get('title')}\n{section.get('outline')}",
            search_queries=search_query_override or search_queries or [job.get("query")],
            search_results=search_results,
            research_id=research_id,
        )
        job = self.jobs.save_section_selected_context(research_id, section_id, selected)
        stored_context = (job.get("section_selected_context") or {}).get(section_id) or {}
        selected_sources = stored_context.get("selected_sources") or []
        context_payload = {
            "selected_context": build_selected_context(selected_sources),
            "selected_sources": selected_sources,
            "source_urls": stored_context.get("source_urls") or [],
            "selected_at": stored_context.get("selected_at"),
        }
        return {
            "job": status_view(job),
            "context_transfer": self._require_transfers().upload(
                prefix=research_transfer_prefix(research_id),
                kind=f"section-context-{section_id}",
                payload=context_payload,
            ),
        }

    def _save_section_result(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        section_id = required_string(args, "section_id")
        existing_job = self.jobs.load(research_id)
        _find_section(existing_job, section_id)
        descriptor = args.get("payload_transfer")
        body = self._require_transfers().download_json(descriptor, expected_prefix=research_transfer_prefix(research_id))
        if str(body.get("research_id") or "") != research_id or str(body.get("section_id") or "") != section_id:
            raise ValidationError("section result payload identifiers do not match the control request")
        existing = ((existing_job.get("section_results") or {}).get(section_id) or {})
        status = str(body.get("status") or "completed")
        markdown = str(body.get("section_markdown") or "")
        if status == "completed" and not markdown.strip():
            raise ValidationError("section_markdown is required for a completed section result")
        result = {
            "status": status,
            "section_markdown": markdown,
            "section_summary": body.get("section_summary"),
            "subsection_headers": body.get("subsection_headers") if "subsection_headers" in body else existing.get("subsection_headers"),
            "source_urls": body.get("source_urls") or [],
            "citation_sources": body.get("citation_sources") or [],
            "error": body.get("error"),
        }
        job = self.jobs.save_section_result(research_id, section_id, result)
        self._require_transfers().delete_best_effort(descriptor)
        section = (job.get("section_results") or {}).get(section_id) or {}
        return {"job": compact_job_view(job), "section_result": section_result_view(section, include_markdown=True)}

    def _get_section_result(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        section_id = required_string(args, "section_id")
        job = self.jobs.load(research_id)
        section = (job.get("section_results") or {}).get(section_id)
        if not isinstance(section, dict):
            raise ValidationError(f"section result not found: {section_id}")
        transfer = self._require_transfers().upload(
            prefix=research_transfer_prefix(research_id),
            kind=f"section-result-{section_id}",
            payload={"section_result": section_result_view(section, include_markdown=True)},
        )
        return {"transfer": transfer}

    def _save_report_framing(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        descriptor = args.get("payload_transfer")
        body = self._require_transfers().download_json(descriptor, expected_prefix=research_transfer_prefix(research_id))
        if str(body.get("research_id") or "") != research_id:
            raise ValidationError("report framing payload research_id does not match the control request")
        framing = body.get("framing")
        if not isinstance(framing, dict):
            raise ValidationError("framing must be an object")
        job = self.jobs.save_report_framing(research_id, framing)
        self._require_transfers().delete_best_effort(descriptor)
        return {"job": compact_job_view(job)}

    def _save_assembled_result(self, args: dict[str, Any]) -> dict[str, Any]:
        research_id = required_string(args, "research_id")
        existing = self.jobs.load(research_id)
        descriptor = args.get("payload_transfer")
        body = self._require_transfers().download_json(descriptor, expected_prefix=research_transfer_prefix(research_id))
        if str(body.get("research_id") or "") != research_id:
            raise ValidationError("assembled result payload research_id does not match the control request")
        report = str(body.get("report_markdown") or "")
        if not report.strip():
            raise ValidationError("report_markdown is required for a completed assembled result")
        result = {
            "report_markdown": report,
            "source_urls": body.get("source_urls") or existing.get("source_urls") or [],
            "citation_sources": body.get("citation_sources") or existing.get("citation_sources") or [],
            "status": "completed",
            "stage": "completed",
            "progress": 100,
            "error": None,
        }
        job = self.jobs.save_assembled_result(research_id, result)
        self._require_transfers().delete_best_effort(descriptor)
        return {"job": compact_job_view(job), "result": result_view(job, include_sources=True)}

    def _require_transfers(self) -> ApsJsonTransferStore:
        if self.transfers is None:
            raise ValidationError("APS Files transfer capability is unavailable")
        return self.transfers

    def _source_exists(self, source_id: str) -> bool:
        try:
            self.registry.get_definition(source_id)
            return True
        except Exception:
            return False

    def _ensure_source_credential(self, source_id: str, definition: dict[str, Any]) -> None:
        if definition.get("credential_required") is False:
            return
        token = self._token_for(source_id)
        if not token:
            raise ConfigurationError(f"credential missing for source: {source_id}")

    def _executor_for(self, definition: dict[str, Any]):
        if self._is_native_source(definition):
            return self.native_executor
        return self.executor

    @staticmethod
    def _is_native_source(definition: dict[str, Any]) -> bool:
        return isinstance(definition.get("native"), dict)

    @staticmethod
    def _stores_web_documents(definition: dict[str, Any]) -> bool:
        return AppDispatcher._is_native_source(definition) or str(definition.get("id") or "") == "tavily"

    def _enrich_tavily_query_results(self, research_id: str, definition: dict[str, Any], results: list[Any]) -> None:
        if str(definition.get("id") or "") != "tavily" or not results:
            return
        counts = [len(result.items) for result in results]
        flattened = [item for result in results for item in result.items]
        enriched = self.tavily_enricher(flattened, page_cache=self.web_documents.page_cache(research_id))
        offset = 0
        for result, count in zip(results, counts):
            result.items = enriched[offset:offset + count]
            if result.items and not _usable_result_items(result.items):
                result.error = "empty_result"
            offset += count


def required_string(args: dict[str, Any], key: str) -> str:
    value = str(args.get(key) or "").strip()
    if not value:
        raise ValidationError(f"{key} is required")
    return value


def _usable_result_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in items if str(item.get("extraction_status") or "success").lower() == "success"]


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


def _normalize_query_ids(value: Any) -> list[str]:
    if value is None:
        return []
    raw = value if isinstance(value, list) else [value]
    return list(dict.fromkeys(str(item or "").strip() for item in raw if str(item or "").strip()))


def _outline_query_plan(job: dict[str, Any]) -> dict[str, str]:
    discovery = job.get("outline_discovery") or {}
    query_plan = discovery.get("query_plan") or {}
    queries = query_plan.get("queries") or []
    result = {
        str(item.get("id") or "").strip(): str(item.get("text") or "").strip()
        for item in queries
        if isinstance(item, dict) and str(item.get("id") or "").strip() and str(item.get("text") or "").strip()
    }
    if not result:
        raise ValidationError("outline query plan is missing")
    return result


def _unique_queries_in_order(values: Any) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        clean = str(value or "").strip()
        key = normalize_query_for_dedup(clean)
        if clean and key not in seen:
            seen.add(key)
            output.append(clean)
    return output
