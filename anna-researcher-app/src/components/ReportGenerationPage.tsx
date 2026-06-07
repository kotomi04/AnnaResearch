import type { MessageKey } from "../i18n/messages";
import type { ResearchJob, ResearchSourceView } from "../types";
import { projectStoredRunEvents, type RunEvent, type SectionPreview } from "../workflow/runEvents";
import { readySourceNameMap, sectionSourceNames, type PlanSummary } from "../workflow/planSummary";
import { PlanSummaryStrip } from "./PlanSummaryStrip";

interface Props {
  job: ResearchJob | null;
  events: RunEvent[];
  previews: SectionPreview[];
  sources: ResearchSourceView[];
  summary: PlanSummary;
  message: string;
  isError: boolean;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
}

export function ReportGenerationPage({ job, events, previews, sources, summary, message, isError, t }: Props) {
  const sections = job?.confirmed_outline || [];
  const activeIndex = Number(job?.active_section_index ?? 0);
  const activeSection = sections[activeIndex] || sections[0];
  const sourceNames = readySourceNameMap(sources);
  const displayEvents = events.length ? events : projectStoredRunEvents(job);

  return (
    <section className="page active generation-page" aria-label={t("generationPageTitle")}>
      <header className="generation-hero">
        <div className="active-orbit" aria-hidden="true" />
        <div>
          <p className="step-pill">{t("stepGenerate")}</p>
          <h2>{t("generationPageTitle")}</h2>
          <p data-error={isError ? "true" : "false"}>{message || t("generationActiveMessage")}</p>
        </div>
        <div className="generation-count">
          {t("sectionProgressLabel", { current: Math.min(activeIndex + 1, Math.max(1, sections.length)), total: sections.length || 1 })}
        </div>
      </header>
      <PlanSummaryStrip summary={summary} t={t} compact />
      {activeSection ? (
        <section className="active-section-panel">
          <div>
            <span>{t("activeSectionLabel")}</span>
            <h3>{activeSection.title}</h3>
            <p>{activeSection.outline}</p>
          </div>
          <div className="summary-chip-row">
            {sectionSourceNames(activeSection, sourceNames).map((name) => <span key={name}>{name}</span>)}
            <span>{t("iterationChip", { count: activeSection.max_iterations })}</span>
          </div>
        </section>
      ) : null}
      <div className="generation-layout">
        <section className="event-stream" aria-label={t("runEventsHeading")}>
          <h3>{t("runEventsHeading")}</h3>
          {displayEvents.length === 0 ? <p className="timeline-empty">{t("runEventsEmpty")}</p> : null}
          <ol>
            {displayEvents.map((event) => (
              <li key={event.id} data-kind={event.kind} data-error={event.error ? "true" : "false"}>
                <span className="event-dot" />
                <div>
                  <strong>{localizedRunEventTitle(event, t)}</strong>
                  <p>{event.detail}</p>
                  {event.error ? <p className="timeline-error">{t("timelineErrorPrefix", { message: event.error })}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="section-preview-list" aria-label={t("completedSectionsHeading")}>
          <h3>{t("completedSectionsHeading")}</h3>
          {previews.length === 0 ? <p className="timeline-empty">{t("completedSectionsEmpty")}</p> : null}
          {previews.map((preview) => (
            <details key={preview.id} className="section-preview">
              <summary>
                <strong>{preview.title}</strong>
                <span>{t("sourceCount", { count: preview.sourceCount })}</span>
              </summary>
              <p>{preview.summary}</p>
              {preview.markdown ? <pre>{preview.markdown}</pre> : null}
            </details>
          ))}
        </section>
      </div>
    </section>
  );
}

function localizedRunEventTitle(event: RunEvent, t: Props["t"]): string {
  const keys: Record<RunEvent["kind"], MessageKey> = {
    section_started: "eventSectionStarted",
    decision: "eventDecision",
    source_call: "eventSourceCall",
    context_selected: "eventContextSelected",
    section_written: "eventSectionWritten",
    report_framing: "eventReportFraming",
    final_assembly: "eventFinalAssembly",
  };
  if (event.kind === "source_call") return event.title;
  return t(keys[event.kind]);
}
