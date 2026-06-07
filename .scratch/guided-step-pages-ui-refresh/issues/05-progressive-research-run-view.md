Status: ready-for-agent
Labels: ready-for-agent

# Progressive Research Run View

## Parent

.scratch/guided-step-pages-ui-refresh/PRD.md

## What to build

Build the dedicated Report Generation Page around a Progressive Research Run View. The view should make Serial Section Research feel active and trustworthy by showing stage/event/section-level updates rather than token-level LLM streaming.

The page should show the active section, section count progress, current section metadata, Allowed Research Sources, iteration limit, visible run events, source call summaries, query summaries, result counts, errors, context selection, section writer completion, completed section previews, Report Framing, and final assembly. It should include a subtle active run indicator so users do not think the job is stuck.

The view should avoid exposing raw selected context, raw LLM transcripts, raw search result dumps, credentials, or debug data.

## Acceptance criteria

- [ ] Report generation is shown on a dedicated page separate from planning and final report reading.
- [ ] The page shows the active section and current section count out of total sections.
- [ ] The page shows current section metadata, Allowed Research Sources, and iteration limit.
- [ ] The page displays an active run indicator while generation is running.
- [ ] The page appends or reveals user-visible run events for section start, Research Step Decision, Research Source call, context selection, section writer completion, Report Framing, and final assembly.
- [ ] Research Source call events show source name, queries, result counts, and classified error summaries when present.
- [ ] Completed sections appear with collapsible previews or summaries.
- [ ] Raw selected context, raw LLM transcripts, raw result dumps, credentials, and debug payloads are not shown by default.
- [ ] The page does not offer Back navigation to edit role, focus, or outline during generation.
- [ ] Chinese and English copy exists for run events, active states, errors, and section progress.
- [ ] Frontend tests cover run event projection, active state behavior, source call display, section completion preview, framing/final assembly events, and locked generation navigation.

## Blocked by

- .scratch/guided-step-pages-ui-refresh/issues/01-guided-research-step-pages-shell.md
- .scratch/guided-step-pages-ui-refresh/issues/04-confirmed-research-outline-review-page.md
