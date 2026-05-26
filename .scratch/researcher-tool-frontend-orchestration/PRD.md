Status: ready-for-agent
Labels: ready-for-agent

# PRD: Frontend-Owned Anna Researcher With Standalone Researcher Tool

## Problem Statement

The current Anna Researcher app still reflects the earlier Anna App Adapter MVP shape: the app shell calls a Python Executa implementation embedded under the app's `executas` directory, and that backend owns the research advancement loop, Anna Sampling LLM calls, Tavily retrieval, context selection, and result persistence behind a single `research` method with an `action` parameter.

That shape no longer matches the desired product boundary. The user needs `anna-researcher-app` to treat the Anna App Shell as the owner of research reasoning and LLM calls, while a standalone Researcher Tool Project acts only as the app-facing backend for local settings, web search, deterministic context selection, and persistence. The backend must not call LLM or Agent APIs.

The user also needs Tavily setup to be user-configurable from the app UI and stored locally under `~/anna-workspace/.research`, rather than depending on Anna platform credentials for this refactor.

## Solution

Refactor Anna Researcher into a frontend-owned research workflow backed by an independent `researcher-tool` project.

The Anna App Shell becomes the Anna Research Orchestrator. It creates a research job, runs Frontend LLM Completion for Adaptive Research Role, Bounded Query Planning, and report writing, calls explicit `app_*` App Tool Methods for backend work, and persists each important step so the current or latest job can be recovered.

The Researcher Tool Backend becomes a standalone Executa v2 tool project. It keeps the existing minted tool id, moves to version `0.2.0`, implements v2 initialization, and exposes only explicit `app_*` methods. It does not declare Anna Sampling LLM or Agent capabilities, and it does not migrate the previous backend orchestrator or tool-side sampling modules.

The Anna App `executas` directory keeps only an App Executa Reference that launches the standalone Researcher Tool Project. The app manifest requires the tool at version `0.2.0` and authorizes frontend `anna.llm.complete`.

The user-facing research experience remains a Single-Page Research Workbench for `research_report` only. The app gates research on local Tavily settings, supports optional domain filters, uses Tavily Summary Retrieval without full-page scraping, uses Lexical Context Selector to produce `selected_context`, passes the complete `selected_context` to frontend LLM completion, and persists a Minimal Research Result.

## User Stories

