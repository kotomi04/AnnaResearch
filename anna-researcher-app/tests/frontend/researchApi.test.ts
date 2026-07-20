import { afterEach, describe, expect, it } from "vitest";
import { AnnaResearchApi } from "../../src/api/researchApi";
import { TOOL_ID, type AnnaRuntimeApi, type ApsTransferDescriptor } from "../../src/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("AnnaResearchApi", () => {
  it("loads a backend-generated outline without APS transfer", async () => {
    const calls: unknown[] = [];
    const anna = minimalRuntime(async (request, options) => {
      calls.push([request, options]);
      return { success: true, data: { outline: [{ id: "section-1", title: "Market", outline: "Assess.", facet_ids: ["f1"], allowed_source_ids: [], max_iterations: 5 }] } };
    });
    const outline = await new AnnaResearchApi(anna).generateOutlineDraft({ research_id: "r1", source_ids: ["tavily"] });
    expect(outline[0].title).toBe("Market");
    expect(calls).toEqual([[
      { tool_id: TOOL_ID, method: "app_generate_outline_draft", args: { research_id: "r1", source_ids: ["tavily"] }, timeoutMs: 300000 },
      { timeoutMs: 300000 },
    ]]);
  });

  it("creates an auto Agent session and rejects when Agent API is unavailable", async () => {
    const session = { async *run() {}, async delete() {} };
    const anna = minimalRuntime(async () => ({}));
    anna.agent = { async session(input) { expect(input).toEqual({ submode: "auto" }); return session; } };
    await expect(new AnnaResearchApi(anna).createAgentSession()).resolves.toBe(session);
    await expect(new AnnaResearchApi(minimalRuntime(async () => ({}))).createAgentSession()).rejects.toThrow("Agent API is unavailable");
  });

  it("keeps compact job reads off APS and downloads full job, context, section, and source-test payloads", async () => {
    const aps = makeApsHarness();
    globalThis.fetch = aps.fetch;
    const jobTransfer = await aps.seed("research-jobs/r1/transfers/job.json", { job: { research_id: "r1", status: "completed", section_results: {} }, result: { report_markdown: "# Restored", source_urls: [] } });
    const contextTransfer = await aps.seed("research-jobs/r1/transfers/context.json", { selected_context: "evidence", selected_sources: [], source_urls: [] });
    const sectionTransfer = await aps.seed("research-jobs/r1/transfers/section.json", { section_result: { section_id: "section-1", section_markdown: "## Saved" } });
    const testTransfer = await aps.seed("research-source-tests/t1/transfers/test.json", { test: { source_id: "tavily", source_name: "Tavily", query: "anna", duration_ms: 1, pages: [], extracted: [], error: null } });
    const anna = runtimeWithAps(aps, async (request) => {
      if (request.method === "app_get_research_job") return { success: true, data: { job: { research_id: "r1", status: "completed" } } };
      if (request.method === "app_get_research_job_payload") return { success: true, data: { transfer: jobTransfer } };
      if (request.method === "app_select_section_context") return { success: true, data: { job: { research_id: "r1" }, context_transfer: contextTransfer } };
      if (request.method === "app_get_section_result") return { success: true, data: { transfer: sectionTransfer } };
      if (request.method === "app_test_research_source") return { success: true, data: { test_transfer: testTransfer } };
      return { success: true, data: {} };
    });
    const api = new AnnaResearchApi(anna);
    expect((await api.getResearchJob("r1"))?.result).toBeUndefined();
    expect((await api.getResearchJobPayload("r1")).result?.report_markdown).toBe("# Restored");
    expect((await api.selectSectionContext({ research_id: "r1", section_id: "section-1" })).selected_context).toBe("evidence");
    expect((await api.getSectionResult("r1", "section-1"))?.section_markdown).toBe("## Saved");
    expect((await api.testResearchSource({ id: "tavily", definition: { id: "tavily" }, query: "anna" })).source_id).toBe("tavily");
    expect(aps.deleted).toEqual(expect.arrayContaining([jobTransfer.path, contextTransfer.path, sectionTransfer.path, testTransfer.path]));
  });

  it("uploads section, framing, and assembled payloads to APS before invoking the tool", async () => {
    const aps = makeApsHarness();
    globalThis.fetch = aps.fetch;
    const calls: Array<{ method?: string; args?: Record<string, unknown> }> = [];
    const anna = runtimeWithAps(aps, async (request) => {
      calls.push(request);
      if (request.method === "app_save_assembled_research_result") return { success: true, data: { job: { research_id: "r1", status: "completed" }, result: { report_markdown: "# Final" } } };
      return { success: true, data: { job: { research_id: "r1", status: "running" } } };
    });
    const api = new AnnaResearchApi(anna);
    await api.saveSectionResult({ research_id: "r1", section_id: "section-1", section_markdown: "## Section", section_summary: "Summary" });
    await api.saveReportFraming({ research_id: "r1", framing: { title: "Title", introduction: "Intro", conclusion: "End" } });
    await api.saveAssembledResearchResult({ research_id: "r1", report_markdown: "# Final" });
    expect(calls.map((call) => call.method)).toEqual(["app_save_section_result", "app_save_report_framing", "app_save_assembled_research_result"]);
    expect(JSON.stringify(calls)).not.toContain("## Section");
    expect(JSON.stringify(calls)).not.toContain("# Final");
    for (const call of calls) {
      const transfer = call.args?.payload_transfer as ApsTransferDescriptor;
      expect(transfer.path).toContain("research-jobs/r1/transfers/");
      expect(transfer.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(aps.objects.has(transfer.path)).toBe(true);
    }
  });

  it("surfaces APS integrity failures without a localhost fallback", async () => {
    const aps = makeApsHarness();
    globalThis.fetch = aps.fetch;
    const transfer = await aps.seed("research-jobs/r1/transfers/job.json", { job: { research_id: "r1" } });
    transfer.sha256 = "0".repeat(64);
    const anna = runtimeWithAps(aps, async () => ({ success: true, data: { transfer } }));
    await expect(new AnnaResearchApi(anna).getResearchJobPayload("r1")).rejects.toThrow("sha256 mismatch");
    expect(aps.deleted).not.toContain(transfer.path);
  });

  it("coalesces concurrent compact and payload reads independently", async () => {
    const aps = makeApsHarness();
    globalThis.fetch = aps.fetch;
    const transfer = await aps.seed("research-jobs/r1/transfers/job.json", { job: { research_id: "r1", status: "running" } });
    const calls: string[] = [];
    const anna = runtimeWithAps(aps, async (request) => {
      calls.push(request.method);
      await Promise.resolve();
      return request.method === "app_get_research_job_payload"
        ? { success: true, data: { transfer } }
        : { success: true, data: { job: { research_id: "r1", status: "running" } } };
    });
    const api = new AnnaResearchApi(anna);
    await Promise.all([api.getResearchJob("r1"), api.getResearchJob("r1"), api.getResearchJobPayload("r1"), api.getResearchJobPayload("r1")]);
    expect(calls.filter((method) => method === "app_get_research_job")).toHaveLength(1);
    expect(calls.filter((method) => method === "app_get_research_job_payload")).toHaveLength(1);
    expect(aps.deleted.filter((path) => path === transfer.path)).toHaveLength(1);
  });

  it("adds extended timeouts for attachment processing and DuckDuckGo", async () => {
    const calls: unknown[] = [];
    const anna = minimalRuntime(async (request, options) => {
      calls.push(options ? [request, options] : request);
      if (request.method === "app_test_research_source") return { success: true, data: { test: { source_id: "duckduckgo", source_name: "DuckDuckGo", query: "anna", duration_ms: 1, pages: [], extracted: [], error: null } } };
      return { success: true, data: { job: { research_id: "r1" }, selected_context: "", selected_sources: [], source_urls: [] } };
    });
    const api = new AnnaResearchApi(anna);
    await api.embedAttachmentChunks("r1");
    await api.summarizeAttachments("r1", { query: "anna" });
    await api.callSectionResearchSource({ research_id: "r1", section_id: "section-1", iteration: 1, source_id: "duckduckgo", queries: ["anna"] });
    await api.testResearchSource({ id: "duckduckgo", definition: { id: "duckduckgo" }, query: "anna" });
    expect(JSON.stringify(calls).match(/300000/g)?.length).toBeGreaterThanOrEqual(8);
  });
});

