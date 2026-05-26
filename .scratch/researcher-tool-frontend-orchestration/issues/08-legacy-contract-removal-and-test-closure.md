Status: ready-for-agent
Labels: ready-for-agent

# Legacy Contract Removal And Test Closure

## Parent

Frontend-Owned Anna Researcher With Standalone Researcher Tool PRD

## What to build

Close the refactor by removing or retiring stale implementation paths, updating contract checks, rebuilding the committed static bundle, and running the offline verification set. The codebase should no longer rely on the old backend orchestrator, tool-side sampling, `method: "research"`, or `action: "advance"` contract.

This slice should make the refactor safe for the next AFK agent by ensuring old and new contracts cannot coexist silently.

## Acceptance criteria

- [ ] The standalone Researcher Tool Project does not migrate the old tool-side sampling module.
- [ ] The standalone Researcher Tool Project does not migrate the old backend orchestrator as an active backend state machine.
- [ ] Any remaining old modules are clearly retired, removed, or excluded from the new tool contract.
- [ ] The app frontend no longer calls `method: "research"`.
- [ ] The app frontend no longer sends `action` dispatcher arguments.
- [ ] The built static bundle no longer contains the old `method: "research"` contract.
- [ ] The built static bundle no longer contains the old `action: "advance"` contract.
- [ ] Bundle contract tests enforce the absence of the legacy contract.
- [ ] Tool contract tests enforce that only `app_*` methods are exposed.
- [ ] Frontend tests cover the complete fake end-to-end research flow through settings, job creation, frontend LLM stages, search, context selection, report writing, save, and recovery.
- [ ] Offline Python tests for the standalone tool pass.
- [ ] Frontend tests pass.
- [ ] Static bundle build succeeds and generated bundle output is committed.
- [ ] Python syntax checks cover the standalone tool and relevant tests.
- [ ] No tests require live Tavily, live Anna runtime, live LLM, or `anna-app dev`.

## Blocked by

- 07-frontend-report-writing-and-result-persistence

