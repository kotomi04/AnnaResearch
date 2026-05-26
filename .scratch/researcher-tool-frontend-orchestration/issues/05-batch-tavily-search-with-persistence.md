Status: ready-for-agent
Labels: ready-for-agent

# Batch Tavily Search With Persistence

## Parent

Frontend-Owned Anna Researcher With Standalone Researcher Tool PRD

## What to build

Implement the backend web search step used by frontend-owned orchestration. The frontend should pass the planned search queries and optional domain filters to `app_search_web`; the backend should validate Tavily settings, normalize domains, run Tavily Summary Retrieval for multiple queries, deduplicate URLs, and persist search results to the job.

This slice should be fully testable with fake Tavily retrieval.

## Acceptance criteria

- [ ] `app_search_web` accepts a research id and multiple search queries.
- [ ] `app_search_web` reads the Tavily key from local Researcher Tool Settings.
- [ ] `app_search_web` returns a clear configuration error when Tavily is not configured.
- [ ] `app_search_web` supports optional `query_domains`.
- [ ] Backend domain normalization supports arrays and comma-separated strings.
- [ ] Backend domain normalization lowercases domains, strips `http://` and `https://`, trims trailing slashes, and deduplicates.
- [ ] Tavily Summary Retrieval is used without full-page scraping.
- [ ] Search results from multiple planned queries are merged.
- [ ] Merged results are deduplicated by URL.
- [ ] Search results are persisted to the job record.
- [ ] The frontend advances to the search stage and calls `app_search_web` with planned queries.
- [ ] The frontend does not pass arbitrary source URLs.
- [ ] Backend tests cover missing settings, fake retrieval, batch query merging, URL deduplication, domain normalization, and persisted search results.
- [ ] Frontend tests verify `app_search_web` call shape and search-stage persistence behavior with fake tool responses.

## Blocked by

- 02-local-tavily-settings-gate
- 03-recoverable-research-job-shell
- 04-frontend-llm-role-and-query-planning

