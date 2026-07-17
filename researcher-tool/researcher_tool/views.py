from __future__ import annotations

from typing import Any


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
        "iteration": int(job.get("iteration") or 0),
        "max_iterations": int(job.get("max_iterations") or 5),
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "completed_at": job.get("completed_at"),
    }


def result_view(
    job: dict[str, Any],
    *,
    include_sources: bool = True,
    include_markdown: bool = True,
) -> dict[str, Any]:
    data = {
        "research_id": job.get("research_id"),
        "status": job.get("status"),
        "query": job.get("query"),
        "report_type": "research_report",
        "source_urls": job.get("source_urls") or [],
        "citation_sources": job.get("citation_sources") or [],
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "completed_at": job.get("completed_at"),
    }
    markdown = job.get("report_markdown") or ""
    if include_markdown:
        data["report_markdown"] = markdown
    else:
        data["report_markdown_chars"] = len(markdown)
    if include_sources:
        data["sources"] = selected_sources_for_result(job)
    return data


def compact_job_view(job: dict[str, Any], *, include_section_markdown: bool = False) -> dict[str, Any]:
    data = status_view(job)
    data["query_domains"] = job.get("query_domains") or []
    data["agent_name"] = job.get("agent_name") or ""
    data["agent_role_prompt"] = job.get("agent_role_prompt") or ""
    data["search_queries"] = job.get("search_queries") or []
    data["source_count"] = len(job.get("source_urls") or [])
    data["iterations"] = [iteration_view(it) for it in (job.get("iterations") or [])]
    data["iteration"] = int(job.get("iteration") or 0)
    data["max_iterations"] = int(job.get("max_iterations") or 5)
    data["enabled_sources"] = job.get("enabled_sources") or []
    data["schema_version"] = int(job.get("schema_version") or 1)
    data["workflow"] = job.get("workflow") or ("legacy" if int(job.get("schema_version") or 1) < 2 else "sectioned_research")
    data["confirmed_role"] = job.get("confirmed_role")
    data["confirmed_outline"] = job.get("confirmed_outline") or []
    data["active_section_index"] = job.get("active_section_index")
    data["research_options"] = job.get("research_options") or {}
    data["section_source_curations"] = job.get("section_source_curations") or {}
    discovery = job.get("outline_discovery") or {}
    discovery_contexts = discovery.get("selected_contexts") or {}
    research_context = discovery_contexts.get("research") or {}
    seed = discovery.get("seed") or {}
    research_calls = discovery.get("research_calls") or []
    query_plan = discovery.get("query_plan") or {}
    data["outline_discovery"] = {
        "status": discovery.get("status"),
        "facets": query_plan.get("facets") or [],
        "query_count": len(query_plan.get("queries") or []),
        "facet_count": len(query_plan.get("facets") or []),
        "result_count": int(seed.get("results_count") or 0) + sum(int(entry.get("results_count") or 0) for entry in research_calls),
        "selected_source_count": int(research_context.get("selected_sources_count") or 0),
        "updated_at": discovery.get("updated_at"),
    } if discovery else None
    data["section_iterations"] = {
        section_id: [iteration_summary_view(it) for it in (iterations or [])]
        for section_id, iterations in (job.get("section_iterations") or {}).items()
    }
    data["section_selected_context"] = {
        section_id: {
            "source_count": len(context.get("source_urls") or []),
            "selected_at": context.get("selected_at"),
            "selected_context_chars": int(context.get("selected_context_chars") or 0),
            "selected_sources_count": int(context.get("selected_sources_count") or 0),
        }
        for section_id, context in (job.get("section_selected_context") or {}).items()
        if isinstance(context, dict)
    }
    data["section_results"] = {
        section_id: (
            section_result_view(result, include_markdown=True)
            if include_section_markdown
            else compact_section_result_view(result)
        )
        for section_id, result in (job.get("section_results") or {}).items()
        if isinstance(result, dict)
    }
    data["report_framing"] = job.get("report_framing")
    data["assembled_result"] = job.get("assembled_result")
    data["attachments"] = job.get("attachments") or []
    attachment_context = _compact_attachment_context(job.get("attachment_context"))
    if attachment_context:
        data["attachment_context"] = attachment_context
    data["result"] = compact_result_view(job) if job.get("report_markdown") else None
    return data


def _compact_attachment_context(context: Any) -> dict[str, Any] | None:
    if not isinstance(context, dict) or not context.get("summary"):
        return None
    files = []
    for file in context.get("files") or []:
        if not isinstance(file, dict):
            continue
        files.append(
            {
                "id": file.get("id"),
                "name": file.get("name"),
                "status": file.get("status"),
                "chunk_count": file.get("chunk_count"),
                "analysis": file.get("analysis") if isinstance(file.get("analysis"), dict) else None,
            }
        )
    return {
        "version": context.get("version") or 1,
        "prepared_at": context.get("prepared_at") or "",
        "files": files,
        "chunks": [],
        "summary": context.get("summary") or "",
        "embedding_model": context.get("embedding_model"),
        "embedding_batch_size": context.get("embedding_batch_size"),
        "embedding_status": context.get("embedding_status"),
        "summary_status": context.get("summary_status"),
        "summary_mode": context.get("summary_mode"),
        "summary_query": context.get("summary_query"),
        "summary_top_k": context.get("summary_top_k"),
        "summary_generated_at": context.get("summary_generated_at"),
    }


