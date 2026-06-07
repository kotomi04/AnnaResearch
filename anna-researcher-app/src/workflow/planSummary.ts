import type { ConfirmedResearchRole, ReportSection, ResearchSourceView } from "../types";

export interface PlanSummary {
  roleName: string;
  rolePrompt: string;
  focuses: string[];
  sectionCount: number;
  totalIterations: number;
}

export function summarizePlan(input: {
  role?: ConfirmedResearchRole | null;
  focuses?: string[];
  sections?: ReportSection[];
}): PlanSummary {
  const sections = input.sections || [];
  return {
    roleName: input.role?.server || "",
    rolePrompt: input.role?.agent_role_prompt || "",
    focuses: input.focuses || [],
    sectionCount: sections.length,
    totalIterations: sections.reduce((sum, section) => sum + Math.max(1, Number(section.max_iterations || 1)), 0),
  };
}

export function readySourceNameMap(sources: ResearchSourceView[]): Map<string, string> {
  return new Map(
    sources
      .filter((source) => source.enabled && source.credential_status === "configured")
      .map((source) => [source.id, source.name || source.id]),
  );
}

export function sectionSourceNames(section: ReportSection, sourceNames: Map<string, string>): string[] {
  return section.allowed_source_ids.map((id) => sourceNames.get(id) || id);
}
