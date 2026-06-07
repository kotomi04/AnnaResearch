Status: ready-for-agent
Labels: ready-for-agent

# Separated Report Display Page

## Parent

.scratch/guided-step-pages-ui-refresh/PRD.md

## What to build

Build a dedicated Report Display Page for the completed Assembled Research Report. The final report should no longer share its main page with planning controls or the running report generation view. When report generation completes, the app should automatically transition from Report Generation Page to Report Display Page.

The page should prioritize Safe Report Markdown Rendering, source URLs, and a clear new-research action. The research process summary should remain available but collapsed or secondary by default so the report page reads like a polished final deliverable rather than a crowded workbench.

## Acceptance criteria

- [ ] Completed report viewing happens on a dedicated Report Display Page.
- [ ] The app automatically transitions from report generation to report display when the final result completes.
- [ ] The final report remains rendered through Safe Report Markdown Rendering.
- [ ] Source URLs are shown with the final report.
- [ ] A new-research action is available from the final report page.
- [ ] Research process details are available through a collapsed or secondary summary by default.
- [ ] The process summary includes section-level and source-call summary information without raw context or debug dumps.
- [ ] The report page remains usable in desktop and mobile layouts.
- [ ] Chinese and English copy exists for report display, source URLs, new research, and process summary controls.
- [ ] Frontend tests cover automatic transition, report/source rendering, collapsed process summary behavior, and absence of raw HTML injection behavior.

## Blocked by

- .scratch/guided-step-pages-ui-refresh/issues/05-progressive-research-run-view.md
