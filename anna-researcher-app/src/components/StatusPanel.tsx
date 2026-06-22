import type { MessageKey } from "../i18n/messages";
import { localizedJobMessage, localizedSourceCount, localizedStageMessage, localizedStatusLabel } from "../i18n/status";
import type { ResearchJob } from "../types";

function clampProgress(value: number | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

interface Props {
  job: ResearchJob | null;
  message: string;
  isError: boolean;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
}

export function StatusPanel({ job, message, isError, t }: Props) {
  if (!job && !message) return null;

  const status = job ? localizedStatusLabel(job.status, t) : t("idleStageLabel");
  const stage = job ? localizedStageMessage(job, t) : t("emptyMessage");
  const fallback = localizedJobMessage(job, t);
  const displayMessage = message || fallback.message;
  const statusText = [status, stage].filter(Boolean).join(" · ");

  return (
    <section className="status-band" aria-label={t("statusAria")}>
      <div className="status-line">
        <span id="stage-label">{statusText}</span>
        <span id="source-label">{localizedSourceCount(job?.source_count, t)}</span>
      </div>
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${clampProgress(job?.progress)}%` }} />
      </div>
      <p id="message" role="status" data-error={isError ? "true" : "false"}>
        {displayMessage}
      </p>
    </section>
  );
}
