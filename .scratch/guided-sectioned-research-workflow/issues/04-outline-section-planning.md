Status: ready-for-agent
Labels: ready-for-agent

# 大纲生成与 Section 编辑确认

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Add the first half of Two-Step Outline Planning. From the original query, Confirmed Research Role, and confirmed Research Focus entries, the Anna App Shell should ask Frontend LLM Completion to draft four to six Report Sections. The user should be able to edit section titles and outline content, add or delete sections, set per-section `max_iterations`, regenerate the outline with an optional instruction, and confirm one to eight sections.

This slice should not yet require source assignment; it establishes the section structure and editing path.

## Acceptance criteria

- [ ] Frontend LLM Completion prompt and parser draft four to six Report Sections with title and outline content.
- [ ] The UI lets the user edit section title and outline content directly.
- [ ] The UI lets the user add and delete sections while enforcing a final range of one to eight sections.
- [ ] Each section exposes `max_iterations`, defaults to five, and enforces a range of one to ten.
- [ ] The user can regenerate the outline with or without an optional regeneration instruction.
- [ ] Confirmed section structure is persisted to the Sectioned Research Job without source assignments.
- [ ] Tests cover valid output, malformed output, regeneration, validation, persistence, and localized stage/error copy.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/03-research-focus-brainstorming.md

