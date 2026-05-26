Status: ready-for-agent
Labels: ready-for-agent

# Lexical Context Selection Step

## Parent

Frontend-Owned Anna Researcher With Standalone Researcher Tool PRD

## What to build

Add the deterministic context selection step behind `app_select_context`. The backend should use Lexical Context Selector to turn stored or provided Tavily search results into bounded `selected_context`, `selected_sources`, and `source_urls`, persist those outputs to the job, and return them to the frontend for report generation.

This slice should not call any LLM. It should preserve the Context Selector as a deep backend module.

## Acceptance criteria

- [ ] `app_select_context` accepts a research id and enough job/search context to select report context.
- [ ] `app_select_context` uses Lexical Context Selector.
- [ ] Context selection ranks and trims search results with deterministic lexical signals.
- [ ] Context selection deduplicates URLs.
- [ ] Context selection enforces source limits.
- [ ] Context selection enforces context budget.
- [ ] `app_select_context` returns `selected_context`, `selected_sources`, and `source_urls`.
- [ ] `app_select_context` persists selected context, selected sources, and source URLs to the job record.
- [ ] The frontend calls `app_select_context` after search completes.
- [ ] The frontend stores the returned `selected_context` for report generation.
- [ ] Backend tests cover ranking, URL deduplication, source limits, context budget, empty unusable context, and persisted selected context.
- [ ] Frontend tests verify context-selection call shape and stage transition with fake tool responses.

## Blocked by

- 05-batch-tavily-search-with-persistence

