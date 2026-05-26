Status: ready-for-agent
Labels: ready-for-agent

# Frontend Report Writing And Result Persistence

## Parent

Frontend-Owned Anna Researcher With Standalone Researcher Tool PRD

## What to build

Complete the frontend-owned research flow by writing the report in the Anna App Shell and saving the Minimal Research Result through the Researcher Tool Backend. The frontend should pass the complete `selected_context` to `anna.llm.complete`, omit `maxTokens`, persist the markdown report and source evidence, recover the completed result, and render it in the Single-Page Research Workbench.

This slice makes the refactored research flow demoable end to end with fake LLM and fake Tavily responses.

## Acceptance criteria

- [ ] The frontend calls `anna.llm.complete` for report writing.
- [ ] The report-writing LLM call includes the complete `selected_context`.
- [ ] The report-writing LLM call omits `maxTokens`.
- [ ] Report writing preserves Research Report Only scope.
- [ ] Report language is not forced by UI locale.
- [ ] `app_save_research_result` persists the markdown report, source URLs, selected sources, status, errors when relevant, and timestamps.
- [ ] The frontend calls `app_save_research_result` after report generation.
- [ ] The completed job can be retrieved through `app_get_research_job`.
- [ ] The UI renders the completed markdown report.
- [ ] The UI renders source URLs separately.
- [ ] The UI can recover and display the latest completed result after reload.
- [ ] Frontend tests verify report LLM call shape, absence of `maxTokens`, complete selected context usage, save-result call shape, rendering, and recovery.
- [ ] Backend tests verify result persistence and retrieval through the public app methods.

## Blocked by

- 04-frontend-llm-role-and-query-planning
- 06-lexical-context-selection-step

