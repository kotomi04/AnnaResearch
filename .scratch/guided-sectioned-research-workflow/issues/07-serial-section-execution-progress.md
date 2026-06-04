Status: ready-for-agent
Labels: ready-for-agent

# 多 Section 串行执行与进度 UI

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Extend the single-section research path to run all Report Sections serially in Confirmed Research Outline order. The research page should show the active section, section statuses, progress, and failure details. A section-level failure should fail and stop the whole Sectioned Research Job instead of silently producing a partial report.

## Acceptance criteria

- [ ] Sections run serially in Confirmed Research Outline order.
- [ ] The same source/query pair may be used in different sections while remaining duplicate-protected within each section.
- [ ] The research page shows active section, completed sections, pending sections, and failed section details.
- [ ] A section failure stops later sections from running and marks the Sectioned Research Job failed.
- [ ] Section progress and active section index are persisted and recoverable.
- [ ] Tests cover serial ordering, cross-section duplicate allowance, failure stop behavior, progress persistence, and localized status copy.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/06-single-section-iterative-research-loop.md

