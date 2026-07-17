from __future__ import annotations

from datetime import datetime
import json
import re
from typing import Any

from .context_selector import build_selected_context
from .errors import ValidationError
from .sampling import AnnaSamplingClient, sampling_text
from .views import status_view


ATTACHMENT_SEARCH_BASELINE_MAX_CHARS = 3500
ATTACHMENT_EVIDENCE_POLICY = (
    "Use this analysis as supporting evidence only when the claim is directly grounded in visible content. "
    "Do not use it to verify external facts, dates, source credibility, or causal explanations unless those "
    "are explicitly visible in the attachment content."
)


def generate_outline_draft(
    *,
    dispatcher: Any,
    sampling: AnnaSamplingClient,
    research_id: str,
    source_ids: list[str],
    instruction: str = "",
    reuse_discovery: bool = False,
    invoke_id: str = "",
) -> dict[str, Any]:
    job = dispatcher.jobs.load(research_id)
    role = job.get("confirmed_role") or {}
    role_prompt = str(role.get("agent_role_prompt") or "").strip()
    if not role_prompt:
        raise ValidationError("confirmed research role is required before outline discovery")
    sources = _normalize_source_ids(source_ids)
    if not sources:
        raise ValidationError("at least one enabled research source is required")

    research_need = _normalize_research_need(str(job.get("query") or ""))
    if not research_need:
        raise ValidationError("research need is empty")
    current_date = datetime.now().date().isoformat()
    attachment_baseline = _attachment_search_baseline(job)

    discovery = job.get("outline_discovery") or {}
    query_plan = discovery.get("query_plan") or {}
    facets = query_plan.get("facets") or []
    selected_research = (discovery.get("selected_contexts") or {}).get("research") or {}
    if not (reuse_discovery and facets and selected_research.get("selected_sources")):
        dispatcher.jobs.reset_outline_discovery(research_id)
        anchor_query, facets = _plan_anchor(
            sampling,
            research_need=research_need,
            attachment_baseline=attachment_baseline,
            current_date=current_date,
            invoke_id=invoke_id,
            research_id=research_id,
        )
        dispatcher.jobs.save_outline_query_plan(
            research_id,
            anchor_query=anchor_query,
            facets=facets,
            sub_queries=[],
        )

        seed_source = "tavily" if "tavily" in sources else sources[0]
        dispatcher._call_outline_discovery_source({
            "research_id": research_id,
            "source_id": seed_source,
            "phase": "seed",
            "query_ids": ["anchor"],
        })
        seed_selected = dispatcher._select_outline_discovery({"research_id": research_id, "phase": "seed"})
        seed_context = _format_seed_context(seed_selected.get("selected_sources") or [], len(facets))

        sub_queries = _plan_sub_queries(
            sampling,
            research_need=research_need,
            anchor_query=anchor_query,
            facets=facets,
            seed_context=seed_context,
            attachment_baseline=attachment_baseline,
            current_date=current_date,
            invoke_id=invoke_id,
            research_id=research_id,
        )
        dispatcher.jobs.save_outline_query_plan(
            research_id,
            anchor_query=anchor_query,
            facets=facets,
            sub_queries=sub_queries,
        )
        query_ids = [item["id"] for item in sub_queries] + ["anchor"]
        for source_id in sources:
            dispatcher._call_outline_discovery_source({
                "research_id": research_id,
                "source_id": source_id,
                "phase": "research",
                "query_ids": query_ids,
            })
        selected_research = dispatcher._select_outline_discovery({"research_id": research_id, "phase": "research"})
    else:
        selected_research = {
            "selected_sources": selected_research.get("selected_sources") or [],
            "source_urls": selected_research.get("source_urls") or [],
        }

    evidence_context = _strip_chunk_markers(build_selected_context(selected_research.get("selected_sources") or []))
    sections = _plan_outline(
        sampling,
        research_task=_prompt_query_for_job(job),
        role_prompt=role_prompt,
        facets=facets,
        evidence_context=evidence_context,
        instruction=instruction,
        current_date=current_date,
        invoke_id=invoke_id,
        research_id=research_id,
    )
    return {
        "job": status_view(dispatcher.jobs.load(research_id)),
        "outline": sections,
    }


