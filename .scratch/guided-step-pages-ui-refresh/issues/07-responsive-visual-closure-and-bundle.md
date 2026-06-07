Status: ready-for-agent
Labels: ready-for-agent

# Responsive Visual Closure And Bundle

## Parent

.scratch/guided-step-pages-ui-refresh/PRD.md

## What to build

Close the Guided Step Pages UI Refresh with a visual, responsive, localization, and bundle pass. The full workflow should feel consistent with the existing polished research need page while improving role, focus, outline, run, and report surfaces. The design should use neutral hierarchy and reserve purple for primary actions and selected states, avoiding a one-note purple interface.

This slice should finish mobile and desktop layout behavior, add icons if useful through an allowed local dependency, complete bilingual copy, run frontend verification, and rebuild the Committed App Shell Bundle through the normal App Shell Build Workflow.

## Acceptance criteria

- [ ] All Guided Research Step Pages share a coherent visual system with the existing research need page.
- [ ] The UI uses neutral surfaces and clear hierarchy, with purple reserved for selected states and primary actions.
- [ ] Desktop layouts use available space effectively without overcrowding.
- [ ] Mobile layouts degrade to single-column or compact layouts without losing functionality.
- [ ] Text and controls do not overlap or overflow on mobile or desktop.
- [ ] `lucide-react` may be added if icons are useful; if added, package metadata and lockfile are updated.
- [ ] No full UI component library or external CDN assets are introduced.
- [ ] Chinese and English copy is complete for all refreshed workflow states.
- [ ] Frontend tests pass through the normal frontend test command.
- [ ] The static bundle is rebuilt from source and committed as generated output.
- [ ] The Anna runtime dev server is not started as part of verification.

## Blocked by

- .scratch/guided-step-pages-ui-refresh/issues/01-guided-research-step-pages-shell.md
- .scratch/guided-step-pages-ui-refresh/issues/02-research-role-editable-draft-review-cards.md
- .scratch/guided-step-pages-ui-refresh/issues/03-research-focus-editable-draft-review-cards.md
- .scratch/guided-step-pages-ui-refresh/issues/04-confirmed-research-outline-review-page.md
- .scratch/guided-step-pages-ui-refresh/issues/05-progressive-research-run-view.md
- .scratch/guided-step-pages-ui-refresh/issues/06-separated-report-display-page.md
