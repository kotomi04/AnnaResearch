import type { MessageKey } from "../i18n/messages";
import type { ResearchJob } from "../types";

interface Props {
  jobs: ResearchJob[];
  currentJob: ResearchJob | null;
  isBusy: boolean;
  errorMessage?: string;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
  onBack(): void;
  onCreate(): void;
  onOpen(researchId: string): void;
}

export function ResearchLibraryPage({ jobs, currentJob, isBusy, errorMessage, t, onBack, onCreate, onOpen }: Props) {
  return (
    <section className="page active library-page" aria-label={t("libraryPageTitle")}>
      <header className="guided-page-head">
        <div>
          <p className="step-pill">{t("libraryEyebrow")}</p>
          <h2>{t("libraryPageTitle")}</h2>
          <p>{t("libraryPageSubtitle")}</p>
        </div>
        <div className="report-actions">
          <button type="button" className="secondary-action" onClick={onBack}>
            {t("backButton")}
          </button>
          <button type="button" className="primary-action" onClick={onCreate} disabled={isBusy}>
            {t("newResearchButton")}
          </button>
        </div>
      </header>
      {errorMessage ? <p className="form-hint" data-error="true">{errorMessage}</p> : null}

      <div className="library-layout">
        <section className="library-current">
          <span className="library-section-label">{t("libraryCurrentTask")}</span>
          {currentJob ? (
            <div>
              <strong>{displayTitle(currentJob, t)}</strong>
              <span>{currentJob.research_id}</span>
            </div>
          ) : (
            <p>{t("libraryNoCurrentTask")}</p>
          )}
        </section>

        <section className="library-list" aria-label={t("libraryTaskListLabel")}>
          {jobs.length === 0 ? (
            <div className="library-empty">{t("libraryEmpty")}</div>
          ) : (
            jobs.map((job) => {
              const researchId = job.research_id || "";
              return (
                <article className="library-row" key={researchId || displayTitle(job, t)}>
                  <button type="button" onClick={() => researchId && onOpen(researchId)} disabled={isBusy || !researchId}>
                    <strong>{displayTitle(job, t)}</strong>
                    <span>{formatDate(job.updated_at || job.created_at || "")}</span>
                  </button>
                  <button type="button" className="primary-action compact" onClick={() => researchId && onOpen(researchId)} disabled={isBusy || !researchId}>
                    {t("libraryOpenTask")}
                  </button>
                </article>
              );
            })
          )}
        </section>
      </div>
    </section>
  );
}

function displayTitle(job: ResearchJob, t: Props["t"]) {
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
