import {
  TOOL_ID,
  type AnnaRuntimeApi,
  type IterationEntry,
  type ConfirmedResearchRole,
  type ReportFraming,
  type ReportSection,
  type ResearchJob,
  type ResearchResult,
  type ResearchSourceTestResult,
  type ResearchSourceView,
  type ResultTransferDescriptor,
  type SearchResult,
  type SourceCallResult,
  type StartResearchInput,
  type ToolSettings,
} from "../types";

interface SettingsResponse {
  settings?: ToolSettings;
}

interface JobResponse {
  job?: ResearchJob | null;
}

interface SourceListResponse {
  sources?: ResearchSourceView[];
}

interface SourceResponse {
  source?: ResearchSourceView;
}

interface SourceTestResponse {
  test?: ResearchSourceTestResult;
  test_transfer?: ResultTransferDescriptor;
}

interface CallSourceResponse extends JobResponse {
  source_call?: SourceCallResult;
}

interface ContextResponse extends JobResponse {
  selected_context?: string;
  selected_sources?: SearchResult[];
  source_urls?: string[];
  context_transfer?: ResultTransferDescriptor;
}

interface ResultResponse extends JobResponse {
  result?: ResearchResult;
}

interface TransferResponse {
  transfer?: ResultTransferDescriptor;
}

export interface ResearchApi {
  getSettings(): Promise<ToolSettings>;
  updateSettings(input: { tavily_api_key?: string; clear_tavily_api_key?: boolean }): Promise<ToolSettings>;
  listResearchSources(): Promise<ResearchSourceView[]>;
  updateResearchSourceCredential(input: { id: string; credential?: string; clear?: boolean }): Promise<ResearchSourceView>;
  setResearchSourceEnabled(input: { id: string; enabled: boolean }): Promise<ResearchSourceView>;
  upsertResearchSource(input: { definition: Record<string, unknown>; credential?: string }): Promise<ResearchSourceView>;
  deleteResearchSource(input: { id: string }): Promise<{ id: string; deleted: boolean }>;
  testResearchSource(input: { id: string; definition: Record<string, unknown>; query: string }): Promise<ResearchSourceTestResult>;
  createResearchJob(input: StartResearchInput): Promise<ResearchJob>;
  updateResearchJob(researchId: string, updates: Record<string, unknown>): Promise<ResearchJob>;
  getResearchJob(researchId?: string): Promise<ResearchJob | null>;
  callResearchSource(input: {
    research_id: string;
    iteration: number;
    source_id: string;
    queries: string[];
  }): Promise<CallSourceResponse>;
  saveConfirmedResearchRole(researchId: string, role: ConfirmedResearchRole): Promise<ResearchJob>;
  saveConfirmedResearchFocuses(researchId: string, focuses: string[]): Promise<ResearchJob>;
  saveConfirmedResearchOutline(researchId: string, sections: ReportSection[]): Promise<ResearchJob>;
  callSectionResearchSource(input: {
    research_id: string;
    section_id: string;
    iteration: number;
    source_id: string;
    queries: string[];
  }): Promise<CallSourceResponse>;
  selectSectionContext(input: { research_id: string; section_id: string }): Promise<ContextResponse>;
  saveSectionResult(input: {
    research_id: string;
    section_id: string;
    section_markdown: string;
    section_summary: string;
    source_urls?: string[];
    status?: string;
    error?: unknown;
  }): Promise<ResearchJob>;
  failSection(input: { research_id: string; section_id: string; error: unknown }): Promise<ResearchJob>;
  saveReportFraming(input: { research_id: string; framing: ReportFraming }): Promise<ResearchJob>;
  saveAssembledResearchResult(input: { research_id: string; report_markdown: string; source_urls?: string[] }): Promise<ResearchJob>;
  selectContext(input: {
    research_id: string;
    search_queries?: string[];
    search_results?: SearchResult[];
  }): Promise<ContextResponse>;
  saveResearchResult(input: { research_id: string }): Promise<ResultTransferDescriptor>;
  uploadResearchResult(
    transfer: ResultTransferDescriptor,
    input: { report_markdown: string; source_urls?: string[] },
  ): Promise<ResultResponse>;
  complete(messages: AnnaRuntimeApi["llm"]["complete"] extends (request: infer Req) => unknown ? Req : never): ReturnType<
    AnnaRuntimeApi["llm"]["complete"]
  >;
}