1. As an Anna user, I want the research app to ask for a Tavily key when one is missing, so that I can configure web search without leaving the app.
2. As an Anna user, I want my Tavily key stored locally under the Anna workspace, so that I do not need to re-enter it every time I open the app on the same machine.
3. As an Anna user, I want the app to show only a masked Tavily setting after configuration, so that the full key is not echoed back into the UI.
4. As an Anna user, I want to clear my saved Tavily key, so that I can remove local search credentials when needed.
5. As an Anna user, I want the app to prevent starting research when Tavily is not configured, so that failures are explained before work begins.
6. As an Anna user, I want backend search to also validate Tavily configuration, so that bypassing the UI does not produce confusing behavior.
7. As an Anna user, I want to enter a research query, so that the app can produce a standard `research_report`.
8. As an Anna user, I want the app to support optional domain filtering, so that I can constrain web search to specific domains.
9. As an Anna user, I want the app to continue supporting only web search and domain filters, so that it does not imply local documents or arbitrary URLs are ingested.
10. As an Anna user, I want the app to show research progress through familiar stages, so that I can understand whether it is selecting a role, planning queries, searching, selecting context, or writing.
11. As an Anna user, I want the app to recover with the latest job when I reopen or refresh it, so that completed or partially completed work is not lost.
12. As an Anna user, I want a missing latest job to be treated as an empty state, so that opening the app for the first time does not show an error.
13. As an Anna user, I want a completed markdown report displayed in the app, so that I can read the research result directly.
14. As an Anna user, I want source URLs retained with the report, so that I can inspect the evidence.
15. As an Anna user, I want the app to save the final report locally, so that the latest result can be recovered.
16. As an Anna user, I want changing the Tavily key during a run to affect later searches only, so that completed search results are not silently replaced.
17. As an Anna user, I want query planning failures to fall back to my original query, so that research can continue when LLM JSON is malformed.
18. As an Anna user, I want the report language behavior to remain natural to my query and prompt, so that UI language does not force report language.
19. As an Anna user, I want the app to avoid PDF and DOCX export work in this refactor, so that the core research flow remains focused.
20. As an Anna user, I want no follow-up chat, retry orchestration, cancellation, history list, or multi-job management in this refactor, so that the app stays simple.
21. As an Anna App developer, I want the Researcher Tool Backend to live in a standalone tool project, so that it can be developed and tested independently from the app shell.
22. As an Anna App developer, I want the app `executas` directory to contain only a minimal reference to the tool, so that backend source is not duplicated under the app.
23. As an Anna App developer, I want the existing minted tool id to remain stable, so that app registration does not change identity.
24. As an Anna App developer, I want the tool version to move to `0.2.0`, so that the breaking method contract change is explicit.
25. As an Anna App developer, I want the Researcher Tool Backend to implement Executa v2 initialization, so that it satisfies the current backend protocol.
26. As an Anna App developer, I want the Researcher Tool Backend not to declare LLM sampling or Agent capabilities, so that LLM and Agent reasoning cannot drift back into the backend.
27. As an Anna App developer, I want explicit `app_*` methods instead of a `research` action dispatcher, so that each backend capability has a clear app-facing contract.
28. As an Anna App developer, I want the old `research` method removed, so that stale frontend or bundle code fails tests instead of silently using the old backend state machine.
29. As an Anna App developer, I want frontend orchestration to call `anna.llm.complete` directly, so that role selection, query planning, and report writing stay in the Anna App Shell.
30. As an Anna App developer, I want all frontend LLM calls to omit `maxTokens`, so that Anna does not return empty output when an internal max-token behavior is triggered.
31. As an Anna App developer, I want output shapes controlled by prompts rather than `maxTokens`, so that LLM calls remain compatible with the current Anna runtime behavior.
32. As an Anna App developer, I want the app manifest to authorize `llm.complete`, so that frontend LLM calls pass Anna runtime ACL checks.
33. As an Anna App developer, I want `app_create_research_job` to create a research id before LLM or search work begins, so that all later data belongs to one recoverable job.
34. As an Anna App developer, I want `app_update_research_job` to update only approved app-owned metadata fields, so that it cannot become an arbitrary local write surface.
35. As an Anna App developer, I want `app_search_web` to accept multiple frontend-planned search queries, so that backend Tavily retrieval can merge and deduplicate results in one call.
36. As an Anna App developer, I want domain normalization handled by the backend, so that the tool contract is robust even if frontend parsing changes.
37. As an Anna App developer, I want search results saved after backend search, so that refresh recovery can resume after retrieval has succeeded.
38. As an Anna App developer, I want `app_select_context` to use Lexical Context Selector, so that deterministic context trimming remains isolated and testable.
39. As an Anna App developer, I want `app_select_context` to save selected context and selected sources, so that report generation failures do not lose retrieval work.
40. As an Anna App developer, I want the frontend to pass the complete `selected_context` to report generation, so that backend context budget remains the single trimming boundary.
41. As an Anna App developer, I want `app_save_research_result` to persist the Minimal Research Result, so that final output is recoverable.
42. As an Anna App developer, I want `app_get_research_job` to retrieve a specific job by id, so that the UI can reload known work.
43. As an Anna App developer, I want `app_get_research_job` without an id to return the latest job or `job: null`, so that initial app load is simple.
44. As an Anna App developer, I want explicit not-found behavior only when a requested job id does not exist, so that normal empty-state startup is not an error.
45. As an Anna App developer, I want local plaintext Tavily settings treated as a conscious temporary trade-off, so that implementation avoids logging or copying secrets.
46. As an Anna App developer, I want tests to lock the new boundary, so that implementation cannot accidentally preserve the old backend orchestrator contract.
47. As a future developer, I want settings, retrieval, context selection, and persistence to be deep backend modules, so that they can be tested without Anna runtime.
48. As a future developer, I want frontend orchestration to be a deep frontend module, so that LLM prompts, parsing, stages, and recovery behavior can evolve without changing UI components.
49. As a future developer, I want `gpt-researcher` upstream source untouched, so that Anna-specific adaptation remains outside the upstream backend/frontend.
50. As a future developer, I want the ADR to explain why LLM moved to the frontend, so that the next maintainer does not reintroduce tool-side sampling.

## Implementation Decisions

