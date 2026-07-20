declare global {
  interface Window {
    __ANNA_TOOL_IDS__?: Record<string, string>;
  }
}

export const TOOL_ID = "tool-xhz-researcher-python-e7k8xa3s";

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
  icon?: string;
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
  skipped_queries?: string[];
  results_count: number;
  top_titles: string[];
  duration_ms: number;
  error: ResearchSourceErrorCode | null;
  calls: SourceCallSummary[];
}

export interface SectionResearchDecision {
  type: "call_source" | "finish";
  knowledge_gap?: string;
  rationale?: string;
  target_facet_ids?: string[];
}

export interface IterationEntry {
  iteration: number;
  source_id: string;
  source_name: string;
  queries: string[];
  results_count: number;
  source_calls: SourceCallSummary[];
  research_decision?: SectionResearchDecision | null;
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
  facet_ids?: string[];
  allowed_source_ids: string[];
  max_iterations: number;
}

export type SourceCurationMode = "off" | "llm";

export interface ResearchOptions {
  source_curation_mode?: SourceCurationMode;
  source_curation_version?: string;
}

export interface SectionContext {
  selected_context?: string;
  selected_sources?: SearchResult[];
  source_urls?: string[];
  citation_sources?: CitationSource[];
  source_count?: number;
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
  subsection_headers?: string[];
  source_urls?: string[];
  source_count?: number;
  citation_sources?: CitationSource[];
  citation_source_count?: number;
  attachment_citation_count?: number;
  url_citation_count?: number;
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

export interface ResearchAttachment {
  name: string;
  path: string;
  content_type?: string;
  size_bytes?: number;
  etag?: string;
  uploaded_at?: string;
}

export interface AttachmentPrepareInput {
  name: string;
  path: string;
  content_type?: string;
  size_bytes?: number;
  download_url: string;
  image_analysis?: AttachmentImageAnalysis;
  image_analysis_error?: string;
}

export interface AttachmentImageAnalysis {
  image_type?: string;
  summary: string;
  detailed_description?: string;
  visible_text?: unknown;
  key_observations?: unknown;
  chart_or_table?: unknown;
  research_relevance?: unknown;
  uncertainties?: string[];
  extraction_limits?: string[];
  raw_text?: string;
}

export interface AttachmentContextFile {
  id: string;
  name: string;
  path?: string;
  local_path?: string;
  content_type?: string;
  size_bytes?: number;
  text_chars?: number;
  chunk_count?: number;
  status: "ready" | "failed";
  error?: string | null;
  analysis?: AttachmentFileAnalysis;
}

export interface AttachmentFileAnalysis {
  type: "text" | "image" | string;
  source: "summary_llm" | "analyze_image" | string;
  summary?: string;
  key_points?: string[];
  relevance?: string;
  relevance_score?: number | null;
  selected_chunk_ids?: string[];
  payload?: unknown;
}

export interface AttachmentContextChunk {
  chunk_id: string;
  file_id: string;
  file_name: string;
  path?: string;
  content_type?: string;
  index: number;
  text: string;
  embedding?: number[];
  embedding_model?: string;
  embedding_dimensions?: number;
}

export interface AttachmentContext {
  version: number;
  prepared_at: string;
  files: AttachmentContextFile[];
  chunks: AttachmentContextChunk[];
  summary: string;
  embedding_model?: string;
  embedding_batch_size?: number;
  embedding_status?: "ready" | "partial" | "failed";
  summary_status?: "ready" | "partial" | "failed";
  summary_mode?: string;
  summary_query?: string;
  summary_top_k?: number;
  summary_generated_at?: string;
}

export interface EmbedTextsResponse {
  count: number;
  dimensions: number;
  vectors: number[][];
  first_vector_preview?: number[];
  model?: string;
  usage?: unknown;
  _meta?: Record<string, unknown>;
}

export type CitationSource =
  | {
      kind: "url";
      url: string;
      title?: string;
      icon?: string;
      content?: string;
    }
  | {
      kind: "attachment";
      file_id: string;
      file_name: string;
      path?: string;
      content_type?: string;
      chunk_id?: string;
      index?: number;
      quote?: string;
    };

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
  confirmed_outline?: ReportSection[];
  research_options?: ResearchOptions;
  section_source_curations?: Record<string, unknown>;
  outline_discovery?: {
    status?: string;
    facets?: Array<{ id: string; task: string }>;
    query_count?: number;
    facet_count?: number;
    result_count?: number;
    selected_source_count?: number;
    updated_at?: string;
  } | null;
  active_section_index?: number | null;
  section_iterations?: Record<string, IterationEntry[]>;
  section_selected_context?: Record<string, SectionContext>;
  section_results?: Record<string, SectionResult>;
  report_framing?: ReportFraming | null;
  assembled_result?: Record<string, unknown> | null;
  attachments?: ResearchAttachment[];
  attachment_context?: AttachmentContext | null;
}

