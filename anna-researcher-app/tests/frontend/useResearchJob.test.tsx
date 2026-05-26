import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useResearchJob } from "../../src/hooks/useResearchJob";
import type { ResearchApi } from "../../src/api/researchApi";

function makeApi(options: { configured?: boolean; invalidPlanning?: boolean } = {}) {
  const calls: unknown[] = [];
  const llmCalls: unknown[] = [];
  const configured = options.configured ?? true;
  const api: ResearchApi = {
    async getSettings() {
      calls.push(["getSettings"]);
      return { tavily: { configured, masked: configured ? "tvly...test" : "" } };
    },
    async updateSettings(input) {
      calls.push(["updateSettings", input]);
      return { tavily: { configured: !input.clear_tavily_api_key, masked: input.clear_tavily_api_key ? "" : "tvly...test" } };
    },
    async getResearchJob() {
      calls.push(["getResearchJob"]);
      return null;
    },
    async createResearchJob(input) {
      calls.push(["createResearchJob", input]);
      return { research_id: "r1", status: "created", stage: "select_role", progress: 0, query: input.query, query_domains: input.query_domains };
    },
    async updateResearchJob(researchId, updates) {
      calls.push(["updateResearchJob", researchId, updates]);
      return { research_id: researchId, status: "running", ...(updates as object) };
    },
    async searchWeb(input) {
      calls.push(["searchWeb", input]);
      return { job: { research_id: input.research_id, status: "running", stage: "select_context", progress: 75 }, search_results: [], source_urls: ["https://example.com"] };
    },
    async selectContext(input) {
      calls.push(["selectContext", input]);
      return { job: { research_id: input.research_id, status: "running", stage: "write_report", progress: 90 }, selected_context: "FULL CONTEXT", selected_sources: [], source_urls: ["https://example.com"] };
    },
    async saveResearchResult(input) {
      calls.push(["saveResearchResult", input]);
      return { job: { research_id: input.research_id, status: "completed", stage: "completed", progress: 100, result: { report_markdown: input.report_markdown, source_urls: input.source_urls } }, result: { report_markdown: input.report_markdown, source_urls: input.source_urls } };
    },
    async complete(request) {
      llmCalls.push(request);
      expect(request).not.toHaveProperty("maxTokens");
      const index = llmCalls.length;
      if (index === 1) return { content: { type: "text", text: '{"server":"Researcher","agent_role_prompt":"Use sources."}' } };
      if (index === 2) return { content: { type: "text", text: options.invalidPlanning ? "not json" : '{"queries":["anna query","second query"]}' } };
      return { content: { type: "text", text: "# Done\n\nUses FULL CONTEXT" } };
    },
  };
  return { api, calls, llmCalls };
}

describe("useResearchJob", () => {
  it("gates research when Tavily settings are missing", async () => {
    const { api, calls } = makeApi({ configured: false });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("settings_required"));
    await act(async () => {
      await result.current.start("anna", []);
    });

    expect(calls.some((call) => Array.isArray(call) && call[0] === "createResearchJob")).toBe(false);
  });

  it("runs frontend-owned research flow and omits llm maxTokens", async () => {
    const { api, calls, llmCalls } = makeApi();
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => {
      await result.current.start("anna", ["example.com"]);
    });

    expect(result.current.phase).toBe("completed");
    expect(result.current.result?.report_markdown).toContain("# Done");
    expect(llmCalls).toHaveLength(3);
    expect(JSON.stringify(llmCalls[2])).toContain("FULL CONTEXT");
    expect(calls.some((call) => JSON.stringify(call).includes("app_"))).toBe(false);
    expect(calls.find((call) => Array.isArray(call) && call[0] === "searchWeb")).toEqual([
      "searchWeb",
      { research_id: "r1", search_queries: ["anna", "anna query", "second query"], query_domains: ["example.com"] },
    ]);
  });

  it("falls back to original query when query planning JSON is invalid", async () => {
    const { api, calls } = makeApi({ invalidPlanning: true });
    const { result } = renderHook(() => useResearchJob(api));

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    await act(async () => {
      await result.current.start("anna", []);
    });

    expect(calls.find((call) => Array.isArray(call) && call[0] === "searchWeb")).toEqual([
      "searchWeb",
      { research_id: "r1", search_queries: ["anna"], query_domains: [] },
    ]);
  });
});