def section_result_view(result: dict[str, Any], *, include_markdown: bool = False) -> dict[str, Any]:
    markdown = result.get("section_markdown") or ""
    data = {
        "section_id": result.get("section_id"),
        "status": result.get("status"),
        "section_summary": result.get("section_summary") or "",
        "subsection_headers": result.get("subsection_headers") or [],
        "source_urls": result.get("source_urls") or [],
        "citation_sources": result.get("citation_sources") or [],
        "error": result.get("error"),
        "completed_at": result.get("completed_at"),
        "updated_at": result.get("updated_at"),
    }
    if include_markdown:
        data["section_markdown"] = markdown
    else:
        data["section_markdown_chars"] = len(markdown)
    return data


def compact_section_result_view(result: dict[str, Any]) -> dict[str, Any]:
    markdown = result.get("section_markdown") or ""
    source_urls = result.get("source_urls") or []
    citation_sources = result.get("citation_sources") or []
    attachment_count = sum(
        1
        for source in citation_sources
        if isinstance(source, dict) and source.get("kind") == "attachment"
    )
    return {
        "section_id": result.get("section_id"),
        "status": result.get("status"),
        "section_summary": result.get("section_summary") or "",
        "subsection_headers": result.get("subsection_headers") or [],
        "source_count": len(source_urls),
        "citation_source_count": len(citation_sources),
        "attachment_citation_count": attachment_count,
        "url_citation_count": len(citation_sources) - attachment_count,
        "error": result.get("error"),
        "completed_at": result.get("completed_at"),
        "updated_at": result.get("updated_at"),
        "section_markdown_chars": len(markdown),
    }


def compact_result_view(job: dict[str, Any]) -> dict[str, Any]:
    markdown = job.get("report_markdown") or ""
    source_urls = job.get("source_urls") or []
    citation_sources = job.get("citation_sources") or []
    attachment_count = sum(
        1
        for source in citation_sources
        if isinstance(source, dict) and source.get("kind") == "attachment"
    )
    return {
        "research_id": job.get("research_id"),
        "status": job.get("status"),
        "query": job.get("query"),
        "report_type": "research_report",
        "source_count": len(source_urls),
        "citation_source_count": len(citation_sources),
        "attachment_citation_count": attachment_count,
        "url_citation_count": len(citation_sources) - attachment_count,
        "report_markdown_chars": len(markdown),
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "completed_at": job.get("completed_at"),
    }


def iteration_view(entry: dict[str, Any]) -> dict[str, Any]:
    """Public view of one iteration entry; ``raw_results`` is never exposed."""
    return {
        "iteration": int(entry.get("iteration") or 0),
        "source_id": entry.get("source_id") or "",
        "source_name": entry.get("source_name") or "",
        "queries": entry.get("queries") or [],
        "results_count": int(entry.get("results_count") or 0),
        "source_calls": [
            {k: v for k, v in (call or {}).items() if k != "items"}
            for call in (entry.get("source_calls") or [])
        ],
        "research_decision": entry.get("research_decision"),
        "appended_at": entry.get("appended_at"),
    }


def iteration_summary_view(entry: dict[str, Any]) -> dict[str, Any]:
    """Small section timeline summary for task loading.

    Full section iteration records can grow quickly because each iteration keeps
    raw search material for resume and context selection. Library/task loading
    only needs enough data to show progress, so avoid returning per-query call
    details in the default compact job view.
    """
    return {
        "iteration": int(entry.get("iteration") or 0),
        "source_id": entry.get("source_id") or "",
        "source_name": entry.get("source_name") or "",
        "queries": entry.get("queries") or [],
        "results_count": int(entry.get("results_count") or 0),
        "research_decision": entry.get("research_decision"),
        "appended_at": entry.get("appended_at"),
    }


def source_view(source: dict[str, Any]) -> dict[str, Any]:
    return dict(source)


def selected_sources_for_result(job: dict[str, Any]) -> list[dict[str, Any]]:
    source_urls = [str(url or "") for url in (job.get("source_urls") or []) if str(url or "").strip()]
    by_url: dict[str, dict[str, Any]] = {}
    loose: list[dict[str, Any]] = []

    def add(source: dict[str, Any]) -> None:
        item = dict(source or {})
        url = str(item.get("url") or "").strip()
        if url:
            current = by_url.get(url) or {}
            by_url[url] = {**item, **{key: value for key, value in current.items() if value}}
        else:
            loose.append(item)

    for source in job.get("selected_sources") or []:
        if isinstance(source, dict):
            add(source)
    for context in (job.get("section_selected_context") or {}).values():
        if not isinstance(context, dict):
            continue
        for source in context.get("selected_sources") or []:
            if isinstance(source, dict):
                add(source)

    ordered = [by_url[url] for url in source_urls if url in by_url]
    extra = [source for url, source in by_url.items() if url not in set(source_urls)]
    return ordered + extra + loose


def job_view(job: dict[str, Any]) -> dict[str, Any]:
    data = dict(job)
    data["result"] = result_view(job) if job.get("report_markdown") else None
    data["source_count"] = len(job.get("source_urls") or [])
    return data
