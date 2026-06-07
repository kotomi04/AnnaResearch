Status: ready-for-agent
Labels: ready-for-agent

# Confirmed Research Outline Review Page

## Parent

.scratch/guided-step-pages-ui-refresh/PRD.md

## What to build

Replace the current always-expanded outline editor with a Confirmed Research Outline review page built around compact draft Report Section cards. The page should show compact summaries of the Confirmed Research Role and selected Research Focus entries, render each draft Report Section as a scannable card, and allow on-demand editing of section title, outline content, Allowed Research Sources, and iteration limit.

The page should support adding and deleting sections. It should not use drag-and-drop ordering. If section ordering is included, use explicit up/down controls. The page's primary action should be Start Generation, which is the lock boundary for the Confirmed Research Role, Research Focus entries, and Confirmed Research Outline.

## Acceptance criteria

- [ ] The outline page shows compact summaries of the confirmed role and selected focuses.
- [ ] Draft Report Sections render as compact cards with title, outline summary, Allowed Research Source chips, and iteration limit.
- [ ] Section title, outline content, Allowed Research Sources, and iteration limit are editable on demand.
- [ ] Each section enforces at least one Allowed Research Source before generation can start.
- [ ] Section iteration limits are constrained to one through ten.
- [ ] Users can add and delete sections while preserving the one-to-eight section boundary.
- [ ] Drag-and-drop ordering is not introduced.
- [ ] If ordering controls are included, they use explicit up/down actions and work on desktop and mobile.
- [ ] Start Generation is the single strong primary action and enters the locked report generation step.
- [ ] Chinese and English copy exists for outline summaries, section editing, source chips, iteration controls, validation, and Start Generation.
- [ ] Frontend tests cover compact display, expansion, editing, source selection, iteration limits, add/delete, optional up/down ordering, and Start Generation gating.

## Blocked by

- .scratch/guided-step-pages-ui-refresh/issues/01-guided-research-step-pages-shell.md
- .scratch/guided-step-pages-ui-refresh/issues/03-research-focus-editable-draft-review-cards.md
