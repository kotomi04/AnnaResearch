Status: ready-for-agent
Labels: ready-for-agent

# Guided Research Step Pages Shell

## Parent

.scratch/guided-step-pages-ui-refresh/PRD.md

## What to build

Build the first tracer bullet for Guided Research Step Pages in the Anna App Shell. The app should remain one SPA without URL routing, but the user should now see a clear six-step workflow shell: research need, role confirmation, focus confirmation, outline review, report generation, and report display.

This slice should introduce the step-state projection needed to map current research phase, result availability, and locked generation state into one active step. It should add a Workflow Stepper that is separate from job progress. It should also enforce the Research Source Configuration Gate by keeping Research Source configuration entry points available only on the research need step.

This slice does not need to redesign the role, focus, outline, generation, or report content in full. It should establish the navigable shell and prove the page separation with minimal placeholder or existing content where needed.

## Acceptance criteria

- [ ] The app presents research need, role confirmation, focus confirmation, outline review, report generation, and report display as mutually exclusive Guided Research Step Pages.
- [ ] A Workflow Stepper shows the current workflow step and does not reuse or replace job progress.
- [ ] The user can return to available earlier draft steps before report generation starts.
- [ ] Once report generation starts, prior planning steps are shown as locked or completed and cannot be edited through the stepper.
- [ ] Research Source configuration entry points appear only on the research need step.
- [ ] If no enabled configured Research Source is available, the user remains on or is returned to the research need step with a clear error.
- [ ] Chinese and English labels exist for the new step names and gate/error states.
- [ ] Frontend tests cover step projection, mutually exclusive page display, stepper state, and Research Source Configuration Gate behavior.

## Blocked by

None - can start immediately
