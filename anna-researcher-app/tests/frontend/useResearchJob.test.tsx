import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MAX_RESEARCH_ITERATIONS, useResearchJob } from "../../src/hooks/useResearchJob";
import type { ResearchApi } from "../../src/api/researchApi";
import type { ConfirmedResearchRole, ReportFraming, ReportSection, ResearchSourceView, SourceCallResult } from "../../src/types";

type LlmReply = string;

interface ApiOptions {
  configured?: boolean;
  llmReplies?: LlmReply[];
  callOverrides?: Array<Partial<SourceCallResult>>;
  sources?: ResearchSourceView[];
  latestJob?: Awaited<ReturnType<ResearchApi["getResearchJob"]>>;
  historyJobs?: Awaited<ReturnType<ResearchApi["listResearchJobs"]>>;
}

function makeApi(options: ApiOptions = {}) {
  const calls: unknown[] = [];
  const llmCalls: Array<{ messages: unknown }> = [];
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
  const api: ResearchApi = {
    async getSettings() {
      calls.push(["getSettings"]);
      return { tavily: { configured, masked: configured ? "***test" : "" } };
    },
    async updateSettings(input) {
      calls.push(["updateSettings", input]);
      return { tavily: { configured: !input.clear_tavily_api_key, masked: input.clear_tavily_api_key ? "" : "***test" } };
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
      return { research_id: "r1", status: "created", stage: "select_role", progress: 0, query: input.query };
    },
    async updateResearchJob(researchId, updates) {
      calls.push(["updateResearchJob", researchId, updates]);
      return { research_id: researchId, status: "running", ...(updates as object) };
    },
    async callResearchSource(input) {
      calls.push(["callResearchSource", input]);
      const override = callOverrides[callIndex] ?? {};
      callIndex++;
      return {
        job: {
          research_id: input.research_id,
          status: "running",
          stage: "search_next_query",
          progress: 50 + input.iteration * 5,
          iteration: input.iteration,
          iterations: [],
        },
        source_call: {
          source_id: input.source_id,
          source_name: "Tavily",
          queries: input.queries,
          results_count: override.results_count ?? input.queries.length,
          top_titles: override.top_titles ?? input.queries.map((q) => `Title for ${q}`),
          duration_ms: 5,
          error: override.error ?? null,
          calls: override.calls ?? input.queries.map((q) => ({
            source_id: input.source_id,
            source_name: "Tavily",
            query: q,
            results_count: 1,
            top_titles: [`Title for ${q}`],
            duration_ms: 5,
            error: null,
          })),
        },
      };
    },
    async saveConfirmedResearchRole(researchId: string, role: ConfirmedResearchRole) {
      calls.push(["saveConfirmedResearchRole", researchId, role]);
      return { research_id: researchId, status: "created", stage: "brainstorm_focus", progress: 15, query: "anna", confirmed_role: role };
    },
    async saveConfirmedResearchFocuses(researchId: string, focuses: string[]) {
      calls.push(["saveConfirmedResearchFocuses", researchId, focuses]);
      return { research_id: researchId, status: "created", stage: "plan_outline", progress: 25, query: "anna", confirmed_focuses: focuses };
    },
    async saveConfirmedResearchOutline(researchId: string, sections: ReportSection[]) {
      calls.push(["saveConfirmedResearchOutline", researchId, sections]);
      return { research_id: researchId, status: "running", stage: "section_research", progress: 35, query: "anna", confirmed_outline: sections };
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
      return {
        job: { research_id: input.research_id, status: "running", stage: "select_context", progress: 88 },
        selected_context: `FULL CONTEXT ${input.section_id}`,
        selected_sources: [],
        source_urls: [`https://example.com/${input.section_id}`],
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
    async failSection(input) {
      calls.push(["failSection", input]);
      return { research_id: input.research_id, status: "failed", stage: "failed", error: { message: "failed" } };
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
    async selectContext(input) {
      calls.push(["selectContext", input]);
      return {
        job: { research_id: input.research_id, status: "running", stage: "select_context", progress: 88 },
        selected_context: "FULL CONTEXT",
        selected_sources: [],
        source_urls: ["https://example.com"],
      };
    },
    async saveResearchResult(input) {
      calls.push(["saveResearchResult", input]);
      return { method: "POST", url: "http://127.0.0.1:43123/research-results/" + input.research_id, content_type: "application/json" };
    },
    async uploadResearchResult(transfer, input) {
      calls.push(["uploadResearchResult", transfer, input]);
      return {
        job: {
          research_id: "r1",
          status: "completed",
          stage: "completed",
          progress: 100,
          result: { report_markdown: input.report_markdown, source_urls: input.source_urls },
        },
        result: { report_markdown: input.report_markdown, source_urls: input.source_urls },
      };
    },
    async complete(request) {
      llmCalls.push(request as { messages: unknown });
      expect(request).not.toHaveProperty("maxTokens");
      const index = llmCalls.length - 1;
      const reply = replies[index] ?? "";
      return { content: { type: "text", text: reply } };
    },
  };
  return { api, calls, llmCalls };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const ROLE_REPLY = '{"roles":[{"server":"Researcher","agent_role_prompt":"Use sources."},{"server":"Analyst","agent_role_prompt":"Analyze sources."},{"server":"Expert","agent_role_prompt":"Expert sources."}]}';
const FOCUS_REPLY = '{"focuses":[{"text":"focus one"},{"text":"focus two"},{"text":"focus three"},{"text":"focus four"},{"text":"focus five"}]}';
const OUTLINE_REPLY = '{"sections":[{"title":"Section One","outline":"Cover one.","max_iterations":2},{"title":"Section Two","outline":"Cover two.","max_iterations":1},{"title":"Section Three","outline":"Cover three.","max_iterations":1},{"title":"Section Four","outline":"Cover four.","max_iterations":1}]}';
const ASSIGN_REPLY = '{"sections":[{"id":"section-1","allowed_source_ids":["tavily"]},{"id":"section-2","allowed_source_ids":["tavily"]},{"id":"section-3","allowed_source_ids":["tavily"]},{"id":"section-4","allowed_source_ids":["tavily"]}]}';
const DECISION_REPLY = '{"type":"call_source","queries":["anna query"]}';
const SECTION_REPLY = '{"section_markdown":"## Section One\\n\\nUses FULL CONTEXT [1]","section_summary":"section summary"}';
const FRAMING_REPLY = '{"title":"Done","introduction":"Intro","conclusion":"Conclusion"}';

async function planToOutline(result: ReturnType<typeof renderHook<ReturnType<typeof useResearchJob>, unknown>>["result"]) {
  await act(async () => {
    await result.current.start("anna");
  });
  await waitFor(() => expect(result.current.phase).toBe("role_review"));
  await act(async () => {
    await result.current.confirmRole(result.current.roleCandidates[0]);
  });
  await waitFor(() => expect(result.current.phase).toBe("focus_review"));
  await act(async () => {
    await result.current.confirmFocuses(["focus one"]);
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
    expect(JSON.stringify(llmCalls[0])).not.toContain('"rationale"');
  });

  it("exposes draft generation phases while waiting for LLM planning replies", async () => {
    const roleReply = deferred<string>();
    const focusReply = deferred<string>();
    const outlineReply = deferred<string>();
    const assignReply = deferred<string>();
    const replies = [roleReply.promise, focusReply.promise, outlineReply.promise, assignReply.promise];
    let replyIndex = 0;
    const base = makeApi();
    const api: ResearchApi = {
      ...base.api,
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

    let focusPromise!: Promise<void>;
    act(() => {
      focusPromise = result.current.confirmRole(result.current.roleCandidates[0]);
    });
    await waitFor(() => expect(result.current.phase).toBe("generating_focuses"));
    await act(async () => {
      focusReply.resolve(FOCUS_REPLY);
      await focusPromise;
    });
    expect(result.current.phase).toBe("focus_review");

    let outlinePromise!: Promise<void>;
    act(() => {
      outlinePromise = result.current.confirmFocuses(["focus one"]);
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

  it("confirms role and focus candidates before outline generation", async () => {
    const { api, calls, llmCalls } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        FOCUS_REPLY,
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
    expect(result.current.phase).toBe("focus_review");
    expect(result.current.focusCandidates).toHaveLength(5);
    await act(async () => {
      await result.current.confirmFocuses(["focus one", "focus two"]);
    });
    expect(result.current.phase).toBe("outline_review");
    expect(result.current.outlineDraft).toHaveLength(4);
    expect(result.current.outlineDraft[0].allowed_source_ids).toEqual(["tavily"]);
    expect(llmCalls).toHaveLength(4);
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveConfirmedResearchRole")).toBe(true);
    expect(calls.some((call) => Array.isArray(call) && call[0] === "saveConfirmedResearchFocuses")).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("query_domains");
    expect(JSON.stringify(calls)).not.toContain("search_index");
    expect(JSON.stringify(calls)).not.toContain("search_total");
  });

  it("runs confirmed outline through section source calls, section writer, framing, and final assembly", async () => {
    const { api, calls } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        FOCUS_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        DECISION_REPLY,
        '{"type":"finish"}',
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
    expect(result.current.result?.report_markdown).toContain("# Done");
    expect(result.current.result?.report_markdown).toContain("## Section One");
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
  });

  it("uses a Chinese conclusion heading for Chinese reports", async () => {
    const chineseSection = '{"section_markdown":"## 市场\\n\\n福州有明确的本地需求 [1]","section_summary":"本地需求"}';
    const { api } = makeApi({
      llmReplies: [
        ROLE_REPLY,
        FOCUS_REPLY,
        OUTLINE_REPLY,
        ASSIGN_REPLY,
        '{"type":"finish"}',
        chineseSection,
        '{"type":"finish"}',
        chineseSection,
        '{"type":"finish"}',
        chineseSection,
        '{"type":"finish"}',
        chineseSection,
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
      confirmed_focuses: ["market"],
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
      confirmed_focuses: ["market"],
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
      confirmed_focuses: ["market"],
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
      confirmed_focuses: ["market"],
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
      confirmed_focuses: ["market"],
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
    const { api, calls, llmCalls } = makeApi({
      sources: [tavily, custom],
      llmReplies: [
        ROLE_REPLY,
        FOCUS_REPLY,
        OUTLINE_REPLY,
        '{"sections":[{"id":"section-1","allowed_source_ids":["custom"]},{"id":"section-2","allowed_source_ids":["tavily"]},{"id":"section-3","allowed_source_ids":["tavily"]},{"id":"section-4","allowed_source_ids":["tavily"]}]}',
        '{"type":"call_source","source_id":"custom","queries":["focused query"]}',
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

    expect(result.current.phase).toBe("completed");
    const callSourceCalls = calls.filter((call) => Array.isArray(call) && call[0] === "callSectionResearchSource");
    expect(callSourceCalls.length).toBeGreaterThanOrEqual(1);
    expect((callSourceCalls[0] as unknown[])[1]).toMatchObject({ source_id: "custom", queries: ["focused query"] });
    const sourcesList = JSON.stringify(llmCalls[4]);
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
        FOCUS_REPLY,
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

  it("falls back to using the section title when the first section decision returns invalid JSON", async () => {
    const { api, calls } = makeApi({
      llmReplies: [ROLE_REPLY, FOCUS_REPLY, OUTLINE_REPLY, ASSIGN_REPLY, "not json", SECTION_REPLY, '{"type":"finish"}', SECTION_REPLY, '{"type":"finish"}', SECTION_REPLY, '{"type":"finish"}', SECTION_REPLY, FRAMING_REPLY],
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
      queries: ["Section One"],
    });
  });
});
