Status: ready-for-agent
Labels: ready-for-agent

# Allowed Research Sources 严格白名单编辑

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Add the second half of Two-Step Outline Planning. After sections are drafted, the Anna App Shell should ask Frontend LLM Completion to assign Allowed Research Sources to every Report Section using the currently available configured Research Sources. The user should be able to add or remove allowed sources per section, and the backend must reject section source calls outside that section's strict whitelist.

Allowed Research Sources are strict section-level whitelists, not recommendations.

## Acceptance criteria

- [ ] Frontend LLM Completion prompt and parser assign Allowed Research Sources for all Report Sections from the configured source list.
- [ ] The outline UI lets the user add and remove allowed sources for each section.
- [ ] The user cannot confirm a section that has no allowed configured source.
- [ ] Confirmed Research Outline persists section titles, outline content, `max_iterations`, and Allowed Research Sources.
- [ ] Backend validation rejects any section source call that targets a source outside the section whitelist.
- [ ] Tests cover source assignment parsing, empty source validation, user edits, persistence, outside-source rejection, and localized errors.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/04-outline-section-planning.md

