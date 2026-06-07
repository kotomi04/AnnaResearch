import type { ResearchJob, ResearchResult } from "../types";

export type GuidedStepId = "need" | "role" | "focus" | "outline" | "generate" | "report";

export interface GuidedStep {
  id: GuidedStepId;
  labelKey:
    | "stepNeed"
    | "stepRole"
    | "stepFocus"
    | "stepOutline"
    | "stepGenerate"
    | "stepReport";
}

export const guidedSteps: GuidedStep[] = [
  { id: "need", labelKey: "stepNeed" },
  { id: "role", labelKey: "stepRole" },
  { id: "focus", labelKey: "stepFocus" },
  { id: "outline", labelKey: "stepOutline" },
  { id: "generate", labelKey: "stepGenerate" },
  { id: "report", labelKey: "stepReport" },
];

export interface StepProjectionInput {
  requestedStep?: GuidedStepId;
  phase: string;
  canStart: boolean;
  job?: ResearchJob | null;
  result?: ResearchResult | null;
}

export interface StepProjection {
  current: GuidedStepId;
  locked: boolean;
  canOpenSources: boolean;
  availableSteps: GuidedStepId[];
  completedSteps: GuidedStepId[];
}

export function projectGuidedStep(input: StepProjectionInput): StepProjection {
  const phaseStep = stepForPhase(input.phase, input.job, input.result);
  const locked = input.phase === "running" || phaseStep === "generate";
  const completed = completedFor(input, phaseStep);
  const available = availableFor(input, phaseStep, locked);
  const terminal = phaseStep === "generate" || phaseStep === "report";
  const requested = !terminal && input.requestedStep && available.includes(input.requestedStep) ? input.requestedStep : undefined;
  const current = requested ?? phaseStep;
  return {
    current,
    locked,
    canOpenSources: current === "need" && !locked,
    availableSteps: available,
    completedSteps: completed,
  };
}

export function stepIndex(step: GuidedStepId): number {
  return guidedSteps.findIndex((item) => item.id === step);
}

function stepForPhase(phase: string, job?: ResearchJob | null, result?: ResearchResult | null): GuidedStepId {
  if (phase === "completed" || job?.status === "completed" || result?.report_markdown) return "report";
  if (phase === "running" || phase === "loading_result") return "generate";
  if (phase === "outline_review") return "outline";
  if (phase === "focus_review") return "focus";
  if (phase === "role_review" || phase === "starting") return "role";
  return "need";
}

function completedFor(input: StepProjectionInput, phaseStep: GuidedStepId): GuidedStepId[] {
  const completed: GuidedStepId[] = [];
  if (input.job?.research_id || phaseStep !== "need") completed.push("need");
  if (input.job?.confirmed_role || ["focus", "outline", "generate", "report"].includes(phaseStep)) completed.push("role");
  if ((input.job?.confirmed_focuses || []).length || ["outline", "generate", "report"].includes(phaseStep)) completed.push("focus");
  if ((input.job?.confirmed_outline || []).length || ["generate", "report"].includes(phaseStep)) completed.push("outline");
  if (phaseStep === "report") completed.push("generate");
  return completed;
}

function availableFor(input: StepProjectionInput, phaseStep: GuidedStepId, locked: boolean): GuidedStepId[] {
  if (phaseStep === "report") return ["report"];
  if (locked) return ["generate"];
  const available: GuidedStepId[] = ["need"];
  if (input.phase === "role_review" || input.job?.research_id) available.push("role");
  if (input.phase === "focus_review" || input.job?.confirmed_role) available.push("focus");
  if (input.phase === "outline_review" || (input.job?.confirmed_focuses || []).length) available.push("outline");
  return guidedSteps.map((step) => step.id).filter((id) => available.includes(id));
}
