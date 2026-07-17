import type { ResearchJob, ResearchResult } from "../types";

export type GuidedStepId = "need" | "role" | "outline" | "generate" | "report";

export interface GuidedStep {
  id: GuidedStepId;
  labelKey:
    | "stepNeed"
    | "stepRole"
    | "stepOutline"
    | "stepGenerate"
    | "stepReport";
}

export const guidedSteps: GuidedStep[] = [
  { id: "need", labelKey: "stepNeed" },
  { id: "role", labelKey: "stepRole" },
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
  const locked = isLockedPhase(input.phase) || phaseStep === "generate";
  const completed = completedFor(input, phaseStep);
  const available = availableFor(input, phaseStep, locked);
  const terminal = phaseStep === "generate";
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
  if (phase === "outline_review" || phase === "generating_outline") return "outline";
  if (phase === "role_review" || phase === "starting" || phase === "generating_roles") return "role";
  if (phase === "failed") {
    if ((job?.confirmed_outline || []).length) return "generate";
    if (job?.confirmed_role) return "outline";
    if (job?.research_id) return "role";
  }
  return "need";
}

function isLockedPhase(phase: string): boolean {
  return phase === "running" || phase === "generating_roles" || phase === "generating_outline";
}

function completedFor(input: StepProjectionInput, phaseStep: GuidedStepId): GuidedStepId[] {
  const completed: GuidedStepId[] = [];
  if (input.job?.research_id || phaseStep !== "need") completed.push("need");
  if (input.job?.confirmed_role || ["outline", "generate", "report"].includes(phaseStep)) completed.push("role");
  if ((input.job?.confirmed_outline || []).length || ["generate", "report"].includes(phaseStep)) completed.push("outline");
  if (phaseStep === "report") completed.push("generate");
  return completed;
}

function availableFor(input: StepProjectionInput, phaseStep: GuidedStepId, locked: boolean): GuidedStepId[] {
  if (locked) return [phaseStep];
  if (phaseStep === "report") {
    const available: GuidedStepId[] = input.job?.research_id ? ["need"] : [];
    if (input.job?.confirmed_role) {
      available.push("role");
    }
    if ((input.job?.confirmed_outline || []).length) {
      available.push("outline", "generate");
    }
    available.push("report");
    return available;
  }
  const available: GuidedStepId[] = ["need"];
  if (input.phase === "role_review" || input.job?.research_id) available.push("role");
  if (input.phase === "outline_review" || input.job?.confirmed_role) available.push("outline");
  if (input.job?.status === "completed" && (input.result || input.job.result)) available.push("report");
  return guidedSteps.map((step) => step.id).filter((id) => available.includes(id));
}
