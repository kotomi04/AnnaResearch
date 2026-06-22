import type { MessageKey } from "../i18n/messages";
import type { ResearchJob } from "../types";

interface Props {
  jobs: ResearchJob[];
  latestJob: ResearchJob | null;
  canContinue: boolean;
  isBusy: boolean;
  message: string;
  workspacePath?: string;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
  onCreate(): void;
  onContinue(): void;
  onOpenLibrary(): void;
  onOpenTask(researchId: string): void;
}

export function TaskPickerPage({
  jobs,
  latestJob,
  canContinue,
  isBusy,
  message,
  workspacePath,
  t,
  onCreate,
  onContinue,
  onOpenLibrary,
  onOpenTask,
}: Props) {
  const recentJobs = jobs.slice(0, 6);

  return (
    <section className="page active task-picker-page" aria-label={t("taskPickerAria")}>
      <div className="task-picker-hero">
        <h2>{t("taskPickerTitle")}</h2>
        <p>{t("taskPickerWorkspaceLabel")}</p>
        {workspacePath ? <strong>{workspacePath}</strong> : null}
      </div>

      <div className="task-project-actions">
        <button type="button" className="task-project-card" onClick={onCreate} disabled={isBusy}>
          <span aria-hidden="true">+</span>
          <strong>{t("taskPickerCreateTitle")}</strong>
        </button>
        <button type="button" className="task-project-card" onClick={onOpenLibrary} disabled={isBusy}>
          <span aria-hidden="true">|||</span>
          <strong>{t("taskPickerLibraryTitle")}</strong>
        </button>
      </div>

      {message ? <p className="form-hint task-picker-message" data-error="true">{message}</p> : null}

      <section className="task-picker-recent" aria-label={t("taskPickerRecentLabel")}>
        <div className="task-picker-recent-head">
          <strong>{t("taskPickerRecentTitle")}</strong>
          <div className="task-picker-recent-actions">
            <button type="button" onClick={onContinue} disabled={isBusy || !canContinue}>
              {t("taskPickerContinueLatest")}
            </button>
            <button type="button" onClick={onOpenLibrary} disabled={isBusy}>
              {t("taskPickerViewAll")}
            </button>
          </div>
        </div>

        {recentJobs.length === 0 ? (
          <p className="task-picker-empty">{t("libraryEmpty")}</p>
        ) : (
          recentJobs.map((job) => {
            const researchId = job.research_id || "";
            return (
              <button
                key={researchId || taskTitle(job, t)}
                type="button"
                className="task-recent-row"
                onClick={() => researchId && onOpenTask(researchId)}
                disabled={isBusy || !researchId}
              >
                <span>
                  <strong>{taskTitle(job, t)}</strong>
                  <small>{formatDate(job.updated_at || job.created_at || "")}</small>
                </span>
                <em>{job.research_id || ""}</em>
              </button>
            );
          })
        )}
      </section>
    </section>
  );
}

function taskTitle(job: ResearchJob, t: Props["t"]) {
  const query = String(job.query || "").trim();
  if (!query) return String(job.research_id || t("libraryUntitledTask"));
  const firstLine = query.split("\n").map((line) => line.trim()).find(Boolean) || query;
  return firstLine.replace(/^研究主题：|^Research topic:\s*/i, "").slice(0, 90) || t("libraryUntitledTask");
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