export class AnnaResearchApi implements ResearchApi {
  constructor(private readonly anna: AnnaRuntimeApi) {}

  async getSettings(): Promise<ToolSettings> {
    const response = (await this.call("app_get_settings", {})) as SettingsResponse;
    if (!response.settings) throw new Error("Settings response did not include settings.");
    return response.settings;
  }

  async updateSettings(input: { tavily_api_key?: string; clear_tavily_api_key?: boolean }): Promise<ToolSettings> {
    const response = (await this.call("app_update_settings", input)) as SettingsResponse;
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
    if (response.test_transfer?.url) {
      const data = await fetchTransfer<SourceTestResponse>(response.test_transfer);
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

  async getResearchJob(researchId?: string): Promise<ResearchJob | null> {
    const response = (await this.call("app_get_research_job", researchId ? { research_id: researchId } : {})) as JobResponse;
    let job = response.job ?? null;
    const resultTransfer = job?.result_transfer;
    if (job?.job_transfer?.url) {
      const data = await fetchTransfer<JobResponse>(job.job_transfer);
      job = data.job ? { ...job, ...data.job } : job;
    }
    const transfer = job?.result_transfer ?? resultTransfer;
    if (!transfer) return job;
    const data = await fetchTransfer<ResultResponse>(transfer);
    return { ...job, result: data.result ?? job.result };
  }

  async callResearchSource(input: {
    research_id: string;
    iteration: number;
    source_id: string;
    queries: string[];
  }): Promise<CallSourceResponse> {
    return (await this.call("app_call_research_source", input)) as CallSourceResponse;
  }

  async saveConfirmedResearchRole(researchId: string, role: ConfirmedResearchRole): Promise<ResearchJob> {
    return requireJob(await this.call("app_save_confirmed_research_role", { research_id: researchId, role }));
  }

  async saveConfirmedResearchFocuses(researchId: string, focuses: string[]): Promise<ResearchJob> {
    return requireJob(await this.call("app_save_confirmed_research_focuses", { research_id: researchId, focuses }));
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
  }): Promise<CallSourceResponse> {
    return (await this.call("app_call_section_research_source", input)) as CallSourceResponse;
  }

  async selectSectionContext(input: { research_id: string; section_id: string }): Promise<ContextResponse> {
    const response = (await this.call("app_select_section_context", input)) as ContextResponse;
    if (!response.context_transfer?.url) return response;
    const context = await fetchTransfer<ContextResponse>(response.context_transfer);
    return { ...response, ...context, job: response.job };
  }

  async saveSectionResult(input: {
    research_id: string;
    section_id: string;
    section_markdown: string;
    section_summary: string;
    source_urls?: string[];
    status?: string;
    error?: unknown;
  }): Promise<ResearchJob> {
    const response = (await this.call("app_save_section_result", { research_id: input.research_id, section_id: input.section_id })) as TransferResponse;
    if (!response.transfer?.url) throw new Error("Section result save response did not include a transfer URL.");
    const data = await fetchTransfer<ResultResponse & { section_result?: unknown }>(response.transfer, input);
    return requireJob(data);
  }

  async failSection(input: { research_id: string; section_id: string; error: unknown }): Promise<ResearchJob> {
    return requireJob(await this.call("app_fail_section", input));
  }

  async saveReportFraming(input: { research_id: string; framing: ReportFraming }): Promise<ResearchJob> {
    const response = (await this.call("app_save_report_framing", { research_id: input.research_id })) as TransferResponse;
    if (!response.transfer?.url) throw new Error("Report framing save response did not include a transfer URL.");
    return requireJob(await fetchTransfer<JobResponse>(response.transfer, input));
  }

  async saveAssembledResearchResult(input: { research_id: string; report_markdown: string; source_urls?: string[] }): Promise<ResearchJob> {
    const response = (await this.call("app_save_assembled_research_result", { research_id: input.research_id })) as TransferResponse;
    if (!response.transfer?.url) throw new Error("Assembled result save response did not include a transfer URL.");
    const data = await fetchTransfer<ResultResponse>(response.transfer, input);
    const job = requireJob(data);
    return { ...job, result: data.result ?? job.result };
  }

  async selectContext(input: {
    research_id: string;
    search_queries?: string[];
    search_results?: SearchResult[];
  }): Promise<ContextResponse> {
    const response = (await this.call("app_select_context", input)) as ContextResponse;
    if (!response.context_transfer?.url) return response;
    const context = await fetchTransfer<ContextResponse>(response.context_transfer);
    return { ...response, ...context, job: response.job };
  }

  async saveResearchResult(input: { research_id: string }): Promise<ResultTransferDescriptor> {
    const response = (await this.call("app_save_research_result", input)) as TransferResponse;
    if (!response.transfer?.url) throw new Error("Save response did not include a result transfer URL.");
    return response.transfer;
  }

  async uploadResearchResult(transfer: ResultTransferDescriptor, input: { report_markdown: string; source_urls?: string[] }): Promise<ResultResponse> {
    return fetchTransfer<ResultResponse>(transfer, input);
  }

  complete(request: Parameters<AnnaRuntimeApi["llm"]["complete"]>[0]) {
    return this.anna.llm.complete(request);
  }

  private async call(method: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.anna.tools.invoke({ tool_id: TOOL_ID, method, args });
    const maybe = response as { success?: boolean; data?: unknown; error?: string };
    if (maybe && maybe.success === false) {
      const error = new Error(maybe.error || "Research tool invocation failed.") as Error & { details?: unknown };
      error.details = maybe.data;
      throw error;
    }
    return maybe && "data" in maybe ? maybe.data : response;
  }
}

async function fetchTransfer<T>(transfer: ResultTransferDescriptor, input?: unknown): Promise<T> {
  const method = transfer.method || (input === undefined ? "GET" : "POST");
  const init: RequestInit = { method };
  if (input !== undefined) {
    init.headers = { "Content-Type": transfer.content_type || "application/json" };
    init.body = JSON.stringify(input);
  }
  const response = await fetch(transfer.url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.error || `Research transfer failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return data as T;
}

export function createStandaloneApi(): ResearchApi {
  const fail = async () => {
    throw new Error("Anna runtime is not connected.");
  };
  return {
    getSettings: fail,
    updateSettings: fail,
    listResearchSources: fail,
    updateResearchSourceCredential: fail,
    setResearchSourceEnabled: fail,
    upsertResearchSource: fail,
    deleteResearchSource: fail,
    testResearchSource: fail,
    createResearchJob: fail,
    updateResearchJob: fail,
    getResearchJob: fail,
    callResearchSource: fail,
    saveConfirmedResearchRole: fail,
    saveConfirmedResearchFocuses: fail,
    saveConfirmedResearchOutline: fail,
    callSectionResearchSource: fail,
    selectSectionContext: fail,
    saveSectionResult: fail,
    failSection: fail,
    saveReportFraming: fail,
    saveAssembledResearchResult: fail,
    selectContext: fail,
    saveResearchResult: fail,
    uploadResearchResult: fail,
    complete: fail as ResearchApi["complete"],
  };
}

function requireJob(response: unknown): ResearchJob {
  const job = (response as JobResponse)?.job;
  if (!job) throw new Error("Research response did not include a job.");
  return job;
}

export type { IterationEntry };
