Status: ready-for-agent
Labels: ready-for-agent

# 单 Section 迭代研究闭环

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Build the first executable section research path for one Report Section. The Anna App Shell should run a section-level Iterative Research Loop where each Research Step Decision may only choose from the section's Allowed Research Sources. The Researcher Tool Backend should execute the source call, persist the section iteration, reject duplicate source/query calls within the section, and record soft source errors when the section can continue.

This slice should prove one section can gather evidence end to end before multi-section orchestration is added.

## Acceptance criteria

- [ ] Section-level Research Step Decision prompt receives only the current section's allowed source set.
- [ ] Source calls use the backend section source-call method and are rejected when outside the section whitelist.
- [ ] Duplicate source/query calls are rejected within the same section.
- [ ] Individual source call errors are recorded in the section iteration log and can feed the next Research Step Decision.
- [ ] The loop respects the current section's `max_iterations`.
- [ ] If a section cannot continue or produce usable evidence, the job records a section failure with a clear section identifier.
- [ ] Tests cover happy path, outside-source rejection, duplicate rejection, soft source error recording, max iteration limits, and failure payloads.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/05-allowed-research-source-whitelist.md

