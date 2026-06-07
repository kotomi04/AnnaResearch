Status: ready-for-agent
Labels: ready-for-agent

# Research Focus Editable Draft Review Cards

## Parent

.scratch/guided-step-pages-ui-refresh/PRD.md

## What to build

Replace the current raw focus review form with a polished Research Focus confirmation page using Editable Draft Review Cards. The page should show a compact summary of the Confirmed Research Role, present five Research Focus candidates as cards, support selecting one to five focuses, support on-demand editing, support compact regeneration with optional instructions, and use one bottom confirmation action.

The confirmed Research Focus entries should guide later outline generation while unconfirmed candidate drafts remain frontend-only draft state.

## Acceptance criteria

- [ ] The focus page shows a compact summary of the Confirmed Research Role.
- [ ] Research Focus candidates render as selectable review cards with clear selected and unselected states.
- [ ] Users can select at least one and at most five Research Focus entries.
- [ ] Focus text editing is available on demand and does not show all edit controls by default.
- [ ] The page uses one bottom primary action to confirm selected focuses and continue.
- [ ] The compact regeneration control supports optional instructions and allows empty instructions.
- [ ] Confirming focuses persists the selected Research Focus entries and advances to outline review.
- [ ] The page remains usable in a single-column mobile layout.
- [ ] Chinese and English copy exists for focus page labels, edit actions, regeneration, selection limits, and confirmation.
- [ ] Frontend tests cover multi-selection limits, editing, regeneration control behavior, role summary display, and confirmation gating.

## Blocked by

- .scratch/guided-step-pages-ui-refresh/issues/01-guided-research-step-pages-shell.md
- .scratch/guided-step-pages-ui-refresh/issues/02-research-role-editable-draft-review-cards.md
