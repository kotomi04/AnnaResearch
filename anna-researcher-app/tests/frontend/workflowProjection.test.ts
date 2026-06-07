import { describe, expect, it } from "vitest";
import { projectGuidedStep } from "../../src/workflow/stepState";
import { projectStoredRunEvents } from "../../src/workflow/runEvents";

describe("guided workflow projection", () => {
  it("keeps sources available only on the research need step", () => {
    const need = projectGuidedStep({ phase: "idle", canStart: true });
    expect(need.current).toBe("need");
    expect(need.canOpenSources).toBe(true);

    const role = projectGuidedStep({
      requestedStep: "role",
      phase: "role_review",
      canStart: true,
      job: { research_id: "r1" },
    });
    expect(role.current).toBe("role");
    expect(role.canOpenSources).toBe(false);
  });

  it("locks planning steps during report generation", () => {
    const projected = projectGuidedStep({
      requestedStep: "outline",
      phase: "running",
      canStart: true,
      job: {
        research_id: "r1",
        confirmed_role: { server: "Analyst", agent_role_prompt: "Use sources." },
        confirmed_focuses: ["market"],
        confirmed_outline: [{ id: "section-1", title: "One", outline: "Cover one.", allowed_source_ids: ["tavily"], max_iterations: 5 }],
      },
    });
    expect(projected.current).toBe("generate");
    expect(projected.locked).toBe(true);
    expect(projected.availableSteps).toEqual(["generate"]);
  });

  it("projects completed jobs to the report step", () => {
    const projected = projectGuidedStep({
      requestedStep: "need",
      phase: "completed",
      canStart: true,
      result: { report_markdown: "# Done" },
    });
    expect(projected.current).toBe("report");
    expect(projected.availableSteps).toEqual(["report"]);
  });
});

describe("run event projection", () => {
  it("summarizes stored section events without raw results", () => {
    const events = projectStoredRunEvents({
      research_id: "r1",
      status: "completed",
      confirmed_outline: [{ id: "section-1", title: "Section One", outline: "Cover one.", allowed_source_ids: ["tavily"], max_iterations: 2 }],
      section_iterations: {
        "section-1": [{
          iteration: 1,
          source_id: "tavily",
          source_name: "Tavily",
          queries: ["anna"],
          results_count: 1,
          source_calls: [{ source_id: "tavily", source_name: "Tavily", query: "anna", results_count: 1, top_titles: ["A"], duration_ms: 1, error: null }],
        }],
      },
      section_selected_context: {
        "section-1": { source_urls: ["https://example.com"], selected_context: "raw context" },
      },
      section_results: {
        "section-1": { section_id: "section-1", status: "completed", section_summary: "summary", source_urls: ["https://example.com"] },
      },
      report_framing: { title: "Done", introduction: "Intro", conclusion: "End" },
      assembled_result: { source: "sectioned_research" },
    });

    expect(events.map((event) => event.kind)).toContain("source_call");
    expect(events.map((event) => event.kind)).toContain("context_selected");
    expect(JSON.stringify(events)).not.toContain("raw context");
  });
});