export interface ResearchResult {
  research_id?: string;
  report_type?: string;
  report_markdown?: string;
  report_markdown_chars?: number;
  source_urls?: string[];
  citation_sources?: CitationSource[];
  sources?: SearchResult[];
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ApsTransferDescriptor {
  path: string;
  content_type: "application/json";
  size_bytes: number;
  etag?: string;
  sha256: string;
  delete_after_read: true;
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

export interface AnnaFilesUploadInitRequest {
  path: string;
  content_type: string;
  size: number;
}

export interface AnnaFilesUploadInitResponse {
  put_url: string;
  headers?: Record<string, string>;
  upload_id?: string;
}

export interface AnnaFilesUploadFinalizeRequest {
  path: string;
  etag: string;
  size_bytes: number;
}

export interface AnnaFilesUploadFinalizeResponse {
  path?: string;
  size_bytes?: number;
  etag?: string;
}

export interface AnnaFilesDownloadUrlResponse {
  get_url?: string;
  url?: string;
  expires_at?: string;
}

export interface AnnaFilesListItem {
  path: string;
  size_bytes?: number;
  content_type?: string;
  updated_at?: string;
}

export interface AnnaFilesListResponse {
  items?: AnnaFilesListItem[];
  next_cursor?: string | null;
}

export interface AnnaFilesApi {
  upload_init(request: AnnaFilesUploadInitRequest): Promise<AnnaFilesUploadInitResponse>;
  upload_finalize(request: AnnaFilesUploadFinalizeRequest): Promise<AnnaFilesUploadFinalizeResponse>;
  download_url(request: { path: string }): Promise<AnnaFilesDownloadUrlResponse>;
  list(request: { prefix: string; cursor?: string | null }): Promise<AnnaFilesListResponse>;
  delete?(request: { path: string }): Promise<unknown>;
}

export interface AnnaAgentRunFrame {
  event?: string;
  text?: string;
  delta?: unknown;
  content?: unknown;
  output_text?: string;
  message?: string | {
    content?: unknown;
  };
  payload?: unknown;
  frames?: AnnaAgentRunFrame[];
  choices?: Array<{
    delta?: {
      content?: string;
      text?: string;
      task_complete?: { token_usage?: unknown };
    };
    message?: {
      content?: unknown;
    };
  }>;
  [key: string]: unknown;
}

export interface AnnaAgentSession {
  appSessionUuid?: string;
  grantedTools?: string[];
  granted_tools?: string[];
  run(input: { content: string; recursion_limit?: number }): AsyncIterable<AnnaAgentRunFrame>;
  delete(): Promise<unknown>;
}

export interface AnnaAgentApi {
  session(input: { submode: "auto" }): Promise<AnnaAgentSession>;
}

export interface AnnaRuntimeApi {
  tools: AnnaToolsApi;
  llm: AnnaLlmApi;
  files?: AnnaFilesApi;
  agent?: AnnaAgentApi;
}

export interface AnnaRuntimeGlobal {
  connect(): Promise<AnnaRuntimeApi>;
}

export type ResearchPhase =
  | "idle"
  | "settings_required"
  | "starting"
  | "generating_roles"
  | "generating_outline"
  | "role_review"
  | "outline_review"
  | "running"
  | "loading_result"
  | "completed"
  | "failed";
