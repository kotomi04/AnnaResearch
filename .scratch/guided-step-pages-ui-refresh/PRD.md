Status: ready-for-agent
Labels: ready-for-agent

# PRD: Guided Step Pages UI Refresh

## Problem Statement

The current Anna Researcher App Shell starts with a visually acceptable research need page, but the later guided workflow pages feel unfinished and visually inconsistent. Research Role candidate cards, Research Focus candidate cards, and Confirmed Research Outline editing are rendered as dense always-expanded forms. The user cannot clearly perceive the guided flow as separate steps, and the report generation and final report reading experiences share the same page surface.

During Serial Section Research, the app also lacks a Progressive Research Run View. The user sees coarse status and a timeline, but not a clear sense that the job is actively progressing through sections, Research Source calls, section writing, Report Framing, and final assembly. This makes the running state feel stuck even when work is happening.

The user wants a modern, polished interface that preserves the current first-page visual style while restructuring the guided workflow into clear Guided Research Step Pages with a Workflow Stepper, better draft review cards, a dedicated report generation page, and a dedicated final report page.

## Solution

Refresh the Anna App Shell frontend around Guided Research Step Pages. Keep the app as a single Anna App Shell SPA without URL routing, but present each workflow stage as one mutually exclusive step page:

1. Research need
2. Research role confirmation
3. Research focus confirmation
4. Confirmed Research Outline review
5. Report generation
6. Report display

Add a Workflow Stepper at the top of the guided flow. The stepper communicates the user's position in the flow and supports returning to earlier draft steps before report generation starts. Once the user starts report generation, the Confirmed Research Role, Research Focus entries, and Confirmed Research Outline are locked; the user can no longer navigate back to edit planning decisions during Serial Section Research.

Replace the always-expanded role, focus, and outline forms with Editable Draft Review Cards. Cards should support quick comparison and selection by default, with editing available on demand. Role candidates remain editable before confirmation. Research Focus candidates remain editable before confirmation and support selecting one to five focuses. Draft Report Sections show compact section summaries by default and expand for editing title, outline content, Allowed Research Sources, and section iteration settings.

Create a dedicated Report Generation Page that contains the Progressive Research Run View. It should reveal orchestration events at the stage/event/section level rather than token-level LLM streaming. It should show an active run indicator with a subtle breathing or activity feel so the user does not think the job is stuck. It should show current section progress, Research Source calls, query summaries, result counts, context selection, section writing completion, Report Framing, final assembly, and completed section previews.

Create a dedicated Report Display Page for the final Assembled Research Report. It should use Safe Report Markdown Rendering, focus on reading the report, show source URLs, and keep the research process summary behind a collapsed or secondary entry point by default. When report generation completes, the app should automatically transition from the Report Generation Page to the Report Display Page.

Keep Research Source configuration behind a Research Source Configuration Gate. Users may open the Research Source Panel only from the research need step. Once the user leaves that step, the app should not present Research Source configuration entry points in role, focus, outline, generation, or report pages.

## User Stories