def _plan_anchor(
    sampling: AnnaSamplingClient,
    *,
    research_need: str,
    attachment_baseline: str,
    current_date: str,
    invoke_id: str,
    research_id: str,
) -> tuple[str, list[dict[str, str]]]:
    prompt = (
        f"Current date: {current_date}.\n"
        'Return exactly: {"anchor_query":"...","facets":[{"task":"..."}]}.\n'
        "The anchor_query must be one directly searchable line of at most 160 characters. Preserve core entities, timeframe, geography, and comparison targets; remove report format, length, role, and writing instructions. "
        "Facets are the complete user-requested task ledger. Preserve every explicit sub-task and constraint; merge only clearly overlapping tasks. Return 1 to 12 facets. "
        "Do not add facts or silently omit lower-priority requests. Attachment evidence may clarify search wording and known gaps, but must not add facets the user did not request. "
        "Do not include markdown or extra keys.\n\n"
        f"Research need:\n{research_need}\n\n"
        f"Uploaded attachment evidence baseline:\n{attachment_baseline or '(none)'}"
    )
    for attempt in range(2):
        parsed = _sample_json(
            sampling,
            system_prompt="Extract a search anchor and a complete task ledger for a research brief. Return strict JSON only.",
            prompt=prompt,
            max_tokens=1400,
            invoke_id=invoke_id,
            research_id=research_id,
            stage=f"outline_anchor_{attempt + 1}",
        )
        anchor = " ".join(str(parsed.get("anchor_query") or "").split())
        facets = [
            {"id": f"f{index + 1}", "task": " ".join(str(item.get("task") or "").split())}
            for index, item in enumerate(parsed.get("facets") or [])
            if isinstance(item, dict) and str(item.get("task") or "").strip()
        ]
        if anchor and len(anchor) <= 160 and 1 <= len(facets) <= 12:
            return anchor, facets
    raise ValidationError("Anna Sampling did not return a valid anchor query and task facet plan")


def _plan_sub_queries(
    sampling: AnnaSamplingClient,
    *,
    research_need: str,
    anchor_query: str,
    facets: list[dict[str, str]],
    seed_context: str,
    attachment_baseline: str,
    current_date: str,
    invoke_id: str,
    research_id: str,
) -> list[dict[str, Any]]:
    target_count = max(3, min(6, len(facets)))
    prompt = (
        f"Current date: {current_date}.\n"
        f'Return exactly {target_count} queries using this schema: {{"queries":[{{"text":"...","covers":["f1"]}}]}}.\n'
        "Every facet id must appear in at least one covers array. Queries must be distinct, ordered by research priority, directly searchable, and no longer than 180 characters. "
        "A query may cover multiple related facets. Use attachment evidence to avoid redundant searches and prioritize missing context, independent corroboration, source provenance, current developments, and conflicting evidence. "
        "Do not place attachment text or file names into a query unless they are themselves part of the user's requested subject. Do not repeat the anchor query, assume preliminary leads are true, or include markdown.\n\n"
        f"Research need:\n{research_need}\n\nAnchor query:\n{anchor_query}\n\nFacets:\n{json.dumps(facets, ensure_ascii=False)}\n\n"
        f"Uploaded attachment evidence baseline:\n{attachment_baseline or '(none)'}\n\n"
        f"Seed search context:\n{seed_context or '(seed search returned no usable context; derive queries from the task ledger)'}"
    )
    facet_ids = {item["id"] for item in facets}
    for attempt in range(2):
        parsed = _sample_json(
            sampling,
            system_prompt="Generate facet-covering web search queries. Return strict JSON only.",
            prompt=prompt,
            max_tokens=1800,
            invoke_id=invoke_id,
            research_id=research_id,
            stage=f"outline_sub_queries_{attempt + 1}",
        )
        queries: list[dict[str, Any]] = []
        for index, item in enumerate(parsed.get("queries") or []):
            if not isinstance(item, dict):
                continue
            text = " ".join(str(item.get("text") or "").split())
            covers = list(dict.fromkeys(str(value) for value in (item.get("covers") or []) if str(value) in facet_ids))
            if text and len(text) <= 180 and covers:
                queries.append({"id": f"sub_{index + 1}", "text": text, "covers": covers})
        texts = {item["text"].lower() for item in queries}
        covered = {facet_id for item in queries for facet_id in item["covers"]}
        if len(queries) == target_count and len(texts) == len(queries) and anchor_query.lower() not in texts and facet_ids <= covered:
            return queries
    raise ValidationError("Anna Sampling did not return valid search queries covering every research task facet")


def _plan_outline(
    sampling: AnnaSamplingClient,
    *,
    research_task: str,
    role_prompt: str,
    facets: list[dict[str, str]],
    evidence_context: str,
    instruction: str,
    current_date: str,
    invoke_id: str,
    research_id: str,
) -> list[dict[str, Any]]:
    prompt = (
        'Draft 4 to 6 report sections. Return strict JSON only: {"sections":[{"title":"...","outline":"...","covers":["f1"],"max_iterations":5}]}.\n'
        "Do not assign sources in this call. Every supplied facet must appear in at least one section's covers array. "
        "Treat each section as a top-level subtopic task: its outline must define the research objective, scope, and boundary with adjacent sections, not draft subsection headers. "
        "Sections may cover multiple related facets, but must remain distinct, progressive, and non-overlapping. "
        "Treat web discovery as preliminary evidence leads, not verified facts. Apart from numbers explicitly supplied by the user or needed to define a timeframe or research scope, do not put retrieved figures, forecasts, market shares, price targets, or other unverified numeric claims into titles or outlines as established conclusions.\n"
        f"Current date: {current_date}.\n"
        + (f"Regeneration requirement: {instruction}\n" if instruction else "")
        + f"Task:\n{research_task}\n\nRequired task facets:\n{json.dumps(facets, ensure_ascii=False)}"
        + (f"\n\nSelected web discovery context:\n{evidence_context}" if evidence_context else "\n\nNo usable web discovery context was available; plan from the task only.")
    )
    facet_ids = {item["id"] for item in facets}
    for attempt in range(2):
        parsed = _sample_json(
            sampling,
            system_prompt=role_prompt,
            prompt=prompt,
            max_tokens=2600,
            invoke_id=invoke_id,
            research_id=research_id,
            stage=f"outline_draft_{attempt + 1}",
        )
        sections = []
        for index, item in enumerate(parsed.get("sections") or []):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            outline = str(item.get("outline") or item.get("content") or "").strip()
            covers = list(dict.fromkeys(str(value) for value in (item.get("covers") or []) if str(value) in facet_ids))
            if title and outline:
                sections.append({
                    "id": f"section-{index + 1}",
                    "title": title,
                    "outline": outline,
                    "facet_ids": covers,
                    "allowed_source_ids": [],
                    "max_iterations": _bounded_iterations(item.get("max_iterations")),
                })
        covered = {facet_id for section in sections for facet_id in section["facet_ids"]}
        if 4 <= len(sections) <= 6 and facet_ids <= covered:
            return sections
    raise ValidationError("Anna Sampling did not return a valid outline covering every research task facet")


