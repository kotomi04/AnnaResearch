Status: ready-for-agent
Labels: ready-for-agent

# Per-section Lexical Context Selector

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Run Lexical Context Selector independently for each Report Section after that section has gathered evidence. The selector should read only the current section's evidence, write section-level selected context, and avoid leaking evidence or selected snippets across sections.

## Acceptance criteria

- [ ] A section-level context selection method selects context only from the current section's evidence.
- [ ] Selected context is persisted under the section result area, not the legacy report-level context field.
- [ ] The UI or job state exposes enough selected-context status to continue section writing after recovery.
- [ ] Tests prove one section's evidence cannot appear in another section's selected context.
- [ ] Existing Lexical Context Selector ranking, deduplication, and context budget behavior remain covered.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/06-single-section-iterative-research-loop.md

