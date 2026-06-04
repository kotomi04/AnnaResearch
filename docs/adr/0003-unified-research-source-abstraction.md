# Unified Research Source Abstraction Covering Tavily And User-Configured APIs

The Anna Researcher app introduces a single Research Source abstraction that covers both Tavily and User-Configured remote APIs such as 天眼查 or Crunchbase, instead of treating user-added sources as a parallel pipeline grafted onto the existing Tavily path. Tavily Summary Retrieval is migrated into a Built-in Research Source whose configuration is owned by the Researcher Tool Backend, while User-Configured Research Source entries are created by the app user. Both kinds share one result normalization step, one Lexical Context Selector pipeline, one job store iteration record, and one Research Source Panel surface in the Anna App Shell. The decision is made now because the introduction of user-configured external APIs would otherwise require either a second context selection pipeline or ad-hoc per-source branches in the Anna Research Orchestrator, both of which are harder to reverse than choosing unification up front.

**Consequences**

The Lexical Context Selector input must be source-agnostic. Every Research Source — Built-in or User-Configured — emits result items in the shape consumed by the selector, including a `source_id` field used for provenance prefixing and URL-deduplication fallback. The selector itself does not branch on source kind.

The Researcher Tool Backend exposes one `app_call_research_source` method instead of the previous Tavily-specific `app_search_web`. Tavily is invoked through this method with `source_id: "tavily"`. The old method is removed rather than kept as a deprecated alias, because the only caller is the Anna App Shell and there is no external consumer to preserve compatibility for.

Built-in and User-Configured entries are listed together by `app_list_research_sources` and rendered in a single Research Source Panel. The frontend does not see a backend split. Built-in entries return no `definition` block (envelope and field map are held in backend code), but they do expose `credential_masked`, `max_parallel`, and `enabled` so the Panel can render and edit them uniformly.

Job records persist an `iterations[]` array where each iteration names one `source_id`. The job schema does not have separate Tavily-only fields. Older job files that predate the unified schema are not migrated; they are surfaced as legacy in the UI and excluded from continued orchestration.

Sectioned Research Jobs keep the same unified Research Source abstraction, but scope source use and duplicate prevention to Report Sections. Each Report Section carries Allowed Research Sources as a strict whitelist, and section-level Research Step Decisions may only choose from that whitelist. The same `(source_id, normalized_query)` may be valid in another section, so duplicate-call prevention must use Section Research Step Log scope rather than a job-wide query ban.

Lexical Context Selector remains source-agnostic but runs per section in the sectioned workflow. Each section's selected context is built from that section's normalized source results, then the section writer produces section markdown and a Section Summary. Final Report Framing uses Section Summaries rather than raw source results or all section contexts.

Tests must lock the unified boundary: a User-Configured Research Source and the Tavily Built-in Research Source produce identical downstream behavior in the Lexical Context Selector, both flow through `app_call_research_source`, and both are listed by `app_list_research_sources` with the same envelope of fields modulo `kind` and `definition`.

Sectioned workflow tests must additionally lock that source assignment produces only known configured source IDs, section calls reject sources outside a section's Allowed Research Sources, and identical source/query pairs are rejected within one section while remaining legal across different sections.