def _sample_json(
    sampling: AnnaSamplingClient,
    *,
    system_prompt: str,
    prompt: str,
    max_tokens: int,
    invoke_id: str,
    research_id: str,
    stage: str,
) -> dict[str, Any]:
    result = sampling.create_message(
        messages=[{"role": "user", "content": {"type": "text", "text": prompt}}],
        system_prompt=system_prompt,
        max_tokens=max_tokens,
        temperature=0.2,
        metadata={"executa_invoke_id": invoke_id, "tool": "app_generate_outline_draft", "research_id": research_id, "stage": stage},
        timeout=120.0,
    )
    return _parse_json_object(sampling_text(result))


def _parse_json_object(text: str) -> dict[str, Any]:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text or "")
        if not match:
            return {}
        try:
            value = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def _normalize_source_ids(source_ids: list[str]) -> list[str]:
    return list(dict.fromkeys(str(item or "").strip() for item in source_ids if str(item or "").strip()))


def _bounded_iterations(value: Any) -> int:
    try:
        return max(1, min(10, int(value or 5)))
    except (TypeError, ValueError):
        return 5


def _normalize_research_need(query: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"(?:研究主题|研究具体内容|Research topic|Research details?)[：:]?\s*", "", query, flags=re.I)).strip()


def _format_seed_context(sources: list[dict[str, Any]], facet_count: int) -> str:
    limit = min(12, max(5, facet_count))
    blocks = []
    for index, source in enumerate(sources[:limit], 1):
        content = _strip_chunk_markers(str(source.get("content") or "")).strip()[:1200]
        blocks.append(
            f"[{index}]\nTitle: {source.get('title') or '(untitled)'}\nURL: {source.get('url') or '(none)'}\nExcerpt: {content}"
        )
    return "\n\n".join(blocks)


def _prompt_query_for_job(job: dict[str, Any]) -> str:
    query = str(job.get("query") or "").strip()
    attachment_baseline = _attachment_search_baseline(job)
    return query + ("\n\n" + attachment_baseline if attachment_baseline else "")


def _attachment_search_baseline(job: dict[str, Any]) -> str:
    context = job.get("attachment_context") or {}
    if not context.get("summary"):
        return ""
    summaries = []
    for file in (context.get("files") or [])[:8]:
        if not isinstance(file, dict) or file.get("status") != "ready":
            continue
        analysis = file.get("analysis") or {}
        score = _optional_float(analysis.get("relevance_score"))
        if score is not None and score < 0.25:
            continue
        summary = str(analysis.get("summary") or "").strip()
        points = [str(point).strip() for point in (analysis.get("key_points") or [])[:4] if str(point).strip()]
        relevance = str(analysis.get("relevance") or "").strip()
        if not summary and not points and not relevance:
            continue
        block = [f"File: {file.get('name') or 'attachment'}"]
        if summary:
            block.append(f"Summary: {summary}")
        if points:
            block.append("Key points:\n" + "\n".join(f"  - {point}" for point in points))
        if relevance:
            block.append(f"Research relevance: {relevance}")
        summaries.append("\n".join(block))
    if not summaries:
        return ""
    return (
        "Relevant uploaded attachment evidence (use to identify search gaps, not as externally verified facts):\n\n"
        "Uploaded-file evidence policy: "
        + ATTACHMENT_EVIDENCE_POLICY
        + "\n\n"
        + "\n\n".join(summaries)
    )[:ATTACHMENT_SEARCH_BASELINE_MAX_CHARS]


def _optional_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _strip_chunk_markers(text: str) -> str:
    return re.sub(r"\[(?:Chunk|Chunks)\s+\d+(?:\s*-\s*\d+)?\][ \t]*(?:\r?\n)?", "", text or "", flags=re.I)
