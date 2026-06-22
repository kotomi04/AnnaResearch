import type { MessageKey } from "../i18n/messages";

interface Props {
  isBusy: boolean;
  canStart: boolean;
  briefName: string;
  researchNeed: string;
  t(key: MessageKey): string;
  stepLabel: string;
  validationMessage: string;
  canShowLastResult: boolean;
  onOpenLibrary(): void;
  onBriefNameChange(value: string): void;
  onResearchNeedChange(value: string): void;
  onShowLastResult(): void;
  onStart(input: { briefName: string; researchNeed: string }): void;
  onValidationError(message: string): void;
}

export function ResearchForm({
  isBusy,
  canStart,
  briefName,
  researchNeed,
  t,
  stepLabel,
  validationMessage,
  canShowLastResult,
  onOpenLibrary,
  onBriefNameChange,
  onResearchNeedChange,
  onShowLastResult,
  onStart,
  onValidationError,
}: Props) {
  function submit() {
    const trimmedNeed = researchNeed.trim();
    if (!trimmedNeed) {
      onValidationError(t("enterQueryError"));
      return;
    }
    onStart({ briefName: briefName.trim(), researchNeed: trimmedNeed });
  }

  return (
    <section className="page intro-page active" aria-label={t("researchInputAria")}>
      <div className="page-title-row">
        <div className="section-head">
          <span className="step-pill">{stepLabel}</span>
          <h2>{t("researchQuestionHeading")}</h2>
        </div>
        <div className="intro-actions">
          <button type="button" className="secondary" onClick={onOpenLibrary} disabled={isBusy}>
            {t("libraryButton")}
          </button>
          <button type="button" className="secondary" onClick={onShowLastResult} disabled={!canShowLastResult}>
            {t("viewLastResultButton")}
          </button>
          <button type="button" className="primary" onClick={submit} disabled={isBusy || !canStart}>
            {isBusy ? t("startButtonBusy") : t("startButton")}
          </button>
        </div>
      </div>
      <div className="field-stack">
        <label htmlFor="brief-name-input">{t("briefNameLabel")}</label>
        <input
          id="brief-name-input"
          type="text"
          placeholder={t("briefNamePlaceholder")}
          value={briefName}
          onChange={(event) => onBriefNameChange(event.target.value)}
        />
      </div>
      <div className="field-stack">
        <label htmlFor="research-need-input">{t("researchNeedLabel")}</label>
        <textarea
          id="research-need-input"
          rows={5}
          placeholder={t("researchNeedPlaceholder")}
          value={researchNeed}
          onChange={(event) => onResearchNeedChange(event.target.value)}
        />
        <p className="helper-text">{t("researchHelperText")}</p>
      </div>
      {validationMessage ? <p className="form-hint" data-error="true">{validationMessage}</p> : null}
      {!canStart ? <p className="form-hint" data-error="true">{t("settingsMissing")}</p> : null}
    </section>
  );
}
