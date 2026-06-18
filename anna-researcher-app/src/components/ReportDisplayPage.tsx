import { useState } from "react";
import { exportResearchMarkdownFile } from "../export/exportFiles";
import type { MessageKey } from "../i18n/messages";
import type { ResearchResult } from "../types";
import type { RunEvent, SectionPreview } from "../workflow/runEvents";
import { ReportView } from "./ReportView";

interface Props {
  result: ResearchResult | null;
  events: RunEvent[];
  previews: SectionPreview[];
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
  onNewResearch(): void;
}

export function ReportDisplayPage({ result, events, previews, t, onNewResearch }: Props) {
  const markdown = result?.report_markdown || "";
  const [exportStatus, setExportStatus] = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  async function handleExportMarkdown() {
    if (!result?.report_markdown) return;
    setExportStatus("");
    try {
      await exportResearchMarkdownFile({ result, sourcesHeading: t("sourcesHeading") });
      setExportStatus(t("exportFileSaved", { format: "MD" }));
      setExportMenuOpen(false);
    } catch (error) {
      console.error("[anna-researcher] report export failed:", error);
      setExportStatus(t("exportFileFailed"));
    }
  }

  return (
    <section className="page active report-display-page" aria-label={t("reportPageTitle")}>
      <header className="guided-page-head">
        <div>
          <p className="step-pill">{t("stepReport")}</p>
          <h2>{t("reportPageTitle")}</h2>
          <p>{t("reportPageSubtitle")}</p>
        </div>
        <div className="report-actions">
          <div className="export-menu">
            <button
              type="button"
              className="secondary-action"
              aria-expanded={exportMenuOpen}
              onClick={() => setExportMenuOpen((open) => !open)}
              disabled={!markdown}
            >
              {t("exportButton")}
            </button>
            {exportMenuOpen ? (
              <div className="export-menu-list" role="menu" aria-label={t("exportMenuLabel")}>
                <button type="button" role="menuitem" onClick={handleExportMarkdown}>
                  {t("exportFormatOption", { format: "MD" })}
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="primary-action" onClick={onNewResearch}>
            {t("newResearchButton")}
          </button>
          {exportStatus ? <span className="export-status">{exportStatus}</span> : null}
        </div>
      </header>
      <ReportView result={result} t={t} />
      <details className="process-summary">
        <summary>{t("processSummaryTitle")}</summary>
        <div className="process-summary-grid">
          <section>
            <h3>{t("completedSectionsHeading")}</h3>
            {previews.length === 0 ? <p>{t("completedSectionsEmpty")}</p> : null}
            {previews.map((preview) => (
              <article key={preview.id}>
                <strong>{preview.title}</strong>
                <p>{preview.summary}</p>
              </article>
            ))}
          </section>
          <section>
            <h3>{t("runEventsHeading")}</h3>
            <ol>
              {events.map((event) => (
                <li key={event.id}>{event.title}: {event.detail}</li>
              ))}
            </ol>
          </section>
        </div>
      </details>
    </section>
  );
}