function minimalRuntime(invoke: (request: any, options?: any) => Promise<any>): AnnaRuntimeApi {
  return { tools: { invoke }, llm: { async complete() { return { content: { type: "text", text: "{}" } }; } } } as AnnaRuntimeApi;
}

function runtimeWithAps(aps: ReturnType<typeof makeApsHarness>, invoke: (request: any, options?: any) => Promise<any>): AnnaRuntimeApi {
  return { ...minimalRuntime(invoke), files: aps.files } as AnnaRuntimeApi;
}

function makeApsHarness() {
  const objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const pathFromUrl = (url: string) => decodeURIComponent(url.split("/").pop() || "");
  const files = {
    async upload_init({ path }: { path: string }) { return { put_url: `https://aps.test/put/${encodeURIComponent(path)}`, upload_id: "upload-1", headers: {} }; },
    async upload_finalize({ path, etag, size_bytes }: { path: string; etag?: string; size_bytes?: number }) { return { path, etag, size_bytes }; },
    async download_url({ path }: { path: string }) { return { get_url: `https://aps.test/get/${encodeURIComponent(path)}` }; },
    async list() { return { items: [] }; },
    async delete({ path }: { path: string }) { deleted.push(path); objects.delete(path); },
  };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = pathFromUrl(url);
    if (url.includes("/put/")) {
      const body = init?.body;
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(path, Uint8Array.from(bytes));
      return new Response(null, { status: 200, headers: { ETag: "etag-1" } });
    }
    const payload = objects.get(path);
    return payload ? new Response(payload, { status: 200 }) : new Response("missing", { status: 404 });
  }) as typeof globalThis.fetch;
  return {
    objects,
    deleted,
    files,
    fetch,
    async seed(path: string, payload: unknown): Promise<ApsTransferDescriptor> {
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      objects.set(path, bytes);
      const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      return { path, content_type: "application/json", size_bytes: bytes.byteLength, sha256, delete_after_read: true };
    },
  };
}