- Respect ADR 0001: Anna Researcher uses frontend-owned orchestration with a standalone Researcher Tool Backend.
- Create a standalone Researcher Tool Project for the backend tool.
- Keep the existing minted tool id.
- Set the refactored tool version to `0.2.0`.
- Update the Anna App manifest to require tool version `0.2.0`.
- Keep only an App Executa Reference under the app `executas` directory.
- Do not copy backend source into the app `executas` directory.
- Do not use a symlinked backend source tree as the primary app reference.
- Do not touch the upstream GPT Researcher source.
- Implement Executa v2 initialization in the Researcher Tool Backend.
- Do not declare `llm.sample` or Agent capabilities in the backend manifest or v2 capabilities.
- Remove the old `research` method from the refactored backend contract.
- Do not preserve the old `action=start|advance|get_status|get_result` dispatcher.
- Expose these App Tool Methods: `app_get_settings`, `app_update_settings`, `app_create_research_job`, `app_update_research_job`, `app_search_web`, `app_select_context`, `app_save_research_result`, and `app_get_research_job`.
- Keep the backend stdout reserved for JSON-RPC frames and logs on stderr.
- Store Researcher Tool Settings and job data under `~/anna-workspace/.research`.
- Use a settings record for Tavily configuration.
- Store Tavily key as local plaintext for this refactor.
- Avoid logging Tavily key.
- Avoid storing Tavily key in job records.
- Return only masked Tavily settings to the app UI.
- Support explicit Tavily key clearing through settings update.
- Keep settings independent of the current research job.
- Allow Tavily settings to be updated during a run without automatically recomputing completed job steps.
- Gate frontend research startup on `app_get_settings`.
- Also validate Tavily settings in `app_search_web`.
- Create research jobs explicitly before LLM or search work begins.
- Generate and return a `research_id` from `app_create_research_job`.
- Persist the latest research id for no-argument job recovery.
- Treat no latest job as success with `job: null`.
- Treat an explicit missing `research_id` as not found.
- Let frontend orchestration own `status`, `stage`, and `progress`.
- Keep stage names stable: `select_role`, `plan_queries`, `search_next_query`, `select_context`, `write_report`, and `completed`.
- Allow `app_update_research_job` to update only approved app-owned metadata fields.
- Approved metadata includes status, stage, progress, agent role fields, planned search queries, and errors.
- Do not allow generic job update to write secrets, arbitrary paths, or arbitrary unbounded JSON.
- Keep Adaptive Research Role as a frontend LLM stage.
- Keep Bounded Query Planning as a frontend LLM stage.
- Always retain the original query in planned search queries.
- If query planning returns invalid JSON, fall back to the original query.
- Use `anna.llm.complete` for frontend LLM calls.
- Do not use Anna Agent session in this refactor.
- Omit `maxTokens` from all frontend `anna.llm.complete` calls.
- Control LLM output shape with prompts.
- Authorize frontend LLM completion in the Anna App manifest.
- Keep report language strategy unchanged by UI locale.
- Continue supporting only Research Report Only.
- Continue supporting Web Research Sources only.
- Continue supporting optional domain filters as `query_domains`.
- Do not restore arbitrary `source_urls` ingestion.
- Normalize domain filters in the backend by supporting array or comma-separated string input, lowercasing, stripping `http://` and `https://`, trimming trailing slashes, and deduplicating.
- Use Tavily Summary Retrieval for web search.
- Do not scrape full web pages in this refactor.
- Let `app_search_web` accept multiple search queries and merge backend results.
- Deduplicate merged Tavily results by URL.
- Save search results to the job record after search.
- Use Lexical Context Selector behind `app_select_context`.
- Let `app_select_context` accept query, planned search queries, and search results associated with the job.
- Return `selected_context`, `selected_sources`, and `source_urls` from context selection.
- Save selected context and selected sources to the job record.
- Pass the complete `selected_context` to frontend report generation.
- Save the final report through `app_save_research_result`.
- Persist Minimal Research Result with markdown report, source URL evidence, status, failure summary when relevant, and basic timestamps.
- Do not implement generated document exports.
- Do not implement full history listing.
- Do not implement cancellation.
- Do not implement retry orchestration.
- Do not implement multi-job concurrency management.
- Do not implement follow-up chat.
- Remove or retire backend tool-side sampling code from the new backend.
- Remove or retire the previous backend orchestrator from the new backend.
- Migrate or recreate only non-LLM backend capabilities: settings, Tavily summary retrieval, lexical context selection, job persistence, and stable errors.
- Keep frontend source as the editing surface and rebuild the committed static bundle after UI changes.

