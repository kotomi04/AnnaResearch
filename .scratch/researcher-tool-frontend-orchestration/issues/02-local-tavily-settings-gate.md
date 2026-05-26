Status: ready-for-agent
Labels: ready-for-agent

# Local Tavily Settings Gate

## Parent

Frontend-Owned Anna Researcher With Standalone Researcher Tool PRD

## What to build

Add local Researcher Tool Settings for user-provided Tavily configuration and wire the Anna App Shell so research cannot start until Tavily is configured. The UI should let the user save and clear a Tavily key, while the backend stores the key locally, returns only masked settings, and validates search configuration server-side.

This slice should make the settings path demoable without live Tavily by using fake tool responses or isolated local files.

## Acceptance criteria

- [ ] `app_get_settings` returns Tavily configuration status without returning the full key.
- [ ] `app_update_settings` saves a user-provided Tavily key to local Researcher Tool Settings.
- [ ] `app_update_settings` supports explicit Tavily key clearing.
- [ ] Researcher Tool Settings are stored under `~/anna-workspace/.research` or an isolated test override.
- [ ] The Tavily key is treated as local plaintext configuration for this refactor.
- [ ] The full Tavily key is not logged, returned by `app_get_settings`, or copied into job records.
- [ ] Settings read returns a Masked Tool Setting when Tavily is configured.
- [ ] The Anna App Shell checks settings on startup.
- [ ] The Anna App Shell shows a Tavily settings state when no key is configured.
- [ ] The Anna App Shell prevents research start while Tavily is missing.
- [ ] The Anna App Shell allows the user to save and clear the Tavily key.
- [ ] Updating Tavily settings during a run does not mutate already saved search results.
- [ ] Backend tests cover save, mask, read, clear, file creation, and no full-key echo.
- [ ] Frontend tests cover the startup gate, configured state, and clearing behavior with a fake Anna runtime.

## Blocked by

- 01-standalone-tool-contract-cutover

