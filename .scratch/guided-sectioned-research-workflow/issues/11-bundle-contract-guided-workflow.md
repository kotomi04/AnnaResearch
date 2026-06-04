Status: ready-for-agent
Labels: ready-for-agent

# Bundle contract 与旧 one-click flow 迁移

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Update the committed Anna App static bundle and bundle contract coverage so the default app path uses the guided Sectioned Research Job workflow. The old one-click report-level flow should no longer be the only path exercised by the bundle. Frontend source remains the editing source of truth, and generated bundle files must come from the frontend build.

## Acceptance criteria

- [ ] The built static bundle reflects the guided workflow screens for role selection, focus brainstorming, outline review, section research progress, and final result.
- [ ] Bundle contract tests verify the app calls the new sectioned App Tool Methods.
- [ ] Bundle contract tests verify the default path no longer relies only on the legacy one-click report-level flow.
- [ ] Frontend build succeeds and updates generated bundle output from source.
- [ ] Existing offline tests relevant to app runtime, plugin contract, and frontend behavior pass or documented failures are clearly explained.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/10-report-framing-final-assembly.md

