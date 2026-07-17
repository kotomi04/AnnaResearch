import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MAX_RESEARCH_ITERATIONS, buildAttachmentSearchBaseline, convertSectionUrlCitations, curateSelectedSources, normalizeSectionCitations, remapSelectedContextCitationLabels, stripInternalChunkMarkers, useResearchJob } from "../../src/hooks/useResearchJob";
import type { ResearchApi } from "../../src/api/researchApi";
import type { ConfirmedResearchRole, ReportFraming, ReportSection, ResearchSourceView, SourceCallResult } from "../../src/types";

type LlmReply = string;

describe("normalizeSectionCitations", () => {
  const references = [
    { number: 12, source: { kind: "url" as const, url: "https://example.com/12" } },
    { number: 13, source: { kind: "url" as const, url: "https://example.com/13" } },
  ];

  it("normalizes grouped citations and removes only adjacent duplicate markers", () => {
    expect(normalizeSectionCitations("Claim [12, 13][13]. Later [12].", references)).toBe("Claim [12][13]. Later [12].");
  });

  it("rejects citations outside the section global citation map", () => {
    expect(() => normalizeSectionCitations("Unsupported [11].", references)).toThrow("outside its current section citation map: 11");
  });

  it("deterministically converts allowed URL citations to global numbers", () => {
    expect(convertSectionUrlCitations(
      "Claim ([official filing](https://example.com/12)). Another [source](https://example.com/13).",
      references,
    )).toBe("Claim [12]. Another [13].");
  });

  it("rejects a citation URL outside the allowed source identifiers", () => {
    expect(() => convertSectionUrlCitations(
      "Unsupported ([source](https://unknown.example/report)).",
      references,
    )).toThrow("outside its allowed source identifier list: https://unknown.example/report");
  });

  it("replaces only local source header numbers with global citation numbers", () => {
    const context = "[来源: Tavily] [1] First\nURL: https://example.com/12\nContent: Keep body marker [2].\n\n[来源: Tavily] [2] Second";
    expect(remapSelectedContextCitationLabels(context, references)).toBe(
      "[来源: Tavily] [12] First\nURL: https://example.com/12\nContent: Keep body marker [2].\n\n[来源: Tavily] [13] Second",
    );
  });
});

describe("stripInternalChunkMarkers", () => {
  it("removes internal retrieval labels without changing evidence text or citations", () => {
    const context = [
      "[来源: DuckDuckGo] [12] Source",
      "Content: [Chunk 55]First selected passage.",
      "[Chunk 55]",
      "Another selected passage.",
      "",
      "[... omitted ...]",
      "",
      "[Chunks 8-9]",
      "Second selected passage with citation [12].",
    ].join("\n");

    expect(stripInternalChunkMarkers(context)).toBe([
      "[来源: DuckDuckGo] [12] Source",
      "Content: First selected passage.",
      "Another selected passage.",
      "",
      "[... omitted ...]",
      "",
      "Second selected passage with citation [12].",
    ].join("\n"));
  });
});

describe("attachment search baseline", () => {
  it("keeps compact visible evidence and excludes the full image payload", () => {
    const job = {
      research_id: "r1",
      query: "market outlook",
      attachment_context: {
        version: 1,
        prepared_at: "now",
        summary: "attachment summary",
        chunks: [],
        files: [{
          id: "file-1",
          name: "chart.png",
          status: "ready" as const,
          analysis: {
            type: "image",
            source: "analyze_image",
            summary: "A chart shows quarterly revenue growth.",
            relevance: "Useful for the market outlook.",
            relevance_score: 0.9,
            payload: {
              visible_text: [{ text: "Revenue" }],
              key_observations: [{ observation: "The latest bar is the tallest." }],
              uncertainties: ["The smallest labels are unreadable."],
              detailed_description: "x".repeat(8_000),
            },
          },
        }],
      },
    };

    const baseline = buildAttachmentSearchBaseline(job, {
      context: "FULL IMAGE ANALYSIS JSON",
      items: [{ kind: "image_analysis", file_id: "file-1", file_name: "chart.png" }],
    });

    expect(baseline).toContain("A chart shows quarterly revenue growth.");
    expect(baseline).toContain("Visible text:\n  - Revenue");
    expect(baseline).toContain("The latest bar is the tallest.");
    expect(baseline).toContain("The smallest labels are unreadable.");
    expect(baseline).not.toContain("FULL IMAGE ANALYSIS JSON");
    expect(baseline).not.toContain("detailed_description");
    expect(baseline.length).toBeLessThanOrEqual(4_000);
  });
});

describe("LLM source curation", () => {
  const job = { research_id: "r1", query: "anna market" };
  const section: ReportSection = {
    id: "section-1",
    title: "Market",
    outline: "Assess the market using credible evidence.",
    allowed_source_ids: ["tavily"],
    max_iterations: 2,
  };
  const candidates = [
    { url: "https://official.example/report", title: "Official report", content: "Current statistics and methodology.", source_id: "tavily" },
    { url: "https://spam.example/post", title: "Reposted claims", content: "Unsubstantiated promotional copy.", source_id: "tavily" },
  ];

  it("keeps only candidates explicitly included by the curator", async () => {
    const { api, llmCalls } = makeApi({
      llmReplies: ['{"sources":[{"candidate_id":"source-1","decision":"include","reason":"Primary evidence"},{"candidate_id":"source-2","decision":"exclude","reason":"Low quality repost"}]}'],
    });

    const result = await curateSelectedSources(api, job, section, candidates);

    expect(result.sources.map((source) => source.url)).toEqual(["https://official.example/report"]);
    expect(result.audit).toMatchObject({ status: "completed", candidate_count: 2, included_count: 1, excluded_count: 1 });
    expect(JSON.stringify(llmCalls[0])).toContain("Err on the side of inclusion");
    expect(JSON.stringify(llmCalls[0])).toMatch(/Current date: \d{4}-\d{2}-\d{2}/);
    expect(JSON.stringify(llmCalls[0])).toContain("future-dated relative to this date");
    expect(JSON.stringify(llmCalls[0])).toContain("Content: Current statistics and methodology.");
  });

  it("fails open when the curator response is invalid", async () => {
    const { api } = makeApi({ llmReplies: ['{"sources":[]}'] });

    const result = await curateSelectedSources(api, job, section, candidates);

    expect(result.sources).toEqual(candidates);
    expect(result.audit).toMatchObject({ status: "failed_open", included_count: 2, excluded_count: 0 });
  });
});

interface ApiOptions {
  configured?: boolean;
  llmReplies?: LlmReply[];
  subsectionHeaderReplies?: LlmReply[];
  callOverrides?: Array<Partial<SourceCallResult>>;
  selectedSectionContext?: { selected_context: string; source_urls: string[]; selected_sources?: Array<{ url: string; title?: string; content?: string; source_id?: string; source_name?: string }> };
  sources?: ResearchSourceView[];
  latestJob?: Awaited<ReturnType<ResearchApi["getResearchJob"]>>;
  historyJobs?: Awaited<ReturnType<ResearchApi["listResearchJobs"]>>;
  createdAttachmentContext?: NonNullable<Awaited<ReturnType<ResearchApi["getResearchJob"]>>>["attachment_context"];
  selectedAttachmentContext?: Awaited<ReturnType<ResearchApi["selectAttachmentContext"]>>;
}

