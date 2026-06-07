Status: ready-for-agent
Labels: ready-for-agent

# Research Role Editable Draft Review Cards

## Parent

.scratch/guided-step-pages-ui-refresh/PRD.md

## What to build

Replace the current raw role review form with a polished Research Role confirmation page using Editable Draft Review Cards. The user should compare three Research Role candidates, select exactly one candidate, optionally edit the selected candidate on demand, regenerate candidates through a compact optional-instruction control, and continue through one bottom confirmation action.

The page should keep the current Anna App Shell visual direction while avoiding always-expanded textareas. Unconfirmed candidates remain draft state; only the user's selected role is confirmed when continuing.

## Acceptance criteria

- [ ] Research Role candidates render as selectable review cards with clear selected and unselected states.
- [ ] Role candidate editing is available on demand and does not show all long inputs by default.
- [ ] The page uses one bottom primary action to confirm the selected role and continue.
- [ ] Per-card primary confirm buttons are removed.
- [ ] The compact regeneration control supports optional instructions and allows empty instructions.
- [ ] Confirming a role persists exactly one Confirmed Research Role and advances to the next step.
- [ ] The page remains usable in a single-column mobile layout.
- [ ] Chinese and English copy exists for role page labels, edit actions, regeneration, and confirmation.
- [ ] Frontend tests cover selecting a role, editing a role, regeneration control behavior, and bottom confirmation gating.

## Blocked by

- .scratch/guided-step-pages-ui-refresh/issues/01-guided-research-step-pages-shell.md
