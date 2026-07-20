import {
  TOOL_ID,
  type AttachmentPrepareInput,
  type AnnaAgentSession,
  type AnnaRuntimeApi,
  type CitationSource,
  type IterationEntry,
  type ConfirmedResearchRole,
  type ReportFraming,
  type ReportSection,
  type ResearchJob,
  type ResearchResult,
  type ResearchSourceTestResult,
  type ResearchSourceView,
  type SectionResult,
  type ApsTransferDescriptor,
  type SearchResult,
  type SourceCallResult,
  type StartResearchInput,
  type ToolSettings,
} from "../types";
import { downloadJsonTransfer, uploadJsonTransfer } from "./apsFiles";

const LONG_TOOL_TIMEOUT_MS = 300_000;

interface SettingsResponse {
  settings?: ToolSettings;
}

interface JobResponse {
  job?: ResearchJob | null;
}

interface JobListResponse {
  jobs?: ResearchJob[];
}

interface SourceListResponse {
  sources?: ResearchSourceView[];
}

interface SourceResponse {
  source?: ResearchSourceView;
}

interface SourceTestResponse {
  test?: ResearchSourceTestResult;
  test_transfer?: ApsTransferDescriptor;
}

interface JobPayloadResponse extends JobResponse, ResultResponse {}

interface JobPayloadTransferResponse {
  transfer?: ApsTransferDescriptor;
}

interface CallSourceResponse extends JobResponse {
  source_call?: SourceCallResult;
}

interface ContextResponse extends JobResponse {
  selected_context?: string;
  selected_sources?: SearchResult[];
  source_urls?: string[];
  context_transfer?: ApsTransferDescriptor;
}

interface OutlineDraftResponse extends JobResponse {
  outline?: ReportSection[];
}

interface AttachmentContextResponse {
  selected_context?: string;
  selected_items?: Array<{
    kind?: "chunk" | "image_analysis" | string;
    item_id?: string;
    file_id?: string;
    file_name?: string;
    path?: string;
    content_type?: string;
    index?: number;
    score?: number;
    quote?: string;
  }>;
  selected_item_count?: number;
}

interface ResultResponse extends JobResponse {
  result?: ResearchResult;
}

interface TransferResponse {
  transfer?: ApsTransferDescriptor;
}

export interface ResearchApi {
  getSettings(): Promise<ToolSettings>;
  listResearchSources(): Promise<ResearchSourceView[]>;
  updateResearchSourceCredential(input: { id: string; credential?: string; clear?: boolean }): Promise<ResearchSourceView>;
  setResearchSourceEnabled(input: { id: string; enabled: boolean }): Promise<ResearchSourceView>;
  upsertResearchSource(input: { definition: Record<string, unknown>; credential?: string }): Promise<ResearchSourceView>;
  deleteResearchSource(input: { id: string }): Promise<{ id: string; deleted: boolean }>;
  testResearchSource(input: { id: string; definition: Record<string, unknown>; query: string }): Promise<ResearchSourceTestResult>;
  createResearchJob(input: StartResearchInput): Promise<ResearchJob>;
  updateResearchJob(researchId: string, updates: Record<string, unknown>): Promise<ResearchJob>;
  prepareAttachments(researchId: string, attachments: AttachmentPrepareInput[]): Promise<ResearchJob>;
  embedAttachmentChunks(researchId: string): Promise<ResearchJob>;
  summarizeAttachments(researchId: string, input?: { query?: string; top_k?: number }): Promise<ResearchJob>;
  selectAttachmentContext(input: { research_id: string; query: string; top_k?: number }): Promise<AttachmentContextResponse>;
  getResearchJob(researchId?: string): Promise<ResearchJob | null>;
  getResearchJobPayload(researchId: string): Promise<ResearchJob>;
  listResearchJobs(input?: { limit?: number }): Promise<ResearchJob[]>;
  saveConfirmedResearchRole(researchId: string, role: ConfirmedResearchRole): Promise<ResearchJob>;
  generateOutlineDraft(input: {
    research_id: string;
    source_ids: string[];
    instruction?: string;
    reuse_discovery?: boolean;
  }): Promise<ReportSection[]>;
  saveConfirmedResearchOutline(researchId: string, sections: ReportSection[]): Promise<ResearchJob>;
  callSectionResearchSource(input: {
    research_id: string;
    section_id: string;
    iteration: number;
    source_id: string;
    queries: string[];
    research_decision?: {
      type: "call_source";
      knowledge_gap?: string;
      rationale?: string;
      target_facet_ids?: string[];
    };
  }): Promise<CallSourceResponse>;
  selectSectionContext(input: { research_id: string; section_id: string; iteration?: number; query?: string; search_queries?: string[] }): Promise<ContextResponse>;
  saveSectionResult(input: {
    research_id: string;
    section_id: string;
    section_markdown: string;
    section_summary: string;
    subsection_headers?: string[];
    source_urls?: string[];
    citation_sources?: CitationSource[];
    status?: string;
    error?: unknown;
  }): Promise<ResearchJob>;
  getSectionResult(researchId: string, sectionId: string): Promise<SectionResult | null>;
  saveReportFraming(input: { research_id: string; framing: ReportFraming }): Promise<ResearchJob>;
  saveAssembledResearchResult(input: { research_id: string; report_markdown: string; source_urls?: string[]; citation_sources?: CitationSource[] }): Promise<ResearchJob>;
  complete(messages: AnnaRuntimeApi["llm"]["complete"] extends (request: infer Req) => unknown ? Req : never): ReturnType<
    AnnaRuntimeApi["llm"]["complete"]
  >;
  createAgentSession(): Promise<AnnaAgentSession>;
}

