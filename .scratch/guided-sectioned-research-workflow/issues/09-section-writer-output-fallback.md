Status: ready-for-agent
Labels: ready-for-agent

# Section Writer Output 生成与 fallback

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

Replace the whole-report writer path for the sectioned workflow with a section writer. For each Report Section, the Anna App Shell should ask Frontend LLM Completion to generate structured Section Writer Output containing both `section_markdown` and `section_summary` in one call. If parsing fails but the model returned useful text, the app should treat that text as section markdown and derive a minimal Section Summary.

## Acceptance criteria

- [ ] Section writer prompt is scoped to one Report Section and receives section outline, Confirmed Research Role, confirmed focuses, and that section's selected context.
- [ ] The prompt asks for structured output with `section_markdown` and `section_summary`.
- [ ] Valid structured output persists section markdown, section summary, section source URLs, and section result status.
- [ ] Malformed structured output falls back by treating model text as markdown and deriving a minimal summary when useful markdown exists.
- [ ] Empty or unusable section writer output marks the section failed and stops the Sectioned Research Job.
- [ ] Tests cover valid JSON, JSON embedded in text, malformed JSON, missing fields, empty output, fallback behavior, and failure behavior.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/08-per-section-lexical-context-selector.md

