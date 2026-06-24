export const TOOL_ID = "tool-test-researcher-12345678";

export type ResearchStatus = "created" | "running" | "completed" | "failed" | "cancelled" | string;

export type ResearchStage =
  | "idle"
  | "select_role"
  | "plan_queries"
  | "decide_next_action"
  | "search_next_query"
  | "select_context"
  | "write_report"
  | "completed"
  | "failed"
  | string;

export interface ResearchError {
  code?: string;
  message?: string;
  details?: unknown;
}

export interface SearchResult {
  query?: string;
  url: string;
  title?: string;
  content?: string;
  score?: number;
  source_id?: string;
  source_name?: string;
}

export type ResearchSourceErrorCode =
  | "auth_failed"
  | "rate_limited"
  | "upstream_5xx"
  | "timeout"
  | "bad_definition"
  | "empty_result";

export interface ResearchSourceView {
  id: string;
  name: string;
  kind: "builtin" | "user" | string;
  description?: string;
  enabled: boolean;
  max_parallel: number;
  credential_status: "missing" | "configured" | string;
  credential?: string;
  definition?: Record<string, unknown>;
}

export interface ResearchSourceTestPage {
  page: number;
  context?: Record<string, string>;
  request: Record<string, unknown>;
  response?: {
    status?: number;
    headers?: Record<string, string>;
    text?: string;
    json?: unknown;
  };
  extracted?: SearchResult[];
  next_cursor?: string;
}

export interface ResearchSourceTestResult {
  source_id: string;
  source_name: string;
  query: string;
  duration_ms: number;
  pages: ResearchSourceTestPage[];
  extracted: SearchResult[];
  error?: {
    code?: string;
    message?: string;
    detail?: unknown;
  } | null;
}

export interface SourceCallSummary {
  source_id: string;
  source_name: string;
  query: string;
  results_count: number;
  top_titles: string[];
  duration_ms: number;
  error: ResearchSourceErrorCode | null;
}

export interface SourceCallResult {
  source_id: string;
  source_name: string;
  queries: string[];
  results_count: number;
  top_titles: string[];
  duration_ms: number;
  error: ResearchSourceErrorCode | null;
  calls: SourceCallSummary[];
}

export interface IterationEntry {
  iteration: number;
  source_id: string;
  source_name: string;
  queries: string[];
  results_count: number;
  source_calls: SourceCallSummary[];
  appended_at?: string;
}

export interface ConfirmedResearchRole {
  server: string;
  agent_role_prompt: string;
}

export interface ReportSection {
  id: string;
  title: string;
  outline: string;
  allowed_source_ids: string[];
  max_iterations: number;
}

export interface SectionContext {
  selected_context?: string;
  selected_sources?: SearchResult[];
  source_urls: string[];
  selected_at?: string;
  selected_context_chars?: number;
  selected_sources_count?: number;
}

export interface SectionResult {
  section_id: string;
  status: string;
  section_markdown?: string;
  section_markdown_chars?: number;
  section_summary: string;
  source_urls: string[];
  error?: ResearchError | null;
  completed_at?: string | null;
  updated_at?: string;
}

export interface ReportFraming {
  title: string;
  introduction: string;
  conclusion: string;
  created_at?: string;
}

export interface ResearchJob {
  research_id?: string;
  status?: ResearchStatus;
  stage?: ResearchStage;
  progress?: number;
  query?: string;
  created_at?: string;
  updated_at?: string;
  agent_name?: string;
  agent_role_prompt?: string;
  search_queries?: string[];
  search_results?: SearchResult[];
  selected_context?: string;
  selected_sources?: SearchResult[];
  source_urls?: string[];
  source_count?: number;
  search_total?: number;
  result?: ResearchResult | null;
  error?: ResearchError | null;
  iterations?: IterationEntry[];
  research_log?: Array<{
    iteration: number;
    source_id: string;
    source_name: string;
    query: string;
    results_count: number;
    top_titles: string[];
    duration_ms: number;
    error: ResearchSourceErrorCode | null;
  }>;
  iteration?: number;
  max_iterations?: number;
  enabled_sources?: string[];
  schema_version?: number;
  workflow?: string;
  confirmed_role?: ConfirmedResearchRole | null;
  confirmed_focuses?: string[];
  confirmed_outline?: ReportSection[];
  active_section_index?: number | null;
  section_iterations?: Record<string, IterationEntry[]>;
  section_selected_context?: Record<string, SectionContext>;
  section_results?: Record<string, SectionResult>;
  report_framing?: ReportFraming | null;
  assembled_result?: Record<string, unknown> | null;
  job_transfer?: ResultTransferDescriptor;
  result_transfer?: ResultTransferDescriptor;
}

export interface ResearchResult {
  research_id?: string;
  report_type?: string;
  report_markdown?: string;
  report_markdown_chars?: number;
  source_urls?: string[];
  sources?: SearchResult[];
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ResultTransferDescriptor {
  method: "POST" | string;
  url: string;
  content_type?: string;
}

export interface StartResearchInput {
  query: string;
}

export interface ToolSettings {
  research_root?: string;
  tavily: {
    configured: boolean;
    masked: string;
  };
}

export interface AnnaToolInvokeRequest {
  tool_id: string;
  method: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
}

export interface AnnaToolsApi {
  invoke(request: AnnaToolInvokeRequest, options?: { timeoutMs?: number }): Promise<unknown>;
}

export interface AnnaLlmMessage {
  role: "system" | "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface AnnaLlmCompleteRequest {
  messages: AnnaLlmMessage[];
  systemPrompt?: string;
  temperature?: number;
}

export interface AnnaLlmCompleteResponse {
  role?: string;
  content?: { type?: string; text?: string } | string;
}

export interface AnnaLlmApi {
  complete(request: AnnaLlmCompleteRequest): Promise<AnnaLlmCompleteResponse>;
}

export interface AnnaRuntimeApi {
  tools: AnnaToolsApi;
  llm: AnnaLlmApi;
}

export interface AnnaRuntimeGlobal {
  connect(): Promise<AnnaRuntimeApi>;
}

export type ResearchPhase =
  | "idle"
  | "settings_required"
  | "starting"
  | "generating_roles"
  | "generating_focuses"
  | "generating_outline"
  | "role_review"
  | "focus_review"
  | "outline_review"
  | "running"
  | "loading_result"
  | "completed"
  | "failed";
