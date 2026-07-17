# ADR 0009: Facet-Covered Outline Discovery

Status: Accepted

## Context

The previous guided workflow generated research focuses before the outline and used a small, truncated initial-search context. Long briefs were also at risk of becoming poor search queries, while multi-task briefs had no explicit coverage check.

## Decision

- Keep the complete user brief as the source of truth for planning and writing.
- Generate one concise `anchor` query and a complete facet ledger before seed search.
- Use seed results to generate three to six prioritized sub-queries, with every facet covered by at least one query.
- Search every enabled, configured source with the sub-queries plus the anchor, then use the shared hybrid selector before outline generation.
- Require every facet to be covered by the generated outline.
- Store query text once in the outline query plan. Seed and research calls reference stable query IDs and keep phase-specific selected contexts.
- Remove the separate research-focus confirmation step and its persisted/API surface.

## Consequences

Outline generation uses additional LLM planning calls and more searches, but long and multi-task briefs retain explicit coverage. Search provenance remains auditable without duplicating query text throughout the job JSON.
