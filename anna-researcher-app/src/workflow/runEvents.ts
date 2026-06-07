import type { ReportFraming, ReportSection, ResearchJob, SourceCallResult } from "../types";

export type RunEventKind =
  | "section_started"
  | "decision"
  | "source_call"
  | "context_selected"
  | "section_written"
  | "report_framing"
  | "final_assembly";

export interface RunEvent {
  id: string;
  kind: RunEventKind;
  title: string;
  detail: string;
  sectionId?: string;
  sectionTitle?: string;
  count?: number;
  error?: string | null;
}

export interface LiveRunEvent {
  kind: RunEventKind;
  sectionId?: string;
  sectionTitle?: string;
  title?: string;
  detail?: string;
  count?: number;
  error?: string | null;
}

export interface SectionPreview {
  id: string;
  title: string;
  summary: string;
  markdown: string;
  sourceCount: number;
}

export function makeLiveRunEvent(event: LiveRunEvent): RunEvent {
  const base = `${event.kind}-${event.sectionId || "job"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: base,
    kind: event.kind,
    sectionId: event.sectionId,
    sectionTitle: event.sectionTitle,
    title: event.title || titleFor(event.kind),
    detail: event.detail || "",
    count: event.count,
    error: event.error,
  };
}

export function sourceCallEvent(section: ReportSection, call: SourceCallResult): LiveRunEvent {
  const queries = call.queries.join(" · ");
  const error = call.error || call.calls.find((item) => item.error)?.error || null;
  return {
    kind: "source_call",
    sectionId: section.id,
    sectionTitle: section.title,
    title: `${call.source_name || call.source_id}: ${call.results_count} results`,
    detail: queries,
    count: call.results_count,
    error,
  };
}

export function sectionPreview(section: ReportSection, result: { markdown: string; summary: string; sourceUrls: string[] }): SectionPreview {
  return {
    id: section.id,
    title: section.title,
    summary: result.summary,
    markdown: result.markdown,
    sourceCount: result.sourceUrls.length,
  };
}

export function projectStoredRunEvents(job: ResearchJob | null | undefined): RunEvent[] {
  if (!job) return [];
  const sections = job.confirmed_outline || [];
  const events: RunEvent[] = [];
  for (const section of sections) {
    events.push({
      id: `${section.id}-started`,
      kind: "section_started",
      sectionId: section.id,
      sectionTitle: section.title,
      title: titleFor("section_started"),
      detail: section.title,
    });
    for (const iteration of (job.section_iterations || {})[section.id] || []) {
      const calls = iteration.source_calls || [];
      for (const call of calls) {
        events.push({
          id: `${section.id}-${iteration.iteration}-${call.source_id}-${call.query}`,
          kind: "source_call",
          sectionId: section.id,
          sectionTitle: section.title,
          title: `${call.source_name}: ${call.results_count} results`,
          detail: call.query,
          count: call.results_count,
          error: call.error,
        });
      }
    }
    const context = job.section_selected_context?.[section.id];
    if (context) {
      events.push({
        id: `${section.id}-context`,
        kind: "context_selected",
        sectionId: section.id,
        sectionTitle: section.title,
        title: titleFor("context_selected"),
        detail: `${context.source_urls.length} sources selected`,
        count: context.source_urls.length,
      });
    }
    const result = job.section_results?.[section.id];
    if (result?.status === "completed") {
      events.push({
        id: `${section.id}-written`,
        kind: "section_written",
        sectionId: section.id,
        sectionTitle: section.title,
        title: titleFor("section_written"),
        detail: result.section_summary || section.title,
      });
    }
  }
  if (job.report_framing) {
    events.push({
      id: "report-framing",
      kind: "report_framing",
      title: titleFor("report_framing"),
      detail: framingTitle(job.report_framing),
    });
  }
  if (job.assembled_result || job.status === "completed") {
    events.push({
      id: "final-assembly",
      kind: "final_assembly",
      title: titleFor("final_assembly"),
      detail: "Final report assembled",
    });
  }
  return events;
}

export function projectSectionPreviews(job: ResearchJob | null | undefined): SectionPreview[] {
  const sections = job?.confirmed_outline || [];
  return sections.flatMap((section) => {
    const result = job?.section_results?.[section.id];
    if (!result || result.status !== "completed") return [];
    return [{
      id: section.id,
      title: section.title,
      summary: result.section_summary,
      markdown: result.section_markdown || "",
      sourceCount: result.source_urls.length,
    }];
  });
}

function titleFor(kind: RunEventKind): string {
  const titles: Record<RunEventKind, string> = {
    section_started: "Section started",
    decision: "Next action decided",
    source_call: "Research source called",
    context_selected: "Context selected",
    section_written: "Section written",
    report_framing: "Report framing",
    final_assembly: "Final assembly",
  };
  return titles[kind];
}

function framingTitle(framing: ReportFraming): string {
  return framing.title || "Report framing complete";
}
