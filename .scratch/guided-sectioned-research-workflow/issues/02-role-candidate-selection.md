Status: ready-for-agent
Labels: ready-for-agent

# 角色候选生成与确认

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Add the role selection stage of the guided workflow. After the user submits a research query, the Anna App Shell should ask Frontend LLM Completion for three Research Role candidates, show them as editable cards, allow regeneration with an optional instruction, and persist only the selected Confirmed Research Role.

Draft role candidates should remain frontend state until confirmation. Each candidate must include `server` and `agent_role_prompt`, with optional UI-only rationale. The user must confirm exactly one role before moving to the next stage.

## Acceptance criteria

- [ ] Frontend LLM Completion prompt and parser generate three role candidates with `server` and `agent_role_prompt`.
- [ ] The UI displays role candidates as editable cards and lets the user edit `server` and `agent_role_prompt`.
- [ ] The user can regenerate role candidates with or without an optional regeneration instruction.
- [ ] The user can confirm exactly one role, and only the Confirmed Research Role is persisted to the Sectioned Research Job.
- [ ] Parser fallback and user-visible error handling are covered for malformed, empty, and partially valid LLM output.
- [ ] Chinese and English UI copy covers the role stage, regeneration dialog, validation errors, and stage status.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/01-sectioned-research-job-persistence.md

