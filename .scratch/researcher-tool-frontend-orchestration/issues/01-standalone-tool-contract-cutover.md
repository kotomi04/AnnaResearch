Status: ready-for-agent
Labels: ready-for-agent

# Standalone Tool Contract Cutover

## Parent

Frontend-Owned Anna Researcher With Standalone Researcher Tool PRD

## What to build

Create the first end-to-end cutover from the embedded Executa implementation to a standalone Researcher Tool Project. The Anna App should reference the standalone tool through a minimal App Executa Reference, and the tool should expose the new Executa v2 contract with explicit `app_*` methods instead of the old `research` action dispatcher.

This slice should prove the app and tool can discover each other using the existing minted tool id at version `0.2.0`, while making it impossible for new code to rely on the old `research` method.

## Acceptance criteria

- [ ] A standalone Researcher Tool Project exists and is the backend source of truth.
- [ ] The Anna App `executas` directory contains only a minimal App Executa Reference to the standalone tool.
- [ ] The refactored tool keeps the existing minted tool id.
- [ ] The refactored tool reports version `0.2.0`.
- [ ] The Anna App manifest requires the refactored tool at minimum version `0.2.0`.
- [ ] The Researcher Tool Backend implements `initialize`, `describe`, `health`, and `invoke`.
- [ ] `initialize` negotiates Executa v2.
- [ ] The backend manifest does not declare LLM sampling or Agent capabilities.
- [ ] `describe` exposes only `app_*` tool methods for the refactored contract.
- [ ] The old `research` method is not exposed by the refactored tool.
- [ ] The old `action=start|advance|get_status|get_result` dispatcher is not part of the refactored contract.
- [ ] stdout remains reserved for JSON-RPC frames and logs go to stderr.
- [ ] Contract tests verify v2 initialization, describe output, health, unknown method behavior, and absence of the old `research` method.
- [ ] The app can invoke at least one harmless `app_*` method through the referenced standalone tool in a fake or offline test harness.

## Blocked by

None - can start immediately