function makeApi(options: ApiOptions = {}) {
  const calls: unknown[] = [];
  const llmCalls: Array<{ messages: unknown }> = [];
  const agentSessions: Array<{ prompts: string[]; deleted: boolean }> = [];
  const configured = options.configured ?? true;
  const tavilySource: ResearchSourceView = {
    id: "tavily",
    name: "Tavily",
    kind: "builtin",
    enabled: true,
    max_parallel: 3,
    credential_status: configured ? "configured" : "missing",
    credential: configured ? "tvly-test" : "",
  };
  const sourcesList = options.sources ?? [tavilySource];
  const replies = options.llmReplies ?? [];
  const callOverrides = options.callOverrides ?? [];
  let callIndex = 0;
  let replyIndex = 0;
  let subsectionHeaderReplyIndex = 0;
  const api: ResearchApi = {
    async getSettings() {
      calls.push(["getSettings"]);
      return { tavily: { configured, masked: configured ? "***test" : "" } };
    },
    async listResearchSources() {
      calls.push(["listResearchSources"]);
      return sourcesList;
    },
    async updateResearchSourceCredential(input) {
      calls.push(["updateResearchSourceCredential", input]);
      return sourcesList.find((s) => s.id === input.id) ?? tavilySource;
    },
    async setResearchSourceEnabled(input) {
      calls.push(["setResearchSourceEnabled", input]);
      const source = sourcesList.find((s) => s.id === input.id) ?? tavilySource;
      return { ...source, enabled: input.enabled };
    },
    async upsertResearchSource(input) {
      calls.push(["upsertResearchSource", input]);
      const def = input.definition as { id?: string; name?: string };
      return {
        id: String(def.id || "user-source"),
        name: String(def.name || def.id || "User Source"),
        kind: "user",
        enabled: true,
        max_parallel: 1,
        credential_status: input.credential ? "configured" : "missing",
        credential: input.credential || "",
      };
    },
    async deleteResearchSource(input) {
      calls.push(["deleteResearchSource", input]);
      return { id: input.id, deleted: true };
    },
    async testResearchSource(input) {
      calls.push(["testResearchSource", input]);
      return {
        source_id: input.id,
        source_name: input.id,
        query: input.query,
        duration_ms: 1,
        pages: [],
        extracted: [],
        error: null,
      };
    },
    async getResearchJob(researchId) {
      calls.push(["getResearchJob", researchId]);
      if (researchId) {
        return (options.historyJobs || []).find((job) => job.research_id === researchId) ?? options.latestJob ?? null;
      }
      return options.latestJob ?? null;
    },
    async listResearchJobs(input) {
      calls.push(["listResearchJobs", input]);
      return options.historyJobs ?? (options.latestJob ? [options.latestJob] : []);
    },
    async createResearchJob(input) {
      calls.push(["createResearchJob", input]);
      return {
        research_id: "r1",
        status: "created",
        stage: "select_role",
        progress: 0,
        query: input.query,
        attachment_context: options.createdAttachmentContext,
      };
    },
    async updateResearchJob(researchId, updates) {
      calls.push(["updateResearchJob", researchId, updates]);
      return { research_id: researchId, status: "running", attachment_context: options.createdAttachmentContext, ...(updates as object) };
    },
    async prepareAttachments(researchId, attachments) {
      calls.push(["prepareAttachments", researchId, attachments]);
      return { research_id: researchId, status: "created" };
    },
    async embedAttachmentChunks(researchId) {
      calls.push(["embedAttachmentChunks", researchId]);
      return { research_id: researchId, status: "created" };
    },
    async summarizeAttachments(researchId, input) {
      calls.push(["summarizeAttachments", researchId, input]);
      return { research_id: researchId, status: "created" };
    },
    async selectAttachmentContext(input) {
      calls.push(["selectAttachmentContext", input]);
      return options.selectedAttachmentContext || { selected_context: "", selected_items: [], selected_item_count: 0 };
    },
    async saveConfirmedResearchRole(researchId: string, role: ConfirmedResearchRole) {
      calls.push(["saveConfirmedResearchRole", researchId, role]);
      return { research_id: researchId, status: "created", stage: "brainstorm_focus", progress: 15, query: "anna", confirmed_role: role };
    },
    async generateOutlineDraft(input) {
      calls.push(["generateOutlineDraft", input]);
      return outlineSectionsFromReply(replies[replyIndex++] ?? OUTLINE_REPLY);
    },
    async saveConfirmedResearchOutline(researchId: string, sections: ReportSection[]) {
      calls.push(["saveConfirmedResearchOutline", researchId, sections]);
      return {
        research_id: researchId,
        status: "running",
        stage: "section_research",
        progress: 35,
        query: "anna",
        attachment_context: options.createdAttachmentContext,
        confirmed_outline: sections,
        outline_discovery: { status: "completed", facets: [{ id: "f1", task: "Cover the first required research facet" }] },
      };
    },
    async callSectionResearchSource(input) {
      calls.push(["callSectionResearchSource", input]);
      const override = callOverrides[callIndex] ?? {};
      callIndex++;
      return {
        job: {
          research_id: input.research_id,
          status: "running",
          stage: "section_research",
          progress: 50 + input.iteration * 5,
          iteration: input.iteration,
          section_iterations: {},
        },
        source_call: {
          source_id: input.source_id,
          source_name: input.source_id === "custom" ? "Custom" : "Tavily",
          queries: input.queries,
          results_count: override.results_count ?? input.queries.length,
          top_titles: override.top_titles ?? input.queries.map((q) => `Title for ${q}`),
          duration_ms: 5,
          error: override.error ?? null,
          calls: override.calls ?? input.queries.map((q) => ({
            source_id: input.source_id,
            source_name: input.source_id === "custom" ? "Custom" : "Tavily",
            query: q,
            results_count: 1,
            top_titles: [`Title for ${q}`],
            duration_ms: 5,
            error: null,
          })),
        },
      };
    },
    async selectSectionContext(input) {
      calls.push(["selectSectionContext", input]);
      const selected = options.selectedSectionContext;
      return {
        job: { research_id: input.research_id, status: "running", stage: "select_context", progress: 88 },
        selected_context: selected?.selected_context ?? `FULL CONTEXT ${input.section_id}`,
        selected_sources: selected?.selected_sources ?? [],
        source_urls: selected?.source_urls ?? [`https://example.com/${input.section_id}`],
      };
    },
    async saveSectionResult(input) {
      calls.push(["saveSectionResult", input]);
      return {
        research_id: input.research_id,
        status: "running",
        stage: "section_research",
        progress: 80,
        section_results: {
          [input.section_id]: {
            section_id: input.section_id,
            status: input.status || "completed",
            section_markdown: input.section_markdown,
            section_summary: input.section_summary,
            subsection_headers: input.subsection_headers || [],
            source_urls: input.source_urls || [],
          },
        },
      };
    },
    async getSectionResult(researchId, sectionId) {
      calls.push(["getSectionResult", researchId, sectionId]);
      const sectionResult = options.latestJob?.section_results?.[sectionId];
      return sectionResult ?? null;
    },
    async saveReportFraming(input: { research_id: string; framing: ReportFraming }) {
      calls.push(["saveReportFraming", input]);
      return { research_id: input.research_id, status: "running", stage: "assemble_report", progress: 96, report_framing: input.framing };
    },
    async saveAssembledResearchResult(input) {
      calls.push(["saveAssembledResearchResult", input]);
      return {
        research_id: input.research_id,
        status: "completed",
        stage: "completed",
        progress: 100,
        result: { report_markdown: input.report_markdown, source_urls: input.source_urls },
      };
    },
    async complete(request) {
      llmCalls.push(request as { messages: unknown });
      expect(request).not.toHaveProperty("maxTokens");
      const reply = replies[replyIndex++] ?? "";
      return { content: { type: "text", text: reply } };
    },
    async createAgentSession() {
      const call = {
        prompts: [] as string[],
        runInputs: [] as Array<{ content: string; recursion_limit?: number }>,
        deleted: false,
      };
      agentSessions.push(call);
      return {
        async *run(input) {
          call.prompts.push(input.content);
          call.runInputs.push(input);
          let reply = "";
          if (input.content.includes("Plan the subsection structure") || input.content.includes("subsection header response was invalid")) {
            reply = options.subsectionHeaderReplies?.[subsectionHeaderReplyIndex++] ?? SUBSECTION_HEADERS_REPLY;
          } else if (input.content.includes("Process the selected contents from the latest SERP searches") || input.content.includes("previous learning response was invalid")) {
            reply = '{"learnings":["The selected evidence contains a concrete section finding."],"follow_up_questions":["What primary evidence would verify and deepen this finding?"]}';
          } else {
            reply = adaptLegacyDecisionToQueryPlan(replies[replyIndex++] ?? "", input.content);
          }
          if (reply) yield { event: "delta", text: reply };
          yield { event: "complete" };
        },
        async delete() {
          call.deleted = true;
          return {};
        },
      };
    },
  };
  return { api, calls, llmCalls, agentSessions };
}

