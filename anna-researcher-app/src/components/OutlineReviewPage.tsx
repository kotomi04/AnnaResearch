import type { MessageKey } from "../i18n/messages";
import type { ReportSection, ResearchSourceView, SourceCurationMode } from "../types";
import { readySourceNameMap, sectionSourceNames, type PlanSummary } from "../workflow/planSummary";
import { PlanSummaryStrip } from "./PlanSummaryStrip";
import { RegenerationControl } from "./RegenerationControl";

interface Props {
  sections: ReportSection[];
  sources: ResearchSourceView[];
  instruction: string;
  summary: PlanSummary;
  isBusy: boolean;
  sourceCurationMode: SourceCurationMode;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
  onSectionChange(index: number, patch: Partial<ReportSection>): void;
  onAddSection(): void;
  onDeleteSection(index: number): void;
  onMoveSection(index: number, direction: -1 | 1): void;
  onToggleSectionSource(index: number, sourceId: string): void;
  onInstructionChange(value: string): void;
  onRegenerate(): void;
  onBack(): void;
  onStartGeneration(): void;
  onSourceCurationModeChange(mode: SourceCurationMode): void;
}

export function OutlineReviewPage(props: Props) {
  const readySources = props.sources.filter((source) => source.enabled && source.credential_status === "configured");
  const sourceNames = readySourceNameMap(props.sources);
  const confirmable = props.sections.length >= 1 && props.sections.length <= 8 && props.sections.every((section) =>
    section.title.trim() &&
    section.outline.trim() &&
    section.allowed_source_ids.length >= 1 &&
    section.max_iterations >= 1 &&
    section.max_iterations <= 10
  );

  return (
    <section className="page active guided-step-page" aria-label={props.t("outlinePageTitle")}>
      <header className="guided-page-head">
        <div>
          <p className="step-pill">{props.t("stepOutline")}</p>
          <h2>{props.t("outlinePageTitle")}</h2>
          <p>{props.t("outlinePageSubtitle")}</p>
        </div>
        <RegenerationControl
          label={props.t("regenerateOutlineButton")}
          value={props.instruction}
          t={props.t}
          disabled={props.isBusy}
          onChange={props.onInstructionChange}
          onRegenerate={props.onRegenerate}
        />
      </header>
      <PlanSummaryStrip summary={props.summary} t={props.t} compact />
      <section className="source-curation-option" aria-label={props.t("sourceCurationTitle")}>
        <div className="source-curation-copy">
          <strong>{props.t("sourceCurationTitle")}</strong>
          <small>{props.t("sourceCurationHint")}</small>
        </div>
        <label className="source-toggle compact-toggle" data-enabled={props.sourceCurationMode === "llm" ? "true" : "false"}>
          <input
            type="checkbox"
            checked={props.sourceCurationMode === "llm"}
            disabled={props.isBusy}
            onChange={(event) => props.onSourceCurationModeChange(event.target.checked ? "llm" : "off")}
            aria-label={props.t("sourceCurationLabel")}
          />
          <span className="source-toggle-track" aria-hidden="true">
            <span className="source-toggle-thumb" />
          </span>
          <span className="source-toggle-text">
            <strong>{props.t("sourceCurationLabel")}</strong>
          </span>
        </label>
      </section>
      <div className="outline-review-list">
        {props.sections.map((section, index) => (
          <article className="outline-review-card" key={section.id}>
            <div className="outline-card-main">
              <span className="outline-index">{index + 1}</span>
              <div>
                <h3>{section.title || props.t("untitledSection")}</h3>
                <p>{section.outline}</p>
                <div className="summary-chip-row">
                  {sectionSourceNames(section, sourceNames).map((name) => <span key={name}>{name}</span>)}
                  <span>{props.t("iterationChip", { count: section.max_iterations })}</span>
                </div>
              </div>
            </div>
            <details className="edit-details outline-edit">
              <summary>{props.t("editButton")}</summary>
              <label>
                {props.t("sectionTitleLabel")}
                <input value={section.title} onChange={(event) => props.onSectionChange(index, { title: event.target.value })} />
              </label>
              <label>
                {props.t("sectionOutlineLabel")}
                <textarea value={section.outline} onChange={(event) => props.onSectionChange(index, { outline: event.target.value })} />
              </label>
              <label>
                {props.t("sectionIterationsLabel")}
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={section.max_iterations}
                  onChange={(event) => props.onSectionChange(index, { max_iterations: Number(event.target.value) })}
                />
              </label>
              <div className="source-toggle-grid" aria-label={props.t("allowedSourcesLabel")}>
                {readySources.map((source) => (
                  <label className="checkbox-row" key={source.id}>
                    <input
                      type="checkbox"
                      checked={section.allowed_source_ids.includes(source.id)}
                      onChange={() => props.onToggleSectionSource(index, source.id)}
                    />
                    {source.name}
                  </label>
                ))}
              </div>
              <div className="outline-card-actions">
                <button type="button" className="secondary small-button" disabled={index === 0} onClick={() => props.onMoveSection(index, -1)}>
                  {props.t("moveUpButton")}
                </button>
                <button type="button" className="secondary small-button" disabled={index === props.sections.length - 1} onClick={() => props.onMoveSection(index, 1)}>
                  {props.t("moveDownButton")}
                </button>
                <button type="button" className="secondary small-button danger" disabled={props.sections.length <= 1} onClick={() => props.onDeleteSection(index)}>
                  {props.t("deleteSourceButton")}
                </button>
              </div>
            </details>
          </article>
        ))}
      </div>
      <footer className="guided-footer">
        <button type="button" className="secondary" onClick={props.onBack}>{props.t("backButton")}</button>
        <button type="button" className="secondary" onClick={props.onAddSection} disabled={props.sections.length >= 8}>{props.t("addSectionButton")}</button>
        <button type="button" className="primary-action" disabled={!confirmable || props.isBusy} onClick={props.onStartGeneration}>
          {props.t("startGenerationButton")}
        </button>
      </footer>
    </section>
  );
}
