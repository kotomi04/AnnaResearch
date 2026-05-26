export const TOOL_ID = "tool-test-researcher-12345678";

export type ResearchStatus = "created" | "running" | "completed" | "failed" | "cancelled" | string;

export type ResearchStage =
  | "idle"
  | "select_role"
  | "plan_queries"
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
}

export interface ResearchJob {
  research_id?: string;
  status?: ResearchStatus;
  stage?: ResearchStage;
  progress?: number;
  query?: string;
  query_domains?: string[];
  agent_name?: string;
  agent_role_prompt?: string;
  search_queries?: string[];
  search_results?: SearchResult[];
  selected_context?: string;
  selected_sources?: SearchResult[];
  source_urls?: string[];
  source_count?: number;
  search_index?: number;
  search_total?: number;
  result?: ResearchResult | null;
  error?: ResearchError | null;
}

export interface ResearchResult {
  research_id?: string;
  report_type?: string;
  report_markdown?: string;
  source_urls?: string[];
  sources?: SearchResult[];
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StartResearchInput {
  query: string;
  query_domains: string[];
}

export interface ToolSettings {
  tavily: {
    configured: boolean;
    masked: string;
  };
}

export interface AnnaToolInvokeRequest {
  tool_id: string;
  method: string;
  args: Record<string, unknown>;
}

export interface AnnaToolsApi {
  invoke(request: AnnaToolInvokeRequest): Promise<unknown>;
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

export type ConnectionState = "connected" | "standalone";

export type ResearchPhase = "idle" | "settings_required" | "starting" | "running" | "loading_result" | "completed" | "failed";

