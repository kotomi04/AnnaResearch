import type { FocusCandidate } from "../hooks/useResearchJob";
import type { MessageKey } from "../i18n/messages";
import type { PlanSummary } from "../workflow/planSummary";
import { PlanSummaryStrip } from "./PlanSummaryStrip";
import { RegenerationControl } from "./RegenerationControl";

interface Props {
  candidates: FocusCandidate[];
  selectedIds: string[];
  instruction: string;
  summary: PlanSummary;
  isBusy: boolean;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
  onSelectedIdsChange(ids: string[]): void;
  onCandidateChange(index: number, patch: Partial<FocusCandidate>): void;
  onInstructionChange(value: string): void;
  onRegenerate(): void;
  onBack(): void;
  onConfirm(): void;
}

export function FocusReviewPage(props: Props) {
  function toggle(id: string) {
    const selected = props.selectedIds.includes(id);
    const next = selected ? props.selectedIds.filter((item) => item !== id) : [...props.selectedIds, id].slice(0, 5);
    props.onSelectedIdsChange(next);
  }

  return (
    <section className="page active guided-step-page" aria-label={props.t("focusPageTitle")}>
      <header className="guided-page-head">
        <div>
          <p className="step-pill">{props.t("stepFocus")}</p>
          <h2>{props.t("focusPageTitle")}</h2>
          <p>{props.t("focusPageSubtitle")}</p>
        </div>
        <RegenerationControl
          label={props.t("regenerateFocusesButton")}
          value={props.instruction}
          t={props.t}
          disabled={props.isBusy}
          onChange={props.onInstructionChange}
          onRegenerate={props.onRegenerate}
        />
      </header>
      <PlanSummaryStrip summary={props.summary} t={props.t} compact />
      <div className="review-card-grid">
        {props.candidates.map((candidate, index) => {
          const selected = props.selectedIds.includes(candidate.id);
          return (
            <article className="review-card" data-selected={selected ? "true" : "false"} key={candidate.id}>
              <button type="button" className="review-card-selector" onClick={() => toggle(candidate.id)}>
                <span className="select-dot" />
                <strong>{candidate.text}</strong>
              </button>
              {candidate.rationale ? <p>{candidate.rationale}</p> : null}
              <details className="edit-details">
                <summary>{props.t("editButton")}</summary>
                <label>
                  {props.t("focusTextLabel")}
                  <textarea value={candidate.text} onChange={(event) => props.onCandidateChange(index, { text: event.target.value })} />
                </label>
              </details>
            </article>
          );
        })}
      </div>
      <footer className="guided-footer">
        <button type="button" className="secondary" onClick={props.onBack}>{props.t("backButton")}</button>
        <span className="selection-count">{props.t("focusSelectionCount", { count: props.selectedIds.length })}</span>
        <button type="button" className="primary-action" disabled={props.selectedIds.length < 1 || props.selectedIds.length > 5 || props.isBusy} onClick={props.onConfirm}>
          {props.t("confirmFocusesButton")}
        </button>
      </footer>
    </section>
  );
}