## Testing Decisions

- Tests should assert external behavior and stable contracts, not private implementation details.
- Add standalone Researcher Tool Backend contract tests for `initialize`, `describe`, `health`, and all `app_*` methods.
- Test that `describe` exposes only the refactored `app_*` methods and no old `research` method.
- Test that the backend negotiates Executa v2 without declaring sampling or Agent capabilities.
- Test that settings write, read, mask, and clear Tavily configuration correctly.
- Test that full Tavily key values are not returned by settings read.
- Test that missing Tavily settings block `app_search_web` with a clear configuration error.
- Test Tavily Summary Retrieval with fake retrieval data.
- Test multi-query search merging and URL deduplication.
- Test backend domain normalization for arrays, comma strings, schemes, trailing slashes, case, and duplicates.
- Test job creation returns a research id and records the latest job.
- Test no-argument `app_get_research_job` returns the latest job.
- Test no-argument `app_get_research_job` returns `job: null` when no job exists.
- Test explicit missing research id returns not found.
- Test `app_update_research_job` accepts only approved metadata fields.
- Test `app_update_research_job` rejects secret-like or arbitrary update fields.
- Test `app_search_web` persists search results to the job record.
- Test `app_select_context` returns and persists `selected_context`, `selected_sources`, and `source_urls`.
- Test Lexical Context Selector ranking, URL deduplication, source limits, and context budget using deterministic fixtures.
- Test `app_save_research_result` persists Minimal Research Result.
- Test corrupted or malformed local records fail predictably.
- Add frontend tests using fake Anna runtime APIs.
- Test startup settings gate: no Tavily key shows settings state and blocks research start.
- Test configured Tavily allows the research flow to start.
- Test frontend calls new `app_*` methods rather than the old `research` dispatcher.
- Test frontend calls `anna.llm.complete` for role selection, query planning, and report writing.
- Test all frontend LLM calls omit `maxTokens`.
- Test query planning invalid JSON falls back to the original query.
- Test original query is retained when planned queries are valid.
- Test frontend passes complete `selected_context` to report generation.
- Test frontend stage values and localized status mapping still render correctly.
- Test final report rendering and source URL display.
- Add bundle contract checks that the built static bundle does not contain the old `method: "research"` or `action: "advance"` contract.
- Run existing offline Python tests where still relevant after moving code.
- Run frontend tests and static bundle build after implementation.
- Do not require live Tavily, live Anna runtime, or live LLM for normal automated tests.
- Keep live Anna App dev verification manual unless the user starts the runtime.

## Out of Scope

- Touching `gpt-researcher` upstream backend or frontend code.
- Preserving the old `research` method or action dispatcher.
- Tool-side Anna Sampling LLM.
- Tool-side Anna Agent sessions.
- Migrating the old backend orchestrator into the new Researcher Tool Backend.
- Using Anna Agent session from the frontend.
- Setting `maxTokens` on frontend LLM completion calls.
- Anna platform credential integration for Tavily in this refactor.
- Encrypting local Tavily settings or integrating system keychain.
- Full-page scraping.
- Arbitrary source URL ingestion.
- Local documents, PDF ingestion, DOCX ingestion, hybrid sources, Azure sources, or Anna file ingestion.
- OpenAI embeddings or local embedding runtimes.
- Detailed reports, deep reports, resource reports, outline reports, or multi-agent reports.
- Report language policy changes based on UI locale.
- PDF, DOCX, or markdown export bundles.
- Full job history UI.
- Cancellation.
- Retry orchestration.
- Multi-job concurrency.
- Follow-up chat.
- Starting Anna App dev or any long-running Anna runtime process as part of normal implementation.

## Further Notes

- This PRD follows the confirmed glossary updates in `CONTEXT.md` and the accepted ADR for frontend-owned researcher orchestration.
- The main architectural shift is that the Anna App Shell owns reasoning, while the Researcher Tool Backend owns local and external non-LLM work.
- The main security trade-off is local plaintext Tavily settings. This is accepted for now, but implementation must avoid full-key echo, logs, and job record leakage.
- The main runtime compatibility constraint is that frontend LLM completion calls must omit `maxTokens`.
- The main regression risk is stale bundle or test code continuing to call `method: "research"` with `action` arguments. Contract tests should make that impossible to miss.