1. As an Anna user, I want the guided research flow split into clear step pages, so that I understand where I am in the workflow.
2. As an Anna user, I want the app to remain one Anna App Shell SPA, so that the app stays lightweight and compatible with the Anna runtime.
3. As an Anna user, I want a Workflow Stepper, so that I can see the full path from research need to final report.
4. As an Anna user, I want the Workflow Stepper to show the current step, so that the interface feels predictable.
5. As an Anna user, I want to return to earlier draft steps before report generation starts, so that I can correct my planning choices.
6. As an Anna user, I want report generation to lock my confirmed planning decisions, so that the running research job cannot be accidentally changed.
7. As an Anna user, I want no Back action during report generation, so that I know the app is executing the approved plan.
8. As an Anna user, I want the research need page to keep its current polished visual direction, so that the app still feels familiar.
9. As an Anna user, I want Research Source configuration available from the research need page, so that I can prepare sources before starting.
10. As an Anna user, I do not want Research Source configuration entry points after the research need step, so that source changes cannot disturb draft review or running research.
11. As an Anna user, I want missing source configuration errors to keep me on the research need step, so that I can fix the issue in the right place.
12. As an Anna user, I want Research Role candidates shown as polished review cards, so that I can compare options quickly.
13. As an Anna user, I want to select one Research Role candidate before continuing, so that the app has one Confirmed Research Role.
14. As an Anna user, I want to edit a role candidate on demand, so that I can adjust the role name and prompt before confirming.
15. As an Anna user, I want role cards to avoid showing all textareas by default, so that the page does not feel like a raw form dump.
16. As an Anna user, I want a single bottom action to confirm the selected role, so that the page has one clear primary action.
17. As an Anna user, I want role regeneration to be available without taking over the page, so that I can ask for better candidates only when needed.
18. As an Anna user, I want optional role regeneration instructions, so that I can steer the next candidate set.
19. As an Anna user, I want empty regeneration instructions to be accepted, so that I can quickly ask for another candidate set.
20. As an Anna user, I want the Research Focus page to show my confirmed role summary, so that I understand what context shapes the focus candidates.
21. As an Anna user, I want Research Focus candidates shown as polished review cards, so that I can compare research angles quickly.
22. As an Anna user, I want to select one to five Research Focus entries, so that the report has a clear but flexible direction.
23. As an Anna user, I want to edit focus candidate text on demand, so that I can tune a focus before confirming it.
24. As an Anna user, I want a single bottom action to confirm selected focuses, so that the page interaction is consistent with role confirmation.
25. As an Anna user, I want focus regeneration to be available through a compact action, so that the page stays clean.
26. As an Anna user, I want optional focus regeneration instructions, so that I can steer brainstorming without starting over.
27. As an Anna user, I want the outline page to show my confirmed role and focus summaries, so that the draft outline has visible context.
28. As an Anna user, I want draft Report Sections shown as compact cards, so that I can scan the whole outline before editing details.
29. As an Anna user, I want each section card to show title, outline summary, Allowed Research Sources, and iteration limit, so that I can evaluate the section at a glance.
30. As an Anna user, I want section editing to expand on demand, so that the outline page stays readable.
31. As an Anna user, I want to edit a section title, so that final report headings match my vocabulary.
32. As an Anna user, I want to edit section outline content, so that the section covers the right research angle.
33. As an Anna user, I want to edit Allowed Research Sources for a section, so that the section uses only trusted sources.
34. As an Anna user, I want Allowed Research Sources displayed as chips, so that source assignments are easy to scan.
35. As an Anna user, I want to adjust a section's iteration limit from one to ten, so that I can control depth and cost.
36. As an Anna user, I want to add a Report Section, so that I can cover a missing topic.
37. As an Anna user, I want to delete a Report Section, so that irrelevant sections do not consume research time.
38. As an Anna user, I want section ordering to use simple up/down controls if reordering is needed, so that the interaction remains stable.
39. As an Anna user, I do not need drag-and-drop section ordering, so that the outline editor remains reliable across devices.
40. As an Anna user, I want a single strong action to start report generation from the outline page, so that I understand this starts the locked run.
41. As an Anna user, I want the Report Generation Page to show the currently active section, so that I know what the app is working on.
42. As an Anna user, I want the Report Generation Page to show section count progress, so that I can see how much work remains.
43. As an Anna user, I want the Report Generation Page to show a subtle active indicator, so that I can tell the app has not frozen.
44. As an Anna user, I want the Report Generation Page to append visible research events, so that progress feels incremental.
45. As an Anna user, I want to see when a section starts, so that section boundaries are clear.
46. As an Anna user, I want to see when the app is deciding the next research step, so that LLM planning work is visible.
47. As an Anna user, I want to see Research Source calls with source name, queries, and result counts, so that I understand what evidence is being gathered.
48. As an Anna user, I want source call errors summarized in the run view, so that failures do not disappear.
49. As an Anna user, I want to see when section context is selected, so that I understand when evidence is being prepared for writing.
50. As an Anna user, I want to see when a section writer finishes, so that completed work becomes visible before the final report.
51. As an Anna user, I want completed section previews to be collapsible, so that I can inspect progress without overwhelming the page.
52. As an Anna user, I want Report Framing and final assembly events shown, so that I know what happens after section research finishes.
53. As an Anna user, I do not want raw selected context or raw search result dumps in the run page, so that the page remains usable.
54. As an Anna user, I want the app to move automatically to the final report after generation completes, so that I can start reading immediately.
55. As an Anna user, I want the final report on its own page, so that reading is not mixed with planning controls.
56. As an Anna user, I want the final report page to render markdown safely, so that generated content cannot inject raw HTML.
57. As an Anna user, I want source URLs shown with the final report, so that I can inspect evidence.
58. As an Anna user, I want the research process summary available from the final report page, so that I can audit how the report was produced.
59. As an Anna user, I want the process summary collapsed by default, so that the final report page stays focused on reading.
60. As an Anna user, I want the final report page to offer starting a new research request, so that I can begin another run.
61. As an Anna user, I want Chinese and English UI copy for the refreshed workflow, so that the Bilingual App Shell UI remains complete.
62. As a mobile user, I want every guided step to remain usable in a single-column layout, so that I can complete research on smaller screens.
63. As a mobile user, I want text and controls not to overlap or overflow, so that the app remains usable on narrow viewports.
64. As a desktop user, I want richer layouts such as multi-column cards and report sidebars where space allows, so that the app feels efficient.
65. As an Anna App developer, I want this UI refresh to preserve frontend-owned orchestration, so that it remains aligned with ADR 0006.
66. As an Anna App developer, I want to avoid backend protocol changes unless a confirmed requirement cannot be met from frontend state, so that implementation risk stays low.
67. As an Anna App developer, I want no requirement for refresh-time background continuation, so that the current frontend-owned run boundary remains honest.
68. As an Anna App developer, I want interrupted runs after refresh to show recoverable persisted state without pretending the job is still running, so that user expectations stay accurate.
69. As an Anna App developer, I want the refreshed UI to preserve Safe Report Markdown Rendering, so that security posture does not regress.
70. As an Anna App developer, I want to avoid a full UI component library, so that the app keeps its existing visual system and bundle footprint.
71. As an Anna App developer, I want `lucide-react` icons allowed if useful, so that buttons and step states can be more legible without adopting a large component framework.
72. As an Anna App developer, I want the Committed App Shell Bundle updated through the App Shell Build Workflow, so that Anna runtime still loads the latest UI.

