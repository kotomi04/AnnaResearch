import { describe, expect, it } from "vitest";
import { AnnaResearchApi } from "../../src/api/researchApi";
import { TOOL_ID, type AnnaRuntimeApi } from "../../src/types";

describe("AnnaResearchApi", () => {
  it("loads a backend-generated outline without an HTTP transfer", async () => {
    const calls: unknown[] = [];
    const anna = {
      tools: {
        async invoke(request: unknown, options: unknown) {
          calls.push([request, options]);
          return {
            success: true,
            data: {
              outline: [{ id: "section-1", title: "Market", outline: "Assess the market.", facet_ids: ["f1"], allowed_source_ids: [], max_iterations: 5 }],
            },
          };
        },
      },
      llm: { async complete() { return {}; } },
    } as unknown as AnnaRuntimeApi;
    const oldFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error("outline generation must not use HTTP transfer");
    }) as typeof fetch;
    try {
      const outline = await new AnnaResearchApi(anna).generateOutlineDraft({ research_id: "r1", source_ids: ["tavily"] });
      expect(outline[0].title).toBe("Market");
      expect(fetched).toBe(false);
      expect(calls).toEqual([[
        { tool_id: TOOL_ID, method: "app_generate_outline_draft", args: { research_id: "r1", source_ids: ["tavily"] }, timeoutMs: 300000 },
        { timeoutMs: 300000 },
      ]]);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("creates an auto Agent session through the frontend runtime", async () => {
    const calls: unknown[] = [];
    const session = { async *run() {}, async delete() {} };
    const anna = {
      tools: { async invoke() {} },
      llm: { async complete() { return {}; } },
      agent: {
        async session(input: unknown) {
          calls.push(input);
          return session;
        },
      },
    } as unknown as AnnaRuntimeApi;

    const api = new AnnaResearchApi(anna);
    await expect(api.createAgentSession()).resolves.toBe(session);
    expect(calls).toEqual([{ submode: "auto" }]);
  });

  it("rejects section session creation when the Agent API is unavailable", async () => {
    const anna = {
      tools: { async invoke() {} },
      llm: { async complete() { return {}; } },
    } as unknown as AnnaRuntimeApi;

    await expect(new AnnaResearchApi(anna).createAgentSession()).rejects.toThrow("Anna Agent API is unavailable for section generation.");
  });

  it("uses the production app tool methods", async () => {
    const calls: unknown[] = [];
    const anna: AnnaRuntimeApi = {
      tools: {
        async invoke(request, options) {
          calls.push(options ? [request, options] : request);
          if (request.method === "app_get_settings") {
            return { success: true, data: { settings: { tavily: { configured: true, masked: "***test" } } } };
          }
          if (request.method === "app_list_research_sources") {
            return {
              success: true,
              data: {
                sources: [
                  {
                    id: "tavily",
                    name: "Tavily",
                    kind: "builtin",
                    enabled: true,
                    max_parallel: 3,
                    credential_status: "configured",
                    credential: "tvly-test",
                  },
                ],
              },
            };
          }
          if (request.method === "app_update_research_source_credential") {
            return {
              success: true,
              data: {
                source: {
                  id: "tavily",
                  name: "Tavily",
                  kind: "builtin",
                  enabled: true,
                  max_parallel: 3,
                  credential_status: "configured",
                  credential: "tvly-test",
                },
              },
            };
          }
          if (request.method === "app_get_research_job") {
            return {
              success: true,
              data: {
                job: {
                  research_id: "r1",
                  status: "running",
                  job_transfer: { method: "GET", url: "http://127.0.0.1:43123/jobs/r1", content_type: "application/json" },
                },
              },
            };
          }
          if (request.method === "app_list_research_jobs") {
            return { success: true, data: { jobs: [{ research_id: "r1", status: "running" }] } };
          }
          if (request.method === "app_test_research_source") {
            return {
              success: true,
              data: {
                test_transfer: { method: "GET", url: "http://127.0.0.1:43123/source-tests/t1", content_type: "application/json" },
              },
            };
          }
          if (request.method === "app_select_section_context") {
            return {
              success: true,
              data: {
                job: { research_id: "r1" },
                context_transfer: { method: "GET", url: "http://127.0.0.1:43123/section-contexts/r1/section-1", content_type: "application/json" },
              },
            };
          }
          if (request.method === "app_save_report_framing") {
            return {
              success: true,
              data: { transfer: { method: "POST", url: "http://127.0.0.1:43123/report-framings/r1", content_type: "application/json" } },
            };
          }
          return { success: true, data: { job: { research_id: "r1", status: "running" } } };
        },
      },
      llm: {
        async complete() {
          return { content: { type: "text", text: "{}" } };
        },
      },
    };

    const api = new AnnaResearchApi(anna);
    const oldFetch = globalThis.fetch;
    const fetchCalls: unknown[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push([url, init]);
      if (String(url).includes("/jobs/")) {
        return new Response(JSON.stringify({ job: { research_id: "r1", status: "running", iterations: [], source_urls: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url).includes("/report-framings/")) {
        return new Response(JSON.stringify({ job: { research_id: "r1", status: "running", stage: "assemble_report", progress: 96 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url).includes("/source-tests/")) {
        return new Response(
          JSON.stringify({
            test: {
              source_id: "tavily",
              source_name: "Tavily",
              query: "anna",
              duration_ms: 1,
              pages: [],
              extracted: [],
              error: null,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ result: { report_markdown: "# Report", source_urls: ["https://example.com"] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      await api.getSettings();
      await api.listResearchSources();
      await api.updateResearchSourceCredential({ id: "tavily", credential: "tvly-test" });
      await api.createResearchJob({ query: "anna" });
      await api.updateResearchJob("r1", { stage: "plan_queries" });
      await api.prepareAttachments("r1", [
        {
          name: "brief.md",
          path: "research-jobs/r1/uploads/brief.md",
          content_type: "text/markdown",
          size_bytes: 12,
          download_url: "https://files.example/brief.md",
        },
      ]);
      await api.embedAttachmentChunks("r1");
      await api.getResearchJob("r1");
      await api.listResearchJobs({ limit: 20 });
      await api.testResearchSource({ id: "tavily", definition: { id: "tavily" }, query: "anna" });
      await api.saveReportFraming({
        research_id: "r1",
        framing: { title: "Report", introduction: "large intro", conclusion: "large conclusion" },
      });
      expect(calls).toEqual([
        { tool_id: TOOL_ID, method: "app_get_settings", args: {} },
        { tool_id: TOOL_ID, method: "app_list_research_sources", args: {} },
        { tool_id: TOOL_ID, method: "app_update_research_source_credential", args: { id: "tavily", credential: "tvly-test" } },
        { tool_id: TOOL_ID, method: "app_create_research_job", args: { query: "anna" } },
        { tool_id: TOOL_ID, method: "app_update_research_job", args: { research_id: "r1", updates: { stage: "plan_queries" } } },
        {
          tool_id: TOOL_ID,
          method: "app_prepare_attachments",
          args: {
            research_id: "r1",
            attachments: [
              {
                name: "brief.md",
                path: "research-jobs/r1/uploads/brief.md",
                content_type: "text/markdown",
                size_bytes: 12,
                download_url: "https://files.example/brief.md",
              },
            ],
          },
        },
        [
          {
            tool_id: TOOL_ID,
            method: "app_embed_attachment_chunks",
            args: { research_id: "r1" },
            timeoutMs: 300000,
          },
          { timeoutMs: 300000 },
        ],
        { tool_id: TOOL_ID, method: "app_get_research_job", args: { research_id: "r1" } },
        { tool_id: TOOL_ID, method: "app_list_research_jobs", args: { limit: 20 } },
        { tool_id: TOOL_ID, method: "app_test_research_source", args: { id: "tavily", definition: { id: "tavily" }, query: "anna" } },
        { tool_id: TOOL_ID, method: "app_save_report_framing", args: { research_id: "r1" } },
      ]);
      expect(JSON.stringify(calls)).not.toContain("large intro");
      expect(fetchCalls).toHaveLength(3);
      expect(fetchCalls[0]).toEqual(["http://127.0.0.1:43123/jobs/r1", { method: "GET" }]);
      expect(fetchCalls[1]).toEqual(["http://127.0.0.1:43123/source-tests/t1", { method: "GET" }]);
      expect(fetchCalls[2]).toEqual([
        "http://127.0.0.1:43123/report-framings/r1",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            research_id: "r1",
            framing: { title: "Report", introduction: "large intro", conclusion: "large conclusion" },
          }),
        },
      ]);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("keeps the result transfer after loading a compact transferred job", async () => {
    const anna: AnnaRuntimeApi = {
      tools: {
        async invoke(request) {
          expect(request).toEqual({ tool_id: TOOL_ID, method: "app_get_research_job", args: {} });
          return {
            success: true,
            data: {
              job: {
                research_id: "r1",
                status: "completed",
                job_transfer: { method: "GET", url: "http://127.0.0.1:43123/jobs/r1", content_type: "application/json" },
                result_transfer: { method: "GET", url: "http://127.0.0.1:43123/research-results/r1", content_type: "application/json" },
              },
            },
          };
        },
      },
      llm: {
        async complete() {
          return { content: { type: "text", text: "{}" } };
        },
      },
    };
    const oldFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      fetchCalls.push(String(url));
      if (String(url).includes("/jobs/")) {
        return new Response(JSON.stringify({ job: { research_id: "r1", status: "completed", iterations: [], source_urls: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ result: { report_markdown: "# Restored", source_urls: ["https://example.com"] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const api = new AnnaResearchApi(anna);
      const job = await api.getResearchJob();

      expect(fetchCalls).toEqual([
        "http://127.0.0.1:43123/jobs/r1",
        "http://127.0.0.1:43123/research-results/r1",
      ]);
      expect(job?.result?.report_markdown).toBe("# Restored");
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("opens an inline completed job when transfer URLs are unavailable", async () => {
    const anna: AnnaRuntimeApi = {
      tools: {
        async invoke(request) {
          expect(request).toEqual({ tool_id: TOOL_ID, method: "app_get_research_job", args: { research_id: "r1" } });
          return {
            success: true,
            data: {
              job: {
                research_id: "r1",
                status: "completed",
                confirmed_outline: [],
                result: { research_id: "r1", report_markdown: "# Inline", source_urls: ["https://example.com"] },
                job_transfer: { method: "GET", url: "http://127.0.0.1:43123/jobs/r1", content_type: "application/json" },
                result_transfer: { method: "GET", url: "http://127.0.0.1:43123/research-results/r1", content_type: "application/json" },
              },
            },
          };
        },
      },
      llm: {
        async complete() {
          return { content: { type: "text", text: "{}" } };
        },
      },
    };
    const oldFetch = globalThis.fetch;
    const oldWarn = console.warn;
    const warnings: unknown[] = [];
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const api = new AnnaResearchApi(anna);
      const job = await api.getResearchJob("r1");

      expect(job?.research_id).toBe("r1");
      expect(job?.result?.report_markdown).toBe("# Inline");
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = oldFetch;
      console.warn = oldWarn;
    }
  });

  it("keeps section and assembled large payloads out of tool invoke arguments", async () => {
    const calls: unknown[] = [];
    const anna: AnnaRuntimeApi = {
      tools: {
        async invoke(request) {
          calls.push(request);
          if (request.method === "app_select_section_context") {
            return {
              success: true,
              data: {
                job: { research_id: "r1" },
                context_transfer: { method: "GET", url: "http://127.0.0.1:43123/section-contexts/r1/section-1", content_type: "application/json" },
              },
            };
          }
          if (request.method === "app_save_section_result") {
            return {
              success: true,
              data: {
                transfer: { method: "POST", url: "http://127.0.0.1:43123/section-results/r1/section-1", content_type: "application/json" },
              },
            };
          }
          if (request.method === "app_save_assembled_research_result") {
            return {
              success: true,
              data: {
                transfer: { method: "POST", url: "http://127.0.0.1:43123/assembled-research-results/r1", content_type: "application/json" },
              },
            };
          }
          return { success: true, data: { job: { research_id: "r1" } } };
        },
      },
      llm: {
        async complete() {
          return { content: { type: "text", text: "{}" } };
        },
      },
    };
    const oldFetch = globalThis.fetch;
    const fetchCalls: unknown[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push([url, init]);
      if (String(url).includes("/section-contexts/")) {
        return new Response(JSON.stringify({ selected_context: "section context", selected_sources: [], source_urls: ["https://example.com/s"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          job: { research_id: "r1", status: "completed" },
          result: { report_markdown: "# Final", source_urls: ["https://example.com/s"] },
          section_result: { section_markdown: "## Section", section_summary: "summary" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const api = new AnnaResearchApi(anna);
      await api.selectSectionContext({ research_id: "r1", section_id: "section-1" });
      await api.saveSectionResult({
        research_id: "r1",
        section_id: "section-1",
        section_markdown: "## Section",
        section_summary: "summary",
        source_urls: ["https://example.com/s"],
        status: "completed",
      });
      await api.saveAssembledResearchResult({ research_id: "r1", report_markdown: "# Final", source_urls: ["https://example.com/s"] });

      expect(JSON.stringify(calls)).not.toContain("## Section");
      expect(JSON.stringify(calls)).not.toContain("# Final");
      expect(JSON.stringify(fetchCalls)).toContain("## Section");
      expect(JSON.stringify(fetchCalls)).toContain("# Final");
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  it("adds an extended invoke timeout for attachment processing and DuckDuckGo source calls", async () => {
    const calls: unknown[] = [];
    const anna: AnnaRuntimeApi = {
      tools: {
        async invoke(request, options) {
          calls.push(options ? [request, options] : request);
          if (request.method === "app_test_research_source") {
            return {
              success: true,
              data: {
                test_transfer: { method: "GET", url: "http://127.0.0.1:43123/source-tests/t1", content_type: "application/json" },
              },
            };
          }
          return {
            success: true,
            data: {
              job: { research_id: "r1" },
              source_call: {
                source_id: "duckduckgo",
                source_name: "DuckDuckGo",
                queries: ["anna"],
                results_count: 0,
                top_titles: [],
                duration_ms: 0,
                error: null,
                calls: [],
              },
            },
          };
        },
      },
      llm: {
        async complete() {
          return { content: { type: "text", text: "{}" } };
        },
      },
    };
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          selected_context: "",
          selected_sources: [],
          source_urls: [],
          test: {
            source_id: "duckduckgo",
            source_name: "DuckDuckGo",
            query: "anna",
            duration_ms: 1,
            pages: [],
            extracted: [],
            error: null,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const api = new AnnaResearchApi(anna);
      await api.embedAttachmentChunks("r1");
      await api.summarizeAttachments("r1", { query: "anna", top_k: 6 });
      await api.selectSectionContext({ research_id: "r1", section_id: "section-1" });
      await api.callSectionResearchSource({
        research_id: "r1",
        section_id: "section-1",
        iteration: 1,
        source_id: "duckduckgo",
        queries: ["anna"],
      });
      await api.testResearchSource({ id: "duckduckgo", definition: { id: "duckduckgo" }, query: "anna" });

      expect(calls).toEqual([
        [
          {
            tool_id: TOOL_ID,
            method: "app_embed_attachment_chunks",
            args: { research_id: "r1" },
            timeoutMs: 300000,
          },
          { timeoutMs: 300000 },
        ],
        [
          {
            tool_id: TOOL_ID,
            method: "app_summarize_attachments",
            args: { research_id: "r1", query: "anna", top_k: 6 },
            timeoutMs: 300000,
          },
          { timeoutMs: 300000 },
        ],
        [
          {
            tool_id: TOOL_ID,
            method: "app_select_section_context",
            args: { research_id: "r1", section_id: "section-1" },
            timeoutMs: 300000,
          },
          { timeoutMs: 300000 },
        ],
        [
          {
            tool_id: TOOL_ID,
            method: "app_call_section_research_source",
            args: { research_id: "r1", section_id: "section-1", iteration: 1, source_id: "duckduckgo", queries: ["anna"] },
            timeoutMs: 300000,
          },
          { timeoutMs: 300000 },
        ],
        [
          {
            tool_id: TOOL_ID,
            method: "app_test_research_source",
            args: { id: "duckduckgo", definition: { id: "duckduckgo" }, query: "anna" },
            timeoutMs: 300000,
          },
          { timeoutMs: 300000 },
        ],
      ]);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});
