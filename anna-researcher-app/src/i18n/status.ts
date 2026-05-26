import type { ResearchError, ResearchJob } from "../types";
import type { MessageKey } from "./messages";

export type Translator = (key: MessageKey, params?: Record<string, string | number | undefined>) => string;

const statusKeys: Record<string, MessageKey> = {
  created: "statusCreated",
  running: "statusRunning",
  completed: "statusCompleted",
  failed: "statusFailed",
  cancelled: "statusCancelled",
};

const errorCodeKeys: Record<string, MessageKey> = {
  missing_tavily_credential: "errorMissingTavily",
  tavily_missing_credential: "errorMissingTavily",
  sampling_error: "errorSamplingFailed",
  sampling_failed: "errorSamplingFailed",
  timeout: "errorSamplingFailed",
  retrieval_failed: "errorRetrievalFailed",
  retrieval_error: "errorRetrievalFailed",
  tool_failed: "errorToolFailed",
  not_ready: "errorNotReady",
  invalid_action: "errorInvalidAction",
};

export function localizedStatusLabel(status: string | undefined, t: Translator): string {
  if (!status) return t("statusUnknown");
  const key = statusKeys[status];
  return key ? t(key) : `${t("statusUnknown")} (${status})`;
}

export function localizedStageMessage(job: ResearchJob, t: Translator): string {
  const stage = job.stage || "idle";
  if (stage === "idle") return t("stageIdle");
  if (stage === "select_role") return t("stageSelectRole");
  if (stage === "plan_queries") return t("stagePlanQueries");
  if (stage === "search_next_query") {
    return t("stageSearchNextQuery", {
      current: job.search_index ?? 0,
      total: job.search_total ?? "?",
    });
  }
  if (stage === "select_context") return t("stageSelectContext");
  if (stage === "write_report") return t("stageWriteReport");
  if (stage === "completed") return t("stageCompleted");
  if (stage === "failed") return t("stageFailed");
  return `${t("stageUnknown")} (${stage})`;
}

export function localizedJobMessage(job: ResearchJob | null, t: Translator): { message: string; isError: boolean } {
  if (!job) return { message: t("emptyMessage"), isError: false };
  if (job.error) return { message: localizedError(job.error, t), isError: true };
  if (job.status === "completed") return { message: t("completedMessage"), isError: false };
  if (job.status === "failed") return { message: t("failedMessage"), isError: true };
  if (job.status === "cancelled") return { message: t("cancelledMessage"), isError: false };
  return { message: localizedStageMessage(job, t), isError: false };
}

export function localizedError(error: unknown, t: Translator): string {
  const normalized = normalizeError(error);
  const code = normalized.code || "";
  const known = errorCodeKeys[code];
  const userMessage = known ? t(known) : normalized.message || t("errorUnknown");
  if (known && normalized.message) {
    return `${userMessage} ${t("technicalDetails", { message: normalized.message })}`;
  }
  return userMessage;
}

export function localizedSourceCount(count: number | undefined, t: Translator): string {
  return t("sourceCount", { count: count ?? 0 });
}

function normalizeError(error: unknown): ResearchError {
  if (error instanceof Error) return { message: error.message };
  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const nested = typeof record.error === "object" && record.error ? (record.error as Record<string, unknown>) : undefined;
    return {
      code: String(record.code ?? nested?.code ?? ""),
      message: String(record.message ?? nested?.message ?? ""),
      details: record.details ?? nested?.details,
    };
  }
  return { message: String(error || "") };
}