## Implementation Decisions

- Keep the feature inside the Anna App Shell unless a hard requirement proves impossible without backend changes. The currently confirmed scope can be implemented with frontend source, frontend tests, dependency updates if needed, and rebuilt bundle output.
- Preserve the frontend-owned Anna Research Orchestrator from ADR 0006. Do not move role selection, focus selection, outline review, section execution, Progressive Research Run View state, Report Framing, or final assembly into the Researcher Tool Backend.
- Keep the app as one static SPA. Guided Research Step Pages are mutually exclusive in-app step states, not URL routes.
- Introduce a Workflow Stepper separate from job progress. The Workflow Stepper shows planning/report flow position. Job/run progress belongs inside the Report Generation Page.
- The step order is research need, role confirmation, focus confirmation, outline review, report generation, and report display.
- Users may return to earlier draft review steps before report generation starts. Once report generation starts, the Confirmed Research Role, Research Focus entries, and Confirmed Research Outline are locked.
- Research Source configuration is gated to the research need step. Later steps should not show Research Source Panel entry points.
- If no enabled configured Research Source exists, keep or return the user to the research need step with a clear configuration error.
- Replace always-expanded role, focus, and outline forms with Editable Draft Review Cards. Cards default to readable comparison mode and reveal editing controls on demand.
- Role selection should use selectable cards plus a single bottom confirmation action. Do not keep one primary confirm button inside each role card.
- Focus selection should use selectable cards plus a single bottom confirmation action. It must enforce one to five selected Research Focus entries.
- Regeneration for role, focus, and outline drafts should be a compact action that opens optional instruction input only when needed. The optional instruction may be empty.
- The outline page should render compact Report Section cards by default. Each card can expand for section title, outline content, Allowed Research Sources, and iteration settings.
- Outline reordering should avoid drag-and-drop. If reordering is included, use explicit up/down controls.
- The outline page's primary action should be a clear Start Generation action. This is the lock boundary.
- The Report Generation Page should implement the Progressive Research Run View using stage/event/section-level updates, not token-level streaming.
- The Progressive Research Run View should show active section, section count progress, current section metadata, allowed sources, iteration limit, source calls, query summaries, result counts, errors, context selection, section writer completion, Report Framing, final assembly, and completed section previews.
- The Progressive Research Run View should include an active run indicator with a subtle breathing or activity feel.
- Do not show raw selected context, raw LLM transcripts, or raw search result dumps in the default run view.
- The Report Display Page should be separate from the Report Generation Page. Generation completion should automatically transition to report display.
- The Report Display Page should keep the final Assembled Research Report as the primary content and show process details only through a collapsed or secondary summary.
- Continue to use Safe Report Markdown Rendering. Do not use raw HTML injection for report markdown.
- Continue the current visual direction from the research need page: centered app window, soft light background, restrained purple primary actions, and polished modern controls.
- Avoid making the full workflow a one-note purple interface. Use neutral surfaces and information hierarchy for cards, lists, and summaries, with purple reserved for primary actions and selected states.
- Mobile layouts must remain fully usable and may degrade to single-column layouts. Desktop can use multi-column cards and secondary panels where space allows.
- Do not introduce a full UI component library. `lucide-react` may be introduced for icons if useful.
- If `lucide-react` is added, update package metadata and lockfile.
- Rebuild the Committed App Shell Bundle from source after frontend changes. Do not hand-edit bundle files.

Major modules to build or modify:

- A guided page state model for mapping research phase, lock state, and latest result state into Guided Research Step Pages.
- A Workflow Stepper component with locked, current, completed, and available-draft navigation states.
- Reusable Editable Draft Review Card primitives for role candidates, Research Focus candidates, and draft Report Sections.
- A compact regeneration control for optional regeneration instructions.
- A Report Generation Page component that renders Progressive Research Run View state.
- A run event projection helper that derives user-visible run events from frontend orchestration events, job state, section iterations, section results, and final assembly state.
- A Report Display Page component that separates final report reading from process summary.
- Responsive styles that preserve the existing Anna App Shell visual direction while improving card, stepper, run view, and report layouts.
- Bilingual App Shell UI messages for new step labels, actions, validation states, regeneration controls, run events, locked plan summaries, and process summaries.

