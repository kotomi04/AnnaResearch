import type { MessageKey } from "../i18n/messages";
import { guidedSteps, type GuidedStepId } from "../workflow/stepState";

interface Props {
  current: GuidedStepId;
  completed: GuidedStepId[];
  available: GuidedStepId[];
  locked: boolean;
  t(key: MessageKey): string;
  onNavigate(step: GuidedStepId): void;
}

export function WorkflowStepper({ current, completed, available, locked, t, onNavigate }: Props) {
  return (
    <nav className="workflow-stepper" aria-label={t("workflowStepperAria")}>
      {guidedSteps.map((step, index) => {
        const isCurrent = step.id === current;
        const isCompleted = completed.includes(step.id);
        const isAvailable = available.includes(step.id) && !isCurrent && !locked;
        return (
          <button
            type="button"
            key={step.id}
            className="workflow-step"
            data-current={isCurrent ? "true" : "false"}
            data-completed={isCompleted ? "true" : "false"}
            disabled={!isAvailable}
            onClick={() => onNavigate(step.id)}
          >
            <span className="workflow-step-index">{isCompleted ? "✓" : index + 1}</span>
            <span>{t(step.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
