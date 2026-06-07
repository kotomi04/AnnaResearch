import type { RoleCandidate } from "../hooks/useResearchJob";
import type { MessageKey } from "../i18n/messages";
import { RegenerationControl } from "./RegenerationControl";

interface Props {
  candidates: RoleCandidate[];
  selectedIndex: number;
  instruction: string;
  isBusy: boolean;
  t(key: MessageKey): string;
  onSelectedIndexChange(index: number): void;
  onCandidateChange(index: number, patch: Partial<RoleCandidate>): void;
  onInstructionChange(value: string): void;
  onRegenerate(): void;
  onBack(): void;
  onConfirm(): void;
}

export function RoleReviewPage({
  candidates,
  selectedIndex,
  instruction,
  isBusy,
  t,
  onSelectedIndexChange,
  onCandidateChange,
  onInstructionChange,
  onRegenerate,
  onBack,
  onConfirm,
}: Props) {
  const selected = candidates[selectedIndex];
  return (
    <section className="page active guided-step-page" aria-label={t("rolePageTitle")}>
      <header className="guided-page-head">
        <div>
          <p className="step-pill">{t("stepRole")}</p>
          <h2>{t("rolePageTitle")}</h2>
          <p>{t("rolePageSubtitle")}</p>
        </div>
        <RegenerationControl
          label={t("regenerateRolesButton")}
          value={instruction}
          t={t}
          disabled={isBusy}
          onChange={onInstructionChange}
          onRegenerate={onRegenerate}
        />
      </header>
      <div className="review-card-grid">
        {candidates.map((candidate, index) => (
          <article className="review-card" data-selected={index === selectedIndex ? "true" : "false"} key={`${candidate.server}-${index}`}>
            <button type="button" className="review-card-selector" onClick={() => onSelectedIndexChange(index)}>
              <span className="select-dot" />
              <strong>{candidate.server}</strong>
            </button>
            <p>{candidate.rationale || t("roleFallbackRationale")}</p>
            <details className="edit-details">
              <summary>{t("editButton")}</summary>
              <label>
                {t("roleNameLabel")}
                <input value={candidate.server} onChange={(event) => onCandidateChange(index, { server: event.target.value })} />
              </label>
              <label>
                {t("rolePromptLabel")}
                <textarea value={candidate.agent_role_prompt} onChange={(event) => onCandidateChange(index, { agent_role_prompt: event.target.value })} />
              </label>
            </details>
          </article>
        ))}
      </div>
      <footer className="guided-footer">
        <button type="button" className="secondary" onClick={onBack}>{t("backButton")}</button>
        <button type="button" className="primary-action" disabled={!selected?.server || !selected?.agent_role_prompt || isBusy} onClick={onConfirm}>
          {t("confirmRoleButton")}
        </button>
      </footer>
    </section>
  );
}