function adaptLegacyDecisionToQueryPlan(reply: string, prompt: string): string {
  if (!reply) return reply;
  try {
    const parsed = JSON.parse(reply) as { type?: string; source_id?: string; queries?: string[] };
    if (parsed.type === "call_source" && Array.isArray(parsed.queries)) {
      const maxQueries = Number(/Return at most (\d+) queries/.exec(prompt)?.[1] || 3);
      const queries = Array.from(new Set(parsed.queries.map((query) => query.trim()).filter(Boolean))).slice(0, maxQueries);
      return JSON.stringify({
        source_id: parsed.source_id || "tavily",
        queries: queries.map((query) => ({
          query,
          research_goal: `Establish evidence for ${query}, then identify a more specific follow-up direction.`,
        })),
      });
    }
    if (parsed.type === "finish") {
      const title = /Section subtopic task:\n([^\n]+)/.exec(prompt)?.[1] || "section";
      return JSON.stringify({
        source_id: "tavily",
        queries: [{
          query: `${title} follow-up evidence`,
          research_goal: `Verify the remaining evidence for ${title} and identify any unresolved detail.`,
        }],
      });
    }
  } catch {
    return reply;
  }
  return reply;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const ROLE_REPLY = '{"roles":[{"server":"Researcher","agent_role_prompt":"Use sources."},{"server":"Analyst","agent_role_prompt":"Analyze sources."},{"server":"Expert","agent_role_prompt":"Expert sources."}]}';
const OUTLINE_REPLY = '{"sections":[{"title":"Section One","outline":"Cover one.","covers":["f1"],"max_iterations":2},{"title":"Section Two","outline":"Cover two.","covers":[],"max_iterations":1},{"title":"Section Three","outline":"Cover three.","covers":[],"max_iterations":1},{"title":"Section Four","outline":"Cover four.","covers":[],"max_iterations":1}]}';
const ASSIGN_REPLY = '{"sections":[{"id":"section-1","allowed_source_ids":["tavily"]},{"id":"section-2","allowed_source_ids":["tavily"]},{"id":"section-3","allowed_source_ids":["tavily"]},{"id":"section-4","allowed_source_ids":["tavily"]}]}';
const DECISION_REPLY = '{"type":"call_source","queries":["anna query"]}';
const SUBSECTION_HEADERS_REPLY = '{"subsection_headers":["Evidence analysis"]}';
const SECTION_REPLY = '{"section_markdown":"## Section One\\n\\n### Evidence analysis\\n\\nUses FULL CONTEXT [1]","section_summary":"section summary"}';
const FRAMING_REPLY = '{"title":"Done","introduction":"Intro","conclusion":"Conclusion"}';

function outlineSectionsFromReply(reply: string): ReportSection[] {
  const sections = JSON.parse(reply).sections as Array<{ title: string; outline: string; covers?: string[]; max_iterations?: number }>;
  return sections.map((section, index) => ({
    id: `section-${index + 1}`,
    title: section.title,
    outline: section.outline,
    facet_ids: section.covers || [],
    allowed_source_ids: [],
    max_iterations: section.max_iterations || 5,
  }));
}

async function planToOutline(result: ReturnType<typeof renderHook<ReturnType<typeof useResearchJob>, unknown>>["result"]) {
  await act(async () => {
    await result.current.start("anna");
  });
  await waitFor(() => expect(result.current.phase).toBe("role_review"));
  await act(async () => {
    await result.current.confirmRole(result.current.roleCandidates[0]);
  });
  await waitFor(() => expect(result.current.phase).toBe("outline_review"));
}

describe("useResearchJob (iterative loop)", () => {
  it("gates research when no research source credential is configured", async () => {
    const { api, calls } = makeApi({ configured: false });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("settings_required"));
    await act(async () => {
      await result.current.start("anna");
    });

    expect(calls.some((call) => Array.isArray(call) && call[0] === "createResearchJob")).toBe(false);
  });

  it("generates role candidates and waits for user confirmation", async () => {
    const { api, llmCalls } = makeApi({ llmReplies: [ROLE_REPLY] });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => {
      await result.current.start("anna");
    });

    expect(result.current.phase).toBe("role_review");
    expect(result.current.roleCandidates).toHaveLength(3);
    expect(result.current.roleCandidates[0]).toMatchObject({ server: "Researcher", agent_role_prompt: "Use sources." });
    expect(llmCalls).toHaveLength(1);
    expect(JSON.stringify(llmCalls[0])).toContain("roles");
    expect(JSON.stringify(llmCalls[0])).toContain('"role":"system"');
    expect(JSON.stringify(llmCalls[0])).toContain("<research role name>");
    expect(JSON.stringify(llmCalls[0])).toContain("same language as the task");
    expect(JSON.stringify(llmCalls[0])).not.toContain('"rationale"');
  });

  it("exposes draft generation phases while waiting for LLM planning replies", async () => {
    const roleReply = deferred<string>();
    const outlineReply = deferred<string>();
    const assignReply = deferred<string>();
    const replies = [roleReply.promise, assignReply.promise];
    let replyIndex = 0;
    const base = makeApi();
    const api: ResearchApi = {
      ...base.api,
      async generateOutlineDraft() {
        return outlineSectionsFromReply(await outlineReply.promise);
      },
      async complete(request) {
        expect(request).not.toHaveProperty("maxTokens");
        return { content: { type: "text", text: await replies[replyIndex++] } };
      },
    };
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    let startPromise!: Promise<void>;
    act(() => {
      startPromise = result.current.start("anna");
    });
    await waitFor(() => expect(result.current.phase).toBe("generating_roles"));
    await act(async () => {
      roleReply.resolve(ROLE_REPLY);
      await startPromise;
    });
    expect(result.current.phase).toBe("role_review");

    let outlinePromise!: Promise<void>;
    act(() => {
      outlinePromise = result.current.confirmRole(result.current.roleCandidates[0]);
    });
    await waitFor(() => expect(result.current.phase).toBe("generating_outline"));
    await act(async () => {
      outlineReply.resolve(OUTLINE_REPLY);
      assignReply.resolve(ASSIGN_REPLY);
      await outlinePromise;
    });
    expect(result.current.phase).toBe("outline_review");
  });

  it("resets a restored completed job when starting a new research draft", async () => {
    const { api } = makeApi({
      latestJob: {
        research_id: "done-1",
        status: "completed",
        stage: "completed",
        progress: 100,
        query: "old query",
        result: { report_markdown: "# Old report", source_urls: [] },
      },
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    expect(result.current.job?.research_id).toBe("done-1");
    expect(result.current.result?.report_markdown).toBe("# Old report");

    act(() => {
      result.current.resetForNewResearch();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.job).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.lastCompletedJob?.research_id).toBe("done-1");
    expect(result.current.lastCompletedResult?.report_markdown).toBe("# Old report");
  });

  it("loads history jobs and opens a selected completed research task", async () => {
    const { api, calls } = makeApi({
      historyJobs: [
        {
          research_id: "done-2",
          status: "completed",
          stage: "completed",
          progress: 100,
          query: "Research topic: history",
          source_count: 2,
          result: { report_markdown: "# History", source_urls: ["https://example.com"] },
        },
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.historyJobs).toHaveLength(1));
    await act(async () => {
      await result.current.openResearchJob("done-2");
    });

    expect(result.current.phase).toBe("completed");
    expect(result.current.job?.research_id).toBe("done-2");
    expect(result.current.result?.report_markdown).toBe("# History");
    expect(calls).toContainEqual(["getResearchJob", "done-2"]);
  });

  it("confirms a role and generates a task-covered outline directly", async () => {
    const { api, calls, llmCalls } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => {
      await result.current.start("anna");
    });

    await act(async () => {
      await result.current.confirmRole(result.current.roleCandidates[0]);
    });
    expect(result.current.phase).toBe("outline_review");
    expect(result.current.outlineDraft).toHaveLength(4);
    expect(result.current.outlineDraft[0].allowed_source_ids).toEqual(["tavily"]);
    expect(llmCalls).toHaveLength(2);
    expect(calls).toContainEqual(["generateOutlineDraft", { research_id: "r1", source_ids: ["tavily"] }]);
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveConfirmedResearchRole")).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("outline-discovery-contexts");
    expect(JSON.stringify(calls)).not.toContain("query_domains");
    expect(JSON.stringify(calls)).not.toContain("search_index");
    expect(JSON.stringify(calls)).not.toContain("search_total");
  });

  it("runs confirmed outline through section source calls, section writer, framing, and final assembly", async () => {
    const { api, calls, llmCalls, agentSessions } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        DECISION_REPLY,
        '{"type":"finish"}',
        SECTION_REPLY.replace("### Evidence analysis", "### Evidence findings"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Two").replace("[1]", "[2]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Three").replace("[1]", "[3]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Four").replace("[1]", "[4]"),
        FRAMING_REPLY,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.phase).toBe("completed");
    expect(result.current.result?.report_markdown).toContain("# Done");
    expect(result.current.result?.report_markdown).toContain("## Section One");
    expect(result.current.result?.report_markdown).toContain("### Evidence findings");
    expect(result.current.result?.report_markdown).toContain("Uses FULL CONTEXT [1]");
    expect(result.current.result?.report_markdown).toContain("## Section Two");
    expect(result.current.result?.report_markdown).toContain("Uses FULL CONTEXT [2]");
    expect(result.current.result?.report_markdown).toContain("## Section Three");
    expect(result.current.result?.report_markdown).toContain("Uses FULL CONTEXT [3]");
    expect(result.current.result?.report_markdown).toContain("## Section Four");
    expect(result.current.result?.report_markdown).toContain("Uses FULL CONTEXT [4]");
    expect(result.current.result?.report_markdown).toContain("## Conclusion");
    expect(result.current.result?.source_urls).toEqual([
      "https://example.com/section-1",
      "https://example.com/section-2",
      "https://example.com/section-3",
      "https://example.com/section-4",
    ]);
    const callSourceCalls = calls.filter((call) => Array.isArray(call) && call[0] === "callSectionResearchSource");
    expect(callSourceCalls.length).toBeGreaterThanOrEqual(1);
    expect((callSourceCalls[0] as unknown[])[1]).toMatchObject({ section_id: "section-1", source_id: "tavily", queries: ["anna query"] });
    expect(calls.some((call) => Array.isArray(call) && call[0] === "selectSectionContext")).toBe(true);
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveSectionResult")).toBe(true);
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveReportFraming")).toBe(true);
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveAssembledResearchResult")).toBe(true);
    expect(agentSessions).toHaveLength(4);
    expect(agentSessions.every((session) => session.deleted)).toBe(true);
    expect(agentSessions[0].prompts).toHaveLength(6);
    expect(agentSessions[0].prompts[0]).toContain("Do not call tools");
    expect(agentSessions[0].prompts[0]).toMatch(/Current date: \d{4}-\d{2}-\d{2}/);
    expect(agentSessions[0].prompts[0]).toContain('Interpret "recent" and "latest" relative to this date');
    expect(agentSessions[0].prompts[0]).toContain("Research task:\nanna");
    expect(agentSessions[0].prompts[0]).toContain("Section subtopic task:\nSection One\nCover one.");
    expect(agentSessions[0].prompts[0]).toContain("Research facets:\n- f1: Cover the first required research facet");
    expect(agentSessions[0].prompts[0]).toContain("Learnings from previous research:\n(none yet)");
    expect(agentSessions[0].prompts[0]).not.toContain("Complete report outline");
    expect(agentSessions[0].prompts[1]).toContain("Process the selected contents from the latest SERP searches");
    expect(agentSessions[0].prompts[1]).toContain("<query>\nanna query\n</query>");
    expect(agentSessions[0].prompts[2]).toContain("Learnings from previous research:\n- The selected evidence contains a concrete section finding.");
    expect(agentSessions[0].prompts[2]).toContain("Already executed queries (do not repeat):\n- anna query");
    expect(agentSessions[0].prompts[4]).toContain("Plan the subsection structure");
    expect(agentSessions[0].prompts[4]).toContain("Selected web evidence:\nFULL CONTEXT section-1");
    expect(agentSessions[0].prompts[4]).toContain("Complete report outline");
    expect(agentSessions[0].prompts[5]).toContain("Required subsection headers:\n1. Evidence analysis");
    expect(agentSessions[0].prompts[5]).toContain("Allowed source identifiers for this section");
    expect(agentSessions[0].prompts[5]).toContain("([in-text citation](SOURCE_URL))");
    expect(agentSessions[0].prompts[5]).not.toContain("[1] https://example.com/section-1");
    expect(agentSessions[0].prompts[5]).toContain("Web context:\nFULL CONTEXT section-1");
    expect(agentSessions[0].prompts[5]).toContain("Complete report outline");
    expect(agentSessions[0].prompts[4]).toContain("(none yet; this is the first report section)");
    expect(agentSessions[1].prompts[0]).not.toContain("Existing report content written before this section");
    expect(agentSessions[1].prompts[2]).toContain("Completed section summaries (continuity only, not evidence)");
    expect(agentSessions[1].prompts[2]).toContain("Section One: section summary");
    expect(agentSessions[1].prompts[2]).not.toContain("Uses FULL CONTEXT");
    expect(agentSessions[1].prompts[2]).toContain("[PREVIOUS] Section One");
    expect(agentSessions[1].prompts[2]).toContain("[CURRENT] Section Two");
    expect(agentSessions[1].prompts[2]).toContain("[UPCOMING] Section Three");
    expect(agentSessions[1].prompts[2]).toContain("Subsection headers already used by previous sections");
    expect(agentSessions[1].prompts[2]).toContain("Section One: Evidence analysis");
    expect(agentSessions[1].prompts[3]).toContain("Main research task:\nanna");
    expect(agentSessions[1].prompts[3]).toContain("Current subtopic:\nTitle: Section Two\nTask and boundary: Cover two.");
    expect(agentSessions[1].prompts[3]).toContain("Complete report outline");
    expect(agentSessions[1].prompts[3]).toContain("Section One: section summary");
    expect(agentSessions[1].prompts[3]).toContain("Relevant prior written passages selected for overlap control:\n(none selected");
    expect(agentSessions[1].prompts[3]).not.toContain("Uses FULL CONTEXT [1]");
    expect(agentSessions[1].prompts[3]).toContain("Allowed source identifiers for this section");
    const sectionSave = calls.find((call) => Array.isArray(call) && call[0] === "saveSectionResult") as unknown[];
    expect(sectionSave[1]).toMatchObject({ subsection_headers: ["Evidence analysis"] });
    expect(llmCalls).toHaveLength(3);
    expect(JSON.stringify(llmCalls[2])).toContain("Generate report framing only");
  });

  it("converts an upstream-style URL citation before saving the section", async () => {
    const urlSectionReply = SECTION_REPLY.replace("[1]", "([official source](https://example.com/section-1))");
    const { api, calls } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        DECISION_REPLY,
        '{"type":"finish"}',
        urlSectionReply,
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Two").replace("[1]", "[2]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Three").replace("[1]", "[3]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Four").replace("[1]", "[4]"),
        FRAMING_REPLY,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.phase).toBe("completed");
    expect(result.current.result?.report_markdown).toContain("Uses FULL CONTEXT [1]");
    expect(result.current.result?.report_markdown).not.toContain("official source");
    const firstSectionSave = calls.find((call) => Array.isArray(call) && call[0] === "saveSectionResult") as unknown[];
    expect(firstSectionSave[1]).toMatchObject({ section_markdown: expect.stringContaining("[1]") });
  });

  it("fails deterministically when the writer returns an unknown citation URL", async () => {
    const invalidSectionReply = SECTION_REPLY.replace("[1]", "([source](https://unknown.example/report))");
    const { api, agentSessions } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        DECISION_REPLY,
        '{"type":"finish"}',
        invalidSectionReply,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.phase).toBe("failed");
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toContain("outside its allowed source identifier list: https://unknown.example/report");
    expect(agentSessions[0].prompts.filter((prompt) => prompt.includes("Repair citation"))).toHaveLength(0);
    expect(agentSessions[0].deleted).toBe(true);
  });

  it("selects attachment evidence once per section and uses a compact baseline for search planning", async () => {
    const attachmentOutline = JSON.stringify({ sections: [
      { title: "Section One", outline: "Cover one.", covers: ["f1"], max_iterations: 2 },
      { title: "Section Two", outline: "Cover two.", covers: [], max_iterations: 1 },
      { title: "Section Three", outline: "Cover three.", covers: [], max_iterations: 1 },
      { title: "Section Four", outline: "Cover four.", covers: [], max_iterations: 1 },
    ] });
    const attachmentContext = {
      version: 1,
      prepared_at: "now",
      summary: "Uploaded market memo",
      chunks: [],
      files: [{
        id: "file-1",
        name: "market-memo.pdf",
        status: "ready" as const,
        analysis: {
          type: "text",
          source: "summary_llm",
          summary: "The memo already describes the baseline market reaction.",
          key_points: ["External corroboration is still required."],
          relevance: "Directly relevant to Section One.",
          relevance_score: 0.9,
          payload: {},
        },
      }],
    };
    const { api, calls, agentSessions } = makeApi({
      createdAttachmentContext: attachmentContext,
      selectedAttachmentContext: {
        selected_context: "FULL SELECTED ATTACHMENT EVIDENCE",
        selected_items: [{
          kind: "chunk",
          item_id: "file-1:0001",
          file_id: "file-1",
          file_name: "market-memo.pdf",
          index: 1,
          quote: "The memo records an initial market reaction that still needs independent verification.",
        }],
        selected_item_count: 1,
      },
      llmReplies: [
        ROLE_REPLY,
        attachmentOutline,
        ASSIGN_REPLY,
        DECISION_REPLY,
        '{"type":"finish"}',
        SECTION_REPLY,
        "",
        "",
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.phase).toBe("failed");
    expect(agentSessions[0].prompts[0]).toContain("Uploaded attachment evidence baseline");
    expect(agentSessions[0].prompts[0]).toContain("The memo already describes the baseline market reaction.");
    expect(agentSessions[0].prompts[0]).toContain("still needs independent verification");
    expect(agentSessions[0].prompts[0]).not.toContain("FULL SELECTED ATTACHMENT EVIDENCE");
    expect(agentSessions[0].prompts[2]).toContain("provided at depth 1 in this session");
    expect(agentSessions[0].prompts[2]).not.toContain("The memo already describes the baseline market reaction.");
    expect(agentSessions[0].prompts[4]).toContain("Selected attachment evidence:\nFULL SELECTED ATTACHMENT EVIDENCE");
    expect(agentSessions[0].prompts[5]).toContain("Attachment chunk context:\nFULL SELECTED ATTACHMENT EVIDENCE");
    const sectionOneAttachmentCalls = calls.filter((call) =>
      Array.isArray(call) &&
      call[0] === "selectAttachmentContext" &&
      String((call[1] as { query?: string }).query || "").startsWith("Section One"),
    );
    expect(sectionOneAttachmentCalls).toHaveLength(1);
  });

  it("preserves Agent query priority while deduplicating and limiting searches to three", async () => {
    const { api, calls, agentSessions } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        '{"type":"call_source","source_id":"tavily","queries":["zeta priority"," alpha second ","zeta priority","beta third","gamma fourth"]}',
        '{"type":"finish"}',
        SECTION_REPLY,
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Two").replace("[1]", "[2]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Three").replace("[1]", "[3]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Four").replace("[1]", "[4]"),
        FRAMING_REPLY,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.phase).toBe("completed");
    const sectionOneCalls = calls
      .filter((call) => Array.isArray(call) && call[0] === "callSectionResearchSource")
      .map((call) => (call as unknown[])[1] as { section_id: string; queries: string[] })
      .filter((input) => input.section_id === "section-1");
    expect(sectionOneCalls.map((input) => input.queries)).toEqual([
      ["zeta priority", "alpha second", "beta third"],
      ["Section One follow-up evidence"],
    ]);
    expect(agentSessions[0].prompts[0]).toContain("Return at most 3 queries");
  });

  it("uses evidence learnings and follow-up directions for deeper queries", async () => {
    const { api, calls, agentSessions } = makeApi({
      selectedSectionContext: {
        selected_context: "FULL CONTEXT section-1",
        source_urls: ["https://example.com/section-1"],
        selected_sources: [{
          url: "https://example.com/section-1",
          title: "Current benchmark report",
          source_id: "tavily",
          source_name: "Tavily",
          content: "[来源: Tavily] [11] Useful current benchmark finding.\nKeywords for SEO:\nNVDA stock, subscribe, tags\nDisclaimer: promotional material",
        }],
      },
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        '{"type":"call_source","source_id":"tavily","queries":["broad market query"]}',
        '{"type":"call_source","source_id":"tavily","knowledge_gap":"Missing current benchmarks","queries":["broad market query","current benchmark evidence","unused extra query"]}',
        SECTION_REPLY,
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Two"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Three"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Four"),
        FRAMING_REPLY,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.phase).toBe("completed");
    const sectionOneQueries = calls
      .filter((call) => Array.isArray(call) && call[0] === "callSectionResearchSource")
      .map((call) => (call as unknown[])[1] as { section_id: string; queries: string[] })
      .filter((input) => input.section_id === "section-1")
      .map((input) => input.queries);
    expect(sectionOneQueries).toEqual([
      ["broad market query"],
      ["current benchmark evidence"],
    ]);
    expect(agentSessions[0].prompts[2]).toContain("Learnings from previous research:\n- The selected evidence contains a concrete section finding.");
    expect(agentSessions[0].prompts[2]).toContain("Follow-up research directions:\n- What primary evidence would verify and deepen this finding?");
    expect(agentSessions[0].prompts[2]).toContain("Already executed queries (do not repeat):\n- broad market query");
  });

  it("fails a section on an empty Agent response without falling back to llm.complete", async () => {
    const { api, calls, llmCalls, agentSessions } = makeApi({
      llmReplies: [ROLE_REPLY, OUTLINE_REPLY, ASSIGN_REPLY, ""],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.phase).toBe("failed");
    expect(String(result.current.error)).toContain("empty query plan");
    expect(llmCalls).toHaveLength(2);
    expect(agentSessions).toHaveLength(1);
    expect(agentSessions[0].deleted).toBe(true);
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveSectionResult")).toBe(false);
  });

  it("retries invalid subsection headers once and then fails without writing", async () => {
    const { api, calls, agentSessions } = makeApi({
      llmReplies: [ROLE_REPLY, OUTLINE_REPLY, ASSIGN_REPLY, DECISION_REPLY, '{"type":"finish"}'],
      subsectionHeaderReplies: ["", '{"subsection_headers":["# Invalid"]}'],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.phase).toBe("failed");
    expect(String(result.current.error)).toContain("did not return valid subsection headers");
    expect(agentSessions).toHaveLength(1);
    expect(agentSessions[0].prompts).toHaveLength(6);
    expect(agentSessions[0].prompts[4]).toContain("Plan the subsection structure");
    expect(agentSessions[0].prompts[5]).toContain("previous subsection header response was invalid");
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveSectionResult")).toBe(false);
  });

  it("does not create a session for a completed section when resuming", async () => {
    const sections: ReportSection[] = [
      { id: "section-1", title: "Done", outline: "Already written.", allowed_source_ids: ["tavily"], max_iterations: 1 },
      { id: "section-2", title: "Pending", outline: "Still needed.", allowed_source_ids: ["tavily"], max_iterations: 1 },
    ];
    const latestJob = {
      research_id: "resume-1",
      status: "failed" as const,
      stage: "section_research",
      progress: 60,
      query: "anna",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use sources." },
      confirmed_outline: sections,
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Done\n\nThe pending evidence baseline was already established in the completed section [1], so the next section should not repeat it.",
          section_summary: "Saved summary",
          source_urls: ["https://example.com/done"],
        },
      },
    };
    const { api, agentSessions } = makeApi({
      latestJob,
      llmReplies: [
        '{"type":"finish"}',
        '{"section_markdown":"## Pending\\n\\n### Evidence analysis\\n\\nNew text [2]","section_summary":"New summary"}',
        FRAMING_REPLY,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.job?.research_id).toBe("resume-1"));
    expect(result.current.phase).toBe("failed");
    await act(async () => {
      await result.current.resumeResearchJob();
    });

    expect(result.current.phase).toBe("completed");
    expect(agentSessions).toHaveLength(1);
    expect(agentSessions[0].deleted).toBe(true);
    expect(agentSessions[0].prompts[0]).not.toContain("## Done");
    expect(agentSessions[0].prompts[2]).toContain("Done: Saved summary");
    expect(agentSessions[0].prompts[2]).not.toContain("## Done");
    expect(agentSessions[0].prompts[2]).toContain("[PREVIOUS] Done");
    expect(agentSessions[0].prompts[2]).toContain("[CURRENT] Pending");
    expect(agentSessions[0].prompts[3]).not.toContain("## Done");
    expect(agentSessions[0].prompts[3]).toContain("Done: Saved summary");
    expect(agentSessions[0].prompts[3]).toContain("The pending evidence baseline was already established");
    expect(agentSessions[0].prompts[3]).not.toContain("completed section [1]");
    expect(agentSessions[0].prompts[3]).toContain("Allowed source identifiers for this section");
  });

  it("uses a Chinese conclusion heading for Chinese reports", async () => {
    const chineseSection = '{"section_markdown":"## 市场\\n\\n### Evidence analysis\\n\\n福州有明确的本地需求 [1]","section_summary":"本地需求"}';
    const { api } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        DECISION_REPLY,
        '{"type":"finish"}',
        chineseSection,
        '{"type":"finish"}',
        chineseSection.replace("[1]", "[2]"),
        '{"type":"finish"}',
        chineseSection.replace("[1]", "[3]"),
        '{"type":"finish"}',
        chineseSection.replace("[1]", "[4]"),
        '{"title":"福州市场备忘录","introduction":"这是一份中文报告。","conclusion":"整体机会清晰。"}',
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.result?.report_markdown).toContain("## 结论");
    expect(result.current.result?.report_markdown).not.toContain("## Conclusion");
  });

  it("semantically rewrites selected report text and reassembles the saved report", async () => {
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: Anna\n\nResearch need:\nStudy Anna.",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use precise evidence." },
      confirmed_outline: [{ id: "section-1", title: "Market", outline: "Cover market.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Intro", conclusion: "Conclusion" },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Market\n\nAnna has a useful product [1].",
          section_summary: "Anna product",
          source_urls: ["https://example.com/a"],
        },
      },
      result: {
        report_markdown: "# Done\n\nIntro\n\n## Market\n\nAnna has a useful product [1].\n\n## Conclusion\n\nConclusion",
        source_urls: ["https://example.com/a"],
      },
    };
    const { api, calls, llmCalls } = makeApi({
      latestJob,
      llmReplies: ['{"rewritten_text":"Anna reads as a more investor-relevant product wedge [1]."}'],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    await act(async () => {
      await result.current.semanticRewriteSelection({
        selectedText: "Anna has a useful product [1].",
        instruction: "改成投资人视角",
      });
    });

    expect(llmCalls).toHaveLength(1);
    expect(JSON.stringify(llmCalls[0])).toContain("Do not introduce new facts");
    const sectionSave = calls.find((call) => Array.isArray(call) && call[0] === "saveSectionResult") as unknown[];
    expect(sectionSave[1]).toMatchObject({
      section_id: "section-1",
      section_markdown: "## Market\n\nAnna reads as a more investor-relevant product wedge [1].",
    });
    const assembledSave = calls.find((call) => Array.isArray(call) && call[0] === "saveAssembledResearchResult") as unknown[];
    expect(assembledSave[1]).toMatchObject({ source_urls: ["https://example.com/a"] });
    expect(JSON.stringify(assembledSave[1])).toContain("Anna reads as a more investor-relevant product wedge [1].");
    expect(result.current.result?.report_markdown).toContain("Anna reads as a more investor-relevant product wedge [1].");
  });

  it("keeps only actually cited fresh references when re-search rewrite is applied", async () => {
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: Anna\n\nResearch need:\nStudy Anna.",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use precise evidence." },
      confirmed_outline: [{ id: "section-1", title: "Market", outline: "Cover market.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Intro", conclusion: "Conclusion" },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Market\n\nAnna has a useful product [1].",
          section_summary: "Anna product",
          source_urls: ["https://example.com/a"],
        },
      },
      result: {
        report_markdown: "# Done\n\nIntro\n\n## Market\n\nAnna has a useful product [1].\n\n## Conclusion\n\nConclusion",
        source_urls: ["https://example.com/a"],
      },
    };
    const { api, calls } = makeApi({
      latestJob,
      selectedSectionContext: {
        selected_context: "Fresh evidence A and B.",
        source_urls: ["https://fresh.example/unused", "https://fresh.example/used"],
      },
      llmReplies: [
        '{"title":"Market","outline":"Find new evidence.","queries":["anna market evidence"],"max_iterations":1}',
        '{"rewritten_text":"Anna now has stronger evidence from the refreshed source [3]."}',
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    await act(async () => {
      await result.current.semanticRewriteSelection({
        selectedText: "Anna has a useful product [1].",
        instruction: "重新搜索并补充证据",
        refreshResearch: true,
      });
    });

    const sectionSave = calls.find((call) => Array.isArray(call) && call[0] === "saveSectionResult") as unknown[];
    expect(sectionSave[1]).toMatchObject({
      section_markdown: "## Market\n\nAnna now has stronger evidence from the refreshed source [2].",
      source_urls: ["https://example.com/a", "https://fresh.example/used"],
    });
    const assembledSave = calls.find((call) => Array.isArray(call) && call[0] === "saveAssembledResearchResult") as unknown[];
    expect(assembledSave[1]).toMatchObject({
      source_urls: ["https://example.com/a", "https://fresh.example/used"],
    });
    expect(JSON.stringify(assembledSave[1])).not.toContain("https://fresh.example/unused");
    expect(result.current.result?.report_markdown).toContain("refreshed source [2]");
  });

  it("does not renumber existing citations when compacting fresh rewrite references", async () => {
    const existingUrls = Array.from({ length: 36 }, (_, index) => `https://example.com/${index + 1}`);
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: US GDP",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use precise evidence." },
      confirmed_outline: [{ id: "section-1", title: "Labor", outline: "Cover labor.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Intro", conclusion: "Conclusion" },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Labor\n\nLabor pressure remains visible [36].",
          section_summary: "Labor",
          source_urls: [existingUrls[35]],
        },
      },
      result: {
        report_markdown: "# Done\n\nIntro\n\n## Labor\n\nLabor pressure remains visible [36].\n\n## Conclusion\n\nConclusion",
        source_urls: existingUrls,
      },
    };
    const { api, calls } = makeApi({
      latestJob,
      selectedSectionContext: {
        selected_context: "Fresh evidence A and B.",
        source_urls: ["https://fresh.example/unused", "https://fresh.example/used"],
      },
      llmReplies: [
        '{"title":"Labor","outline":"Find new labor evidence.","queries":["labor evidence"],"max_iterations":1}',
        '{"rewritten_text":"Labor pressure remains visible [36], with fresh corroboration [38]."}',
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    await act(async () => {
      await result.current.semanticRewriteSelection({
        selectedText: "Labor pressure remains visible [36].",
        instruction: "重新搜索并补充一句证据",
        refreshResearch: true,
      });
    });

    const sectionSave = calls.find((call) => Array.isArray(call) && call[0] === "saveSectionResult") as unknown[];
    expect(sectionSave[1]).toMatchObject({
      section_markdown: "## Labor\n\nLabor pressure remains visible [36], with fresh corroboration [37].",
      source_urls: [existingUrls[35], "https://fresh.example/used"],
    });
    const assembledSave = calls.find((call) => Array.isArray(call) && call[0] === "saveAssembledResearchResult") as unknown[];
    expect(assembledSave[1]).toMatchObject({
      source_urls: [...existingUrls, "https://fresh.example/used"],
    });
    expect(JSON.stringify(assembledSave[1])).not.toContain("https://fresh.example/unused");
  });

  it("can re-search rewrite an introduction by anchoring search to the first section", async () => {
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: Anna\n\nResearch need:\nStudy Anna.",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use precise evidence." },
      confirmed_outline: [{ id: "section-1", title: "Market", outline: "Cover market.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Intro opening.", conclusion: "Conclusion" },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Market\n\nAnna has a useful product [1].",
          section_summary: "Anna product",
          source_urls: ["https://example.com/a"],
        },
      },
      result: {
        report_markdown: "# Done\n\nIntro opening.\n\n## Market\n\nAnna has a useful product [1].\n\n## Conclusion\n\nConclusion",
        source_urls: ["https://example.com/a"],
      },
    };
    const { api, calls } = makeApi({
      latestJob,
      selectedSectionContext: {
        selected_context: "Fresh intro evidence.",
        source_urls: ["https://fresh.example/intro"],
      },
      llmReplies: [
        '{"title":"Introduction","outline":"Find framing evidence.","queries":["anna framing evidence"],"max_iterations":1}',
        '{"rewritten_text":"Intro opening with fresher evidence [2]."}',
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    await act(async () => {
      await result.current.semanticRewriteSelection({
        selectedText: "Intro opening.",
        instruction: "重新搜索并加强开头",
        refreshResearch: true,
      });
    });

    expect(calls).toContainEqual([
      "callSectionResearchSource",
      expect.objectContaining({ section_id: "section-1", queries: ["anna framing evidence"] }),
    ]);
    const framingSave = calls.find((call) => Array.isArray(call) && call[0] === "saveReportFraming") as unknown[];
    expect(framingSave[1]).toMatchObject({
      framing: { introduction: "Intro opening with fresher evidence [2]." },
    });
    const assembledSave = calls.find((call) => Array.isArray(call) && call[0] === "saveAssembledResearchResult") as unknown[];
    expect(assembledSave[1]).toMatchObject({
      source_urls: ["https://example.com/a", "https://fresh.example/intro"],
    });
    expect(result.current.result?.report_markdown).toContain("Intro opening with fresher evidence [2].");
  });

  it("matches rendered report text back to markdown with formatting markers", async () => {
    const sectionMarkdown =
      "## Labor\n\n" +
      "2026年的劳动力市场呈现“供给萎缩”导致的结构性紧缩。受移民政策收紧影响，劳动力供应总量出现下滑，黄金年龄参与率在2026年中期降至83.3% [36]。\n\n" +
      "*   **薪资与消费支撑：** 虽然月均新增就业降至约4万人的低位，且名义薪资增速在2026年初一度降至3%以下，但生产率的提振抑制了单位劳动力成本（2025年Q3下降1.9%），这为2026年下半年的实际薪资回升和消费支出提供了空间 [31][35][36]。\n" +
      "*   **失业率预测：** 预计2026年失业率将微升至4.5%左右，但这种上升更多反映了劳动力需求的结构性调整而非周期性衰退 [34]。";
    const selectedText =
      "2026年的劳动力市场呈现“供给萎缩”导致的结构性紧缩。受移民政策收紧影响，劳动力供应总量出现下滑，黄金年龄参与率在2026年中期降至83.3% [36]。 " +
      "薪资与消费支撑： 虽然月均新增就业降至约4万人的低位，且名义薪资增速在2026年初一度降至3%以下，但生产率的提振抑制了单位劳动力成本（2025年Q3下降1.9%），这为2026年下半年的实际薪资回升和消费支出提供了空间 [31][35][36]。 " +
      "失业率预测： 预计2026年失业率将微升至4.5%左右，但这种上升更多反映了劳动力需求的结构性调整而非周期性衰退 [34]。";
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: US GDP",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use precise evidence." },
      confirmed_outline: [{ id: "section-1", title: "Labor", outline: "Cover labor.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Intro", conclusion: "Conclusion" },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: sectionMarkdown,
          section_summary: "Labor",
          source_urls: ["https://example.com/31", "https://example.com/34", "https://example.com/35", "https://example.com/36"],
        },
      },
      result: {
        report_markdown: `# Done\n\nIntro\n\n${sectionMarkdown}\n\n## Conclusion\n\nConclusion`,
        source_urls: ["https://example.com/31", "https://example.com/34", "https://example.com/35", "https://example.com/36"],
      },
    };
    const { api, calls } = makeApi({
      latestJob,
      llmReplies: ['{"rewritten_text":"劳动力市场仍偏紧，但压力主要来自结构性供给约束而非全面衰退 [36]。"}'],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    await act(async () => {
      await result.current.semanticRewriteSelection({
        selectedText,
        instruction: "压缩为更清晰的投资人视角",
      });
    });

    const sectionSave = calls.find((call) => Array.isArray(call) && call[0] === "saveSectionResult") as unknown[];
    expect(sectionSave[1]).toMatchObject({
      section_id: "section-1",
      section_markdown: "## Labor\n\n劳动力市场仍偏紧，但压力主要来自结构性供给约束而非全面衰退 [36]。",
    });
  });

  it("saves a manual report markdown edit and syncs framing plus section results", async () => {
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: Anna\n\nResearch need:\nStudy Anna.",
      confirmed_outline: [{ id: "section-1", title: "Market", outline: "Cover market.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Original intro.", conclusion: "Original conclusion." },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Market\n\nOriginal report [1].",
          section_summary: "Original report",
          source_urls: ["https://example.com/a"],
        },
      },
      result: {
        report_markdown: "# Done\n\nOriginal intro.\n\n## Market\n\nOriginal report [1].\n\n## 结论\n\nOriginal conclusion.",
        source_urls: ["https://example.com/a"],
      },
    };
    const { api, calls } = makeApi({ latestJob });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    await act(async () => {
      await result.current.saveManualReportMarkdown({
        reportMarkdown: "# Better Done\n\nManual intro.\n\n## Market\n\nManual edit [1].\n\n## 结论\n\nManual conclusion.",
      });
    });

    const framingSave = calls.find((call) => Array.isArray(call) && call[0] === "saveReportFraming") as unknown[];
    expect(framingSave[1]).toMatchObject({
      framing: {
        title: "Better Done",
        introduction: "Manual intro.",
        conclusion: "Manual conclusion.",
      },
    });
    const sectionSave = calls.find((call) => Array.isArray(call) && call[0] === "saveSectionResult") as unknown[];
    expect(sectionSave[1]).toMatchObject({
      section_id: "section-1",
      section_markdown: "## Market\n\nManual edit [1].",
      source_urls: ["https://example.com/a"],
    });
    const assembledSave = calls.find((call) => Array.isArray(call) && call[0] === "saveAssembledResearchResult") as unknown[];
    expect(assembledSave[1]).toMatchObject({
      report_markdown: "# Better Done\n\nManual intro.\n\n## Market\n\nManual edit [1].\n\n## 结论\n\nManual conclusion.",
      source_urls: ["https://example.com/a"],
    });
    expect(result.current.result?.report_markdown).toBe("# Better Done\n\nManual intro.\n\n## Market\n\nManual edit [1].\n\n## 结论\n\nManual conclusion.");
  });

  it("previews a semantic rewrite before applying it", async () => {
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: Anna\n\nResearch need:\nStudy Anna.",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use precise evidence." },
      confirmed_outline: [{ id: "section-1", title: "Market", outline: "Cover market.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Intro", conclusion: "Conclusion" },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Market\n\nAnna has a useful product [1].",
          section_summary: "Anna product",
          source_urls: ["https://example.com/a"],
        },
      },
      result: {
        report_markdown: "# Done\n\nIntro\n\n## Market\n\nAnna has a useful product [1].\n\n## Conclusion\n\nConclusion",
        source_urls: ["https://example.com/a"],
      },
    };
    const { api, calls, llmCalls } = makeApi({
      latestJob,
      llmReplies: ['{"rewritten_text":"Anna reads as a more investor-relevant product wedge [1]."}'],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    let proposalId = "";
    await act(async () => {
      const proposal = await result.current.previewSemanticRewriteSelection({
        selectedText: "Anna has a useful product [1].",
        instruction: "改成投资人视角",
      });
      proposalId = proposal.proposalId || "";
      expect(proposal.rewrittenText).toBe("Anna reads as a more investor-relevant product wedge [1].");
      expect(proposal.references).toEqual([{ number: 1, url: "https://example.com/a", scope: "selected" }]);
    });

    expect(proposalId).toBeTruthy();
    expect(JSON.stringify(llmCalls[0])).toContain("[1] https://example.com/a (selected)");
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveSectionResult")).toBe(false);
    expect(result.current.result?.report_markdown).toContain("Anna has a useful product [1].");

    await act(async () => {
      await result.current.applySemanticRewriteProposal(proposalId);
    });

    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveSectionResult")).toBe(true);
    expect(result.current.result?.report_markdown).toContain("Anna reads as a more investor-relevant product wedge [1].");
  });

  it("semantically rewrites report introduction and reassembles the saved report", async () => {
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: Anna\n\nResearch need:\nStudy Anna.",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use precise evidence." },
      confirmed_outline: [{ id: "section-1", title: "Market", outline: "Cover market.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Anna has an early product wedge.", conclusion: "Conclusion" },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Market\n\nAnna has a useful product [1].",
          section_summary: "Anna product",
          source_urls: ["https://example.com/a"],
        },
      },
      result: {
        report_markdown: "# Done\n\nAnna has an early product wedge.\n\n## Market\n\nAnna has a useful product [1].\n\n## Conclusion\n\nConclusion",
        source_urls: ["https://example.com/a"],
      },
    };
    const { api, calls } = makeApi({
      latestJob,
      llmReplies: ['{"rewritten_text":"Anna already shows an investor-relevant early product wedge."}'],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    await act(async () => {
      await result.current.semanticRewriteSelection({
        selectedText: "Anna has an early product wedge.",
        instruction: "改成投资人视角",
      });
    });

    const framingSave = calls.find((call) => Array.isArray(call) && call[0] === "saveReportFraming") as unknown[];
    expect(framingSave[1]).toMatchObject({
      framing: {
        title: "Done",
        introduction: "Anna already shows an investor-relevant early product wedge.",
        conclusion: "Conclusion",
      },
    });
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveSectionResult")).toBe(false);
    const assembledSave = calls.find((call) => Array.isArray(call) && call[0] === "saveAssembledResearchResult") as unknown[];
    expect(JSON.stringify(assembledSave[1])).toContain("Anna already shows an investor-relevant early product wedge.");
    expect(result.current.result?.report_markdown).toContain("Anna already shows an investor-relevant early product wedge.");
  });

  it("semantically rewrites report title and reassembles the saved report", async () => {
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: Anna\n\nResearch need:\nStudy Anna.",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use precise evidence." },
      confirmed_outline: [{ id: "section-1", title: "Market", outline: "Cover market.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Intro", conclusion: "Conclusion" },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Market\n\nAnna has a useful product [1].",
          section_summary: "Anna product",
          source_urls: ["https://example.com/a"],
        },
      },
      result: {
        report_markdown: "# Done\n\nIntro\n\n## Market\n\nAnna has a useful product [1].\n\n## Conclusion\n\nConclusion",
        source_urls: ["https://example.com/a"],
      },
    };
    const { api, calls } = makeApi({
      latestJob,
      llmReplies: ['{"rewritten_text":"Anna Market Memo"}'],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    await act(async () => {
      await result.current.semanticRewriteSelection({
        selectedText: "Done",
        instruction: "改成更清晰的标题",
      });
    });

    const framingSave = calls.find((call) => Array.isArray(call) && call[0] === "saveReportFraming") as unknown[];
    expect(framingSave[1]).toMatchObject({
      framing: {
        title: "Anna Market Memo",
        introduction: "Intro",
        conclusion: "Conclusion",
      },
    });
    expect(result.current.result?.report_markdown).toContain("# Anna Market Memo");
  });

  it("semantically rewrites report conclusion and reassembles the saved report", async () => {
    const latestJob = {
      research_id: "done-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      query: "Research topic: Anna\n\nResearch need:\nStudy Anna.",
      confirmed_role: { server: "Analyst", agent_role_prompt: "Use precise evidence." },
      confirmed_outline: [{ id: "section-1", title: "Market", outline: "Cover market.", allowed_source_ids: ["tavily"], max_iterations: 1 }],
      report_framing: { title: "Done", introduction: "Intro", conclusion: "Anna should keep building with evidence [1]." },
      section_results: {
        "section-1": {
          section_id: "section-1",
          status: "completed",
          section_markdown: "## Market\n\nAnna has a useful product [1].",
          section_summary: "Anna product",
          source_urls: ["https://example.com/a"],
        },
      },
      result: {
        report_markdown: "# Done\n\nIntro\n\n## Market\n\nAnna has a useful product [1].\n\n## Conclusion\n\nAnna should keep building with evidence [1].",
        source_urls: ["https://example.com/a"],
      },
    };
    const { api, calls } = makeApi({
      latestJob,
      llmReplies: ['{"rewritten_text":"Anna should keep compounding the wedge where evidence is strongest [1]."}'],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    await act(async () => {
      await result.current.semanticRewriteSelection({
        selectedText: "Anna should keep building with evidence [1].",
        instruction: "更像结论洞察",
      });
    });

    const framingSave = calls.find((call) => Array.isArray(call) && call[0] === "saveReportFraming") as unknown[];
    expect(framingSave[1]).toMatchObject({
      framing: {
        conclusion: "Anna should keep compounding the wedge where evidence is strongest [1].",
      },
    });
    expect(result.current.result?.report_markdown).toContain("Anna should keep compounding the wedge where evidence is strongest [1].");
  });

  it("uses a section-level allowed non-default source when the decision picks it", async () => {
    const tavily: ResearchSourceView = {
      id: "tavily",
      name: "Tavily",
      kind: "builtin",
      enabled: true,
      max_parallel: 3,
      credential_status: "configured",
      credential: "token-tav",
    };
    const custom: ResearchSourceView = {
      id: "custom",
      name: "Custom",
      kind: "user",
      enabled: true,
      max_parallel: 1,
      credential_status: "configured",
      credential: "token-cus",
    };
    const { api, calls, agentSessions } = makeApi({
      sources: [tavily, custom],
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        '{"sections":[{"id":"section-1","allowed_source_ids":["custom"]},{"id":"section-2","allowed_source_ids":["tavily"]},{"id":"section-3","allowed_source_ids":["tavily"]},{"id":"section-4","allowed_source_ids":["tavily"]}]}',
        '{"type":"call_source","source_id":"custom","queries":["focused query"]}',
        '{"type":"finish"}',
        SECTION_REPLY,
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Two").replace("[1]", "[2]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Three").replace("[1]", "[3]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("Section One", "Section Four").replace("[1]", "[4]"),
        FRAMING_REPLY,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    expect(result.current.phase).toBe("completed");
    const callSourceCalls = calls.filter((call) => Array.isArray(call) && call[0] === "callSectionResearchSource");
    expect(callSourceCalls.length).toBeGreaterThanOrEqual(1);
    expect((callSourceCalls[0] as unknown[])[1]).toMatchObject({ source_id: "custom", queries: ["focused query"] });
    const sourcesList = agentSessions[0].prompts[0];
    expect(sourcesList).toContain("custom");
    expect(sourcesList).not.toContain("tavily (Tavily)");
  });

  it("falls back to the section whitelist when the decision returns an unknown source_id", async () => {
    const tavily: ResearchSourceView = {
      id: "tavily",
      name: "Tavily",
      kind: "builtin",
      enabled: true,
      max_parallel: 3,
      credential_status: "configured",
      credential: "token-tav",
    };
    const { api, calls } = makeApi({
      sources: [tavily],
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        '{"type":"call_source","source_id":"unknown","queries":["anna fallback"]}',
        SECTION_REPLY,
        '{"type":"finish"}',
        SECTION_REPLY,
        '{"type":"finish"}',
        SECTION_REPLY,
        '{"type":"finish"}',
        SECTION_REPLY,
        FRAMING_REPLY,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    const callSourceCalls = calls.filter((call) => Array.isArray(call) && call[0] === "callSectionResearchSource");
    expect((callSourceCalls[0] as unknown[])[1]).toMatchObject({ source_id: "tavily" });
  });

  it("exposes CRUD operations on research sources", async () => {
    const { api, calls } = makeApi();
    const { result } = renderHook(() => useResearchJob(api));
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    await act(async () => {
      await result.current.setSourceEnabled({ id: "tavily", enabled: false });
      await result.current.upsertSource({
        definition: { id: "custom", name: "Custom" },
        credential: "secret-token",
      });
      await result.current.deleteSource({ id: "custom" });
    });

    expect(calls.find((call) => Array.isArray(call) && call[0] === "setResearchSourceEnabled")).toEqual([
      "setResearchSourceEnabled",
      { id: "tavily", enabled: false },
    ]);
    expect(calls.find((call) => Array.isArray(call) && call[0] === "upsertResearchSource")).toEqual([
      "upsertResearchSource",
      { definition: { id: "custom", name: "Custom" }, credential: "secret-token" },
    ]);
    expect(calls.find((call) => Array.isArray(call) && call[0] === "deleteResearchSource")).toEqual([
      "deleteResearchSource",
      { id: "custom" },
    ]);
  });

  it("retries an invalid SERP query plan", async () => {
    const { api, calls } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        "not json",
        '{"type":"call_source","source_id":"tavily","queries":["repaired query"],"knowledge_gap":"Missing evidence","rationale":"Needed for the section"}',
        SECTION_REPLY,
        '{"type":"finish"}',
        SECTION_REPLY.replace("[1]", "[2]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("[1]", "[3]"),
        '{"type":"finish"}',
        SECTION_REPLY.replace("[1]", "[4]"),
        FRAMING_REPLY,
      ],
    });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await planToOutline(result);
    await act(async () => {
      await result.current.confirmOutlineAndRun(result.current.outlineDraft);
    });

    const callSourceCalls = calls.filter((call) => Array.isArray(call) && call[0] === "callSectionResearchSource");
    expect(callSourceCalls.length).toBeGreaterThanOrEqual(1);
    expect((callSourceCalls[0] as unknown[])[1]).toMatchObject({
      research_id: "r1",
      section_id: "section-1",
      iteration: 1,
      source_id: "tavily",
      queries: ["repaired query"],
    });
  });
});
