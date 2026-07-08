import { useRef } from "react";
import type { MessageKey } from "../i18n/messages";
import type { ResearchAttachment } from "../types";

interface Props {
  isBusy: boolean;
  canStart: boolean;
  briefName: string;
  researchNeed: string;
  attachments?: File[];
  uploadedAttachments?: ResearchAttachment[];
  t(key: MessageKey): string;
  stepLabel: string;
  validationMessage: string;
  canShowLastResult: boolean;
  onOpenLibrary(): void;
  onBriefNameChange(value: string): void;
  onResearchNeedChange(value: string): void;
  onAttachmentAdd?(files: File[]): void;
  onAttachmentRemove?(index: number): void;
  onShowLastResult(): void;
  onStart(input: { briefName: string; researchNeed: string }): void;
  onValidationError(message: string): void;
}

export function ResearchForm({
  isBusy,
  canStart,
  briefName,
  researchNeed,
  attachments = [],
  uploadedAttachments = [],
  t,
  stepLabel,
  validationMessage,
  canShowLastResult,
  onOpenLibrary,
  onBriefNameChange,
  onResearchNeedChange,
  onAttachmentAdd,
  onAttachmentRemove,
  onShowLastResult,
  onStart,
  onValidationError,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function submit() {
    const trimmedNeed = researchNeed.trim();
    if (!trimmedNeed) {
      onValidationError(t("enterQueryError"));
      return;
    }
    onStart({ briefName: briefName.trim(), researchNeed: trimmedNeed });
  }

  function selectFiles(files: FileList | null) {
    const next = Array.from(files || []);
    if (next.length) onAttachmentAdd?.(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
        <div className="research-need-box">
          <textarea
            id="research-need-input"
            rows={5}
            placeholder={t("researchNeedPlaceholder")}
            value={researchNeed}
            onChange={(event) => onResearchNeedChange(event.target.value)}
          />
          <button
            type="button"
            className="attachment-add-button"
            aria-label={t("attachmentAdd")}
            title={t("attachmentAdd")}
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
          >
            +
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            multiple
            onChange={(event) => selectFiles(event.target.files)}
          />
        </div>
        {attachments.length || uploadedAttachments.length ? (
          <div className="attachment-list" aria-label={t("attachmentList")}>
            {uploadedAttachments.map((file, index) => (
              <span className="attachment-chip" key={`${file.path || file.name}-${index}`}>
                <span>{file.name}</span>
                <small>{file.size_bytes != null ? formatFileSize(file.size_bytes) : t("attachmentUploaded")}</small>
              </span>
            ))}
            {attachments.map((file, index) => (
              <span className="attachment-chip" key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                <span>{file.name}</span>
                <small>{formatFileSize(file.size)}</small>
                <button type="button" aria-label={t("attachmentRemove")} onClick={() => onAttachmentRemove?.(index)} disabled={isBusy}>
                  x
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <p className="helper-text">{t("researchHelperText")}</p>
      </div>
      {validationMessage ? <p className="form-hint" data-error="true">{validationMessage}</p> : null}
      {!canStart ? <p className="form-hint" data-error="true">{t("settingsMissing")}</p> : null}
    </section>
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