export class AnnaResearchApi implements ResearchApi {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly anna: AnnaRuntimeApi) {}

  async getSettings(): Promise<ToolSettings> {
    const response = (await this.call("app_get_settings", {})) as SettingsResponse;
    if (!response.settings) throw new Error("Settings response did not include settings.");
    return response.settings;
  }

  async listResearchSources(): Promise<ResearchSourceView[]> {
    const response = (await this.call("app_list_research_sources", {})) as SourceListResponse;
    return response.sources ?? [];
  }

  async updateResearchSourceCredential(input: { id: string; credential?: string; clear?: boolean }): Promise<ResearchSourceView> {
    const response = (await this.call("app_update_research_source_credential", input)) as SourceResponse;
    if (!response.source) throw new Error("Source update did not return the source view.");
    return response.source;
  }

  async setResearchSourceEnabled(input: { id: string; enabled: boolean }): Promise<ResearchSourceView> {
    const response = (await this.call("app_set_research_source_enabled", input)) as SourceResponse;
    if (!response.source) throw new Error("Source enable did not return the source view.");
    return response.source;
  }

  async upsertResearchSource(input: { definition: Record<string, unknown>; credential?: string }): Promise<ResearchSourceView> {
    const response = (await this.call("app_upsert_research_source", input)) as SourceResponse;
    if (!response.source) throw new Error("Source upsert did not return the source view.");
    return response.source;
  }

  async deleteResearchSource(input: { id: string }): Promise<{ id: string; deleted: boolean }> {
    const response = (await this.call("app_delete_research_source", input)) as { id?: string; deleted?: boolean };
    return { id: response.id ?? input.id, deleted: Boolean(response.deleted) };
  }

  async testResearchSource(input: { id: string; definition: Record<string, unknown>; query: string }): Promise<ResearchSourceTestResult> {
    const response = (await this.call("app_test_research_source", input)) as SourceTestResponse;
    if (response.test_transfer?.path) {
      const data = await downloadJsonTransfer<SourceTestResponse>({ filesApi: this.anna.files, transfer: response.test_transfer });
      if (data.test) return data.test;
    }
    if (!response.test) throw new Error("Source test did not return a test result.");
    return response.test;
  }

  async createResearchJob(input: StartResearchInput): Promise<ResearchJob> {
    return requireJob(await this.call("app_create_research_job", { query: input.query }));
  }

  async updateResearchJob(researchId: string, updates: Record<string, unknown>): Promise<ResearchJob> {
    return requireJob(await this.call("app_update_research_job", { research_id: researchId, updates }));
  }

  async prepareAttachments(researchId: string, attachments: AttachmentPrepareInput[]): Promise<ResearchJob> {
    return requireJob(await this.call("app_prepare_attachments", { research_id: researchId, attachments }));
  }

  async embedAttachmentChunks(researchId: string): Promise<ResearchJob> {
    return requireJob(await this.call("app_embed_attachment_chunks", { research_id: researchId }));
  }

  async summarizeAttachments(researchId: string, input: { query?: string; top_k?: number } = {}): Promise<ResearchJob> {
    return requireJob(await this.call("app_summarize_attachments", { research_id: researchId, ...input }));
  }

  async selectAttachmentContext(input: { research_id: string; query: string; top_k?: number }): Promise<AttachmentContextResponse> {
    return (await this.call("app_select_attachment_context", input)) as AttachmentContextResponse;
  }

  async getResearchJob(researchId?: string): Promise<ResearchJob | null> {
    const key = `compact:${researchId || "latest"}`;
    return this.coalesce(key, async () => {
      const response = (await this.call("app_get_research_job", researchId ? { research_id: researchId } : {})) as JobResponse;
      return response.job ?? null;
    });
  }

  async getResearchJobPayload(researchId: string): Promise<ResearchJob> {
    const key = `payload:${researchId}`;
    return this.coalesce(key, async () => {
      const response = (await this.call("app_get_research_job_payload", { research_id: researchId })) as JobPayloadTransferResponse;
      if (!response.transfer) throw new Error("Research job payload did not include an APS transfer.");
      const data = await downloadJsonTransfer<JobPayloadResponse>({ filesApi: this.anna.files, transfer: response.transfer });
      if (!data.job) throw new Error("Research job payload did not include a job.");
      return data.result ? { ...data.job, result: data.result } : data.job;
    });
  }

  private coalesce<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const pending = operation().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  async listResearchJobs(input: { limit?: number } = {}): Promise<ResearchJob[]> {
    const response = (await this.call("app_list_research_jobs", { limit: input.limit ?? 50 })) as JobListResponse;
    return response.jobs ?? [];
  }

  async saveConfirmedResearchRole(researchId: string, role: ConfirmedResearchRole): Promise<ResearchJob> {
    return requireJob(await this.call("app_save_confirmed_research_role", { research_id: researchId, role }));
  }

  async generateOutlineDraft(input: {
    research_id: string;
    source_ids: string[];
    instruction?: string;
    reuse_discovery?: boolean;
  }): Promise<ReportSection[]> {
    const response = (await this.call("app_generate_outline_draft", input)) as OutlineDraftResponse;
    if (!Array.isArray(response.outline) || !response.outline.length) throw new Error("Outline generation did not return any sections.");
    return response.outline;
  }

  async saveConfirmedResearchOutline(researchId: string, sections: ReportSection[]): Promise<ResearchJob> {
    return requireJob(await this.call("app_save_confirmed_research_outline", { research_id: researchId, sections }));
  }

  async callSectionResearchSource(input: {
    research_id: string;
    section_id: string;
    iteration: number;
    source_id: string;
    queries: string[];
    research_decision?: {
      type: "call_source";
      knowledge_gap?: string;
      rationale?: string;
      target_facet_ids?: string[];
    };
  }): Promise<CallSourceResponse> {
    return (await this.call("app_call_section_research_source", input)) as CallSourceResponse;
  }

  async selectSectionContext(input: { research_id: string; section_id: string; iteration?: number; query?: string; search_queries?: string[] }): Promise<ContextResponse> {
    const response = (await this.call("app_select_section_context", input)) as ContextResponse;
    if (!response.context_transfer?.path) return response;
    const context = await downloadJsonTransfer<ContextResponse>({ filesApi: this.anna.files, transfer: response.context_transfer });
    return { ...response, ...context, job: response.job };
  }

  async saveSectionResult(input: {
    research_id: string;
    section_id: string;
    section_markdown: string;
    section_summary: string;
    subsection_headers?: string[];
    source_urls?: string[];
    citation_sources?: CitationSource[];
    status?: string;
    error?: unknown;
  }): Promise<ResearchJob> {
    const payloadTransfer = await uploadJsonTransfer({
      filesApi: this.anna.files,
      prefix: researchTransferPrefix(input.research_id),
      kind: `section-result-${input.section_id}`,
      payload: input,
    });
    return requireJob(await this.call("app_save_section_result", {
      research_id: input.research_id,
      section_id: input.section_id,
      payload_transfer: payloadTransfer,
    }));
  }

  async getSectionResult(researchId: string, sectionId: string): Promise<SectionResult | null> {
    const response = (await this.call("app_get_section_result", { research_id: researchId, section_id: sectionId })) as TransferResponse;
    if (!response.transfer?.path) return null;
    const data = await downloadJsonTransfer<{ section_result?: SectionResult }>({ filesApi: this.anna.files, transfer: response.transfer });
    return data.section_result ?? null;
  }

  async saveReportFraming(input: { research_id: string; framing: ReportFraming }): Promise<ResearchJob> {
    const payloadTransfer = await uploadJsonTransfer({
      filesApi: this.anna.files,
      prefix: researchTransferPrefix(input.research_id),
      kind: "report-framing",
      payload: input,
    });
    return requireJob(await this.call("app_save_report_framing", { research_id: input.research_id, payload_transfer: payloadTransfer }));
  }

  async saveAssembledResearchResult(input: { research_id: string; report_markdown: string; source_urls?: string[]; citation_sources?: CitationSource[] }): Promise<ResearchJob> {
    const payloadTransfer = await uploadJsonTransfer({
      filesApi: this.anna.files,
      prefix: researchTransferPrefix(input.research_id),
      kind: "assembled-result",
      payload: input,
    });
    const data = (await this.call("app_save_assembled_research_result", {
      research_id: input.research_id,
      payload_transfer: payloadTransfer,
    })) as ResultResponse;
    const job = requireJob(data);
    return { ...job, result: data.result ?? job.result };
  }

  complete(request: Parameters<AnnaRuntimeApi["llm"]["complete"]>[0]) {
    return this.anna.llm.complete(request);
  }

  async createAgentSession(): Promise<AnnaAgentSession> {
    if (!this.anna.agent) throw new Error("Anna Agent API is unavailable for section generation.");
    return this.anna.agent.session({ submode: "auto" });
  }

  private async call(method: string, args: Record<string, unknown>): Promise<unknown> {
    const timeoutMs = toolTimeoutMs(method, args);
    const request = timeoutMs === undefined ? { tool_id: TOOL_ID, method, args } : { tool_id: TOOL_ID, method, args, timeoutMs };
    const response =
      timeoutMs === undefined ? await this.anna.tools.invoke(request) : await this.anna.tools.invoke(request, { timeoutMs });
    const maybe = response as { success?: boolean; data?: unknown; error?: string };
    if (maybe && maybe.success === false) {
      const error = new Error(maybe.error || "Research tool invocation failed.") as Error & { details?: unknown };
      error.details = maybe.data;
      throw error;
    }
    return maybe && "data" in maybe ? maybe.data : response;
  }
}

