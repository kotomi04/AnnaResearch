Status: ready-for-agent
Labels: ready-for-agent

# Report Framing 与最终报告拼接

## Parent

.scratch/guided-sectioned-research-workflow/PRD.md

## What to build

After all sections complete, add Report Framing and final report assembly. The Anna App Shell should call Frontend LLM Completion with only the original query, confirmed focuses, outline titles, and Section Summaries, then generate title, introduction, and conclusion. The app should assemble final markdown in code using the framing output plus section markdown in Confirmed Research Outline order, and persist it as one Research Result.

The final LLM call must not receive all section markdown and must not rewrite section bodies.

## Acceptance criteria

- [ ] Report Framing prompt receives query, confirmed focuses, outline titles, and Section Summaries only.
- [ ] Report Framing output generates title, introduction, and conclusion without rewriting section bodies.
- [ ] Final markdown is assembled in code in Confirmed Research Outline order.
- [ ] Final source URLs are preserved across all sections.
- [ ] The assembled report is persisted as one Research Result using the existing large-result transfer pattern where appropriate.
- [ ] Tests verify final prompt input shape, assembly order, no final full-section rewrite, source URL preservation, persistence, and parser fallback.

## Blocked by

- .scratch/guided-sectioned-research-workflow/issues/07-serial-section-execution-progress.md
- .scratch/guided-sectioned-research-workflow/issues/09-section-writer-output-fallback.md

