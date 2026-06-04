Status: ready-for-agent
Labels: ready-for-agent

# Sectioned Research Job 基础持久化

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Build the first end-to-end persistence path for a Sectioned Research Job. One user research request should be representable as one Async Research Job with sectioned workflow state, explicit stage/progress fields, confirmed planning placeholders, and section-level storage areas. The backend should expose explicit App Tool Methods for saving and reading sectioned job state instead of using a generic nested metadata update surface.

This slice should keep the current app runnable and preserve compatibility with existing completed legacy jobs where practical.

## Acceptance criteria

- [ ] A Sectioned Research Job can be created, read, updated, and recovered through explicit App Tool Methods.
- [ ] Job state can store Confirmed Research Role, confirmed Research Focus entries, Confirmed Research Outline, active section index, section progress, section iterations, section selected context, section results, Report Framing output, and assembled result metadata.
- [ ] Generic job metadata updates remain limited to lightweight status, stage, progress, active section index, and high-level errors.
- [ ] Existing completed legacy jobs remain readable or are clearly identified as legacy in returned job state.
- [ ] Contract and job store tests cover valid writes, reads, invalid parameters, corrupted records, and stable error payloads.

## Blocked by

None - can start immediately

