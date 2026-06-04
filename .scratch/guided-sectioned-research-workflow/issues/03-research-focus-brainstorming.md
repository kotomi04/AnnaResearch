Status: ready-for-agent
Labels: ready-for-agent

# 研究重点生成与多选确认

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Add the brainstorming stage after role confirmation. The Anna App Shell should use the original query and Confirmed Research Role to ask Frontend LLM Completion for five Research Focus candidates, show them as editable cards, support regeneration with an optional instruction, and let the user confirm one to five Research Focus entries.

Draft focus candidates should remain frontend state until confirmation. Only confirmed Research Focus entries should be persisted.

## Acceptance criteria

- [ ] Frontend LLM Completion prompt and parser generate five Research Focus candidates from query and Confirmed Research Role.
- [ ] The UI displays focus candidates as editable cards and supports editing focus text before selection.
- [ ] The user can select one to five focuses and cannot continue with zero or more than five.
- [ ] The user can regenerate focus candidates with or without an optional regeneration instruction.
- [ ] Only confirmed Research Focus entries are persisted to the Sectioned Research Job.
- [ ] Parser fallback, validation errors, and Chinese/English UI copy are covered by tests.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/02-role-candidate-selection.md