function toolTimeoutMs(method: string, args: Record<string, unknown>): number | undefined {
  if (
    method === "app_embed_attachment_chunks" ||
    method === "app_summarize_attachments" ||
    method === "app_select_section_context" ||
    method === "app_generate_outline_draft"
  ) {
    return LONG_TOOL_TIMEOUT_MS;
  }
  if (method === "app_call_section_research_source") {
    return args.source_id === "duckduckgo" ? LONG_TOOL_TIMEOUT_MS : undefined;
  }
  if (method === "app_test_research_source") {
    return args.id === "duckduckgo" ? LONG_TOOL_TIMEOUT_MS : undefined;
  }
  return undefined;
}

function researchTransferPrefix(researchId: string): string {
  return `research-jobs/${researchId.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}

export function createStandaloneApi(): ResearchApi {
  const fail = async () => {
    throw new Error("Anna runtime is not connected.");
  };
  return {
    getSettings: fail,
    listResearchSources: fail,
    updateResearchSourceCredential: fail,
    setResearchSourceEnabled: fail,
    upsertResearchSource: fail,
    deleteResearchSource: fail,
    testResearchSource: fail,
    createResearchJob: fail,
    updateResearchJob: fail,
    prepareAttachments: fail,
    embedAttachmentChunks: fail,
    summarizeAttachments: fail,
    selectAttachmentContext: fail,
    getResearchJob: fail,
    listResearchJobs: fail,
    saveConfirmedResearchRole: fail,
    generateOutlineDraft: fail,
    saveConfirmedResearchOutline: fail,
    callSectionResearchSource: fail,
    selectSectionContext: fail,
    saveSectionResult: fail,
    getSectionResult: fail,
    saveReportFraming: fail,
    saveAssembledResearchResult: fail,
    complete: fail as ResearchApi["complete"],
    createAgentSession: fail,
  };
}

function requireJob(response: unknown): ResearchJob {
  const job = (response as JobResponse)?.job;
  if (!job) throw new Error("Research response did not include a job.");
  return job;
}

export type { IterationEntry };