Deep module opportunities:

- A step-state projection module that accepts app page state, research phase, job status, and result availability, and returns the current Guided Research Step Page plus allowed navigation targets. This should be testable without rendering React.
- A run-event projection module that accepts current job and in-memory run progress data and returns stable display events for the Progressive Research Run View. This should be testable without depending on CSS or DOM layout.
- A plan-summary projection module that converts Confirmed Research Role, Research Focus entries, and Confirmed Research Outline into compact summaries used across focus, outline, generation, and report pages.

## Testing Decisions

- Tests should assert external behavior and stable contracts, not private component implementation details.
- Frontend tests should cover the Workflow Stepper's current/completed/locked states and draft-step navigation.
- Frontend tests should cover mutually exclusive Guided Research Step Pages: research need, role confirmation, focus confirmation, outline review, report generation, and report display.
- Frontend tests should cover the Research Source Configuration Gate: the source entry appears only on the research need step and not later.
- Frontend tests should cover role candidate selection, on-demand editing, regeneration control visibility, and single bottom confirmation.
- Frontend tests should cover Research Focus multi-selection from one to five entries, on-demand editing, regeneration control visibility, and confirmation gating.
- Frontend tests should cover outline section compact display, expansion, editing, add/delete, optional up/down reordering if implemented, source selection, iteration limit validation, and Start Generation gating.
- Frontend tests should cover the Report Generation Page event stream with active section, source call event, section completion preview, Report Framing event, and final assembly event.
- Frontend tests should cover the active run indicator at a behavioral level where feasible, such as a running-state class or accessible label, without testing animation implementation details.
- Frontend tests should cover automatic transition from report generation to report display when the result completes.
- Frontend tests should cover the final Report Display Page rendering the report separately from the process summary.
- Frontend tests should cover the process summary being collapsed or secondary by default.
- Frontend tests should cover Safe Report Markdown Rendering remains in use through report behavior, not raw HTML injection.
- Frontend tests should cover Chinese and English copy for new labels and status messages.
- Responsive behavior should be checked for mobile and desktop layouts, especially text overflow, stepper fit, card layout, and report/process summary layout.
- If `lucide-react` is introduced, normal package and build verification should ensure the dependency is bundled locally and no CDN assets are used.
- Verification commands should include `npm run test:frontend` and `npm run build`.
- The build must update the committed static bundle output.
- Do not run `anna-app dev` as part of normal verification.
- If visual verification is needed, use ordinary frontend dev/static build inspection rather than Anna runtime or long-running Anna bridge processes.
- Existing prior art includes frontend rendering tests, `useResearchJob` workflow tests, app runtime tests, i18n tests, raw HTML regression tests, bundle contract tests, and the App Shell Build Workflow.

## Out of Scope

- Do not implement token-level LLM streaming.
- Do not move Anna Research Orchestrator responsibilities into the Researcher Tool Backend.
- Do not add backend-owned background continuation after refresh.
- Do not claim a running job continues after refresh when frontend-owned orchestration has been interrupted.
- Do not add URL routing for guided steps.
- Do not add a full UI component library such as MUI, Ant Design, or shadcn as a dependency.
- Do not add external CDN assets or remote static resources.
- Do not add cancellation, retry orchestration, job history, multi-job management, follow-up chat, or report exports.
- Do not add drag-and-drop section ordering.
- Do not expose raw selected context, raw LLM transcripts, full raw search results, credentials, or debug dumps in the default UI.
- Do not hand-edit generated bundle files.
- Do not change Research Source, job store, or App Tool Method contracts unless implementation discovers a confirmed requirement cannot be met from frontend state.

## Further Notes

This PRD follows ADR 0006 and the glossary terms in `CONTEXT.md`, especially Guided Research Step Pages, Workflow Stepper, Editable Draft Review Card, Progressive Research Run View, Research Source Configuration Gate, Safe Report Markdown Rendering, and Assembled Research Report.

The most important product boundary is that the UI should feel like a polished guided research application rather than a single page containing several raw forms. Each step should have one clear job, one primary action, and enough context from earlier confirmed choices without stacking the entire workflow onto every page.

The most important architectural boundary is that this is primarily a frontend UI and presentation-state refresh. It should not weaken the frontend-owned orchestration model or introduce backend protocol changes unless a concrete implementation blocker proves one is necessary.

The most important experience boundary is that the Report Generation Page should make work visible at the stage/event/section level. It should feel active and trustworthy without pretending to provide token-level streaming.
