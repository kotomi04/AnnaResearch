import { useEffect, useState } from "react";
import type { MessageKey } from "../i18n/messages";
import type { ResearchSourceTestResult, ResearchSourceView } from "../types";

interface SharedProps {
  isBusy: boolean;
  t(key: MessageKey): string;
}

interface ListProps extends SharedProps {
  sources: ResearchSourceView[];
  errorMessage?: string;
  onBack(): void;
  onAdd(): void;
  onOpenSource(id: string): void;
  onToggleEnabled(input: { id: string; enabled: boolean }): Promise<unknown>;
}

interface DetailProps extends SharedProps {
  source: ResearchSourceView | null;
  onBack(): void;
  onSaveCredential(input: { id: string; credential?: string; clear?: boolean }): Promise<unknown>;
  onToggleEnabled(input: { id: string; enabled: boolean }): Promise<unknown>;
  onSaveDefinition(input: { definition: Record<string, unknown> }): Promise<ResearchSourceView | unknown>;
  onDeleteSource(input: { id: string }): Promise<unknown>;
  onTestSource(input: { id: string; definition: Record<string, unknown>; query: string }): Promise<ResearchSourceTestResult>;
}

interface NewProps extends SharedProps {
  onBack(): void;
  onAddSource(input: { definition: Record<string, unknown>; credential?: string }): Promise<unknown>;
}

type Feedback = { kind: "ok" | "error"; text: string } | null;

function SourceSwitch({
  source,
  isBusy,
  t,
  onToggle,
}: {
  source: ResearchSourceView;
  isBusy: boolean;
  t(key: MessageKey): string;
  onToggle(): void;
}) {
  const stateLabel = source.enabled ? t("sourceEnabledLabel") : t("sourceDisabledLabel");
  return (
    <label className="source-toggle compact-toggle" data-enabled={source.enabled ? "true" : "false"}>
      <input
        type="checkbox"
        checked={source.enabled}
        disabled={isBusy}
        onChange={onToggle}
        aria-label={`${source.name} ${stateLabel}`}
      />
      <span className="source-toggle-track" aria-hidden="true">
        <span className="source-toggle-thumb" />
      </span>
      <span className="source-toggle-text">{stateLabel}</span>
    </label>
  );
}

export function ResearchSourceListPage({ sources, isBusy, errorMessage, t, onBack, onAdd, onOpenSource, onToggleEnabled }: ListProps) {
  return (
    <section className="page active source-page" aria-label={t("sourcePanelTitle")}>
      <div className="source-page-head">
        <div>
          <button type="button" className="secondary small-button" onClick={onBack}>
            {t("backButton")}
          </button>
          <h2>{t("sourceListTitle")}</h2>
        </div>
        <button type="button" className="primary-action" onClick={onAdd} disabled={isBusy}>
          {t("addSourceButton")}
        </button>
      </div>
      {errorMessage ? (
        <p className="feedback-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <ul className="source-list page-source-list">
        {sources.length === 0 ? <li className="source-empty">{t("sourceListEmpty")}</li> : null}
        {sources.map((source) => {
          const configured = source.credential_status === "configured";
          const isBuiltin = source.kind === "builtin";
          const requiresCredential = sourceRequiresCredential(source);
          return (
            <li key={source.id} className="source-row" data-source-id={source.id}>
              <button type="button" className="source-card-button" onClick={() => onOpenSource(source.id)}>
                <div className="source-row-head">
                  <div>
                    <span className="source-name">{source.name}</span>
                    <span className="source-kind">{isBuiltin ? t("sourceKindBuiltin") : t("sourceKindUser")}</span>
                  </div>
                </div>
                {source.description ? <p className="source-description">{source.description}</p> : null}
                <div className="source-meta-row">
                  <span data-configured={configured ? "true" : "false"}>
                    {requiresCredential ? (configured ? maskCredential(source.credential || "") : t("sourceCredentialMissing")) : source.enabled ? t("sourceEnabledLabel") : t("sourceDisabledLabel")}
                  </span>
                  <span>{t("sourceOpenDetail")}</span>
                </div>
              </button>
              <div className="source-row-control">
                <SourceSwitch
                  source={source}
                  isBusy={isBusy}
                  t={t}
                  onToggle={() => {
                    void onToggleEnabled({ id: source.id, enabled: !source.enabled });
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ResearchSourceDetailPage({
  source,
  isBusy,
  t,
  onBack,
  onSaveCredential,
  onToggleEnabled,
  onSaveDefinition,
  onDeleteSource,
  onTestSource,
}: DetailProps) {
  const [credentialEditing, setCredentialEditing] = useState(false);
  const [credentialVisible, setCredentialVisible] = useState(false);
  const [credentialDraft, setCredentialDraft] = useState("");
  const [definitionDraft, setDefinitionDraft] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [specOpen, setSpecOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testResult, setTestResult] = useState<ResearchSourceTestResult | null>(null);
  const [testError, setTestError] = useState<Feedback>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteRunning, setDeleteRunning] = useState(false);

  useEffect(() => {
    setCredentialEditing(false);
    setCredentialVisible(false);
    setCredentialDraft("");
    setDefinitionDraft(prettyDefinition(source?.definition));
    setFeedback(null);
  }, [source?.id, source?.definition]);

  if (!source) {
    return (
      <section className="page active source-page" aria-label={t("sourceDetailTitle")}>
        <button type="button" className="secondary small-button" onClick={onBack}>
          {t("backButton")}
        </button>
        <p className="feedback-error">{t("sourceNotFound")}</p>
      </section>
    );
  }

  const isBuiltin = source.kind === "builtin";
  const configured = source.credential_status === "configured";
  const definitionReadOnly = isBuiltin || isBusy;
  const requiresCredential = sourceRequiresCredential(source);

  async function saveCredential() {
    const value = credentialDraft.trim();
    if (!value) {
      setFeedback({ kind: "error", text: t("sourceCredentialRequired") });
      return;
    }
    try {
      await onSaveCredential({ id: source!.id, credential: value });
      setCredentialEditing(false);
      setCredentialDraft("");
      setFeedback({ kind: "ok", text: t("sourceCredentialSaved") });
    } catch (err) {
      setFeedback(toError(err, t));
    }
  }

  async function clearCredential() {
    try {
      await onSaveCredential({ id: source!.id, clear: true });
      setCredentialEditing(false);
      setCredentialDraft("");
      setFeedback({ kind: "ok", text: t("sourceCredentialCleared") });
    } catch (err) {
      setFeedback(toError(err, t));
    }
  }

  async function toggleEnabled() {
    try {
      await onToggleEnabled({ id: source!.id, enabled: !source!.enabled });
      setFeedback({ kind: "ok", text: t("sourceToggleSaved") });
    } catch (err) {
      setFeedback(toError(err, t));
    }
  }

  async function saveDefinition() {
    let definition: Record<string, unknown>;
    try {
      definition = parseDefinition(definitionDraft);
    } catch {
      setFeedback({ kind: "error", text: t("addSourceInvalidJson") });
      return;
    }
    try {
      const next = await onSaveDefinition({ definition });
      if (next && typeof next === "object" && "definition" in next) {
        setDefinitionDraft(prettyDefinition((next as ResearchSourceView).definition));
      }
      setFeedback({ kind: "ok", text: t("sourceDefinitionSaved") });
    } catch (err) {
      setFeedback(toError(err, t));
    }
  }

  async function deleteSource() {
    setDeleteRunning(true);
    try {
      await onDeleteSource({ id: source!.id });
      onBack();
    } catch (err) {
      setFeedback(toError(err, t));
      setDeleteConfirmOpen(false);
    } finally {
      setDeleteRunning(false);
    }
  }

  async function testSource(query: string) {
    let definition: Record<string, unknown>;
    try {
      definition = parseDefinition(definitionDraft);
    } catch {
      setTestError({ kind: "error", text: t("addSourceInvalidJson") });
      return;
    }
    setTestRunning(true);
    setTestError(null);
    try {
      const next = await onTestSource({ id: source!.id, definition, query });
      setTestDialogOpen(false);
      setTestResult(next);
    } catch (err) {
      setTestError(toError(err, t));
    } finally {
      setTestRunning(false);
    }
  }

  return (
    <section className="page active source-page" aria-label={t("sourceDetailTitle")}>
      <div className="source-page-head">
        <div>
          <button type="button" className="secondary small-button" onClick={onBack}>
            {t("backButton")}
          </button>
          <h2>{source.name}</h2>
        </div>
        <span className="source-kind">{isBuiltin ? t("sourceKindBuiltin") : t("sourceKindUser")}</span>
      </div>

      <div className="source-detail-layout">
        <div className="source-state-row">
          <span className="source-state-label">{t("sourceStateLabel")}</span>
          <SourceSwitch source={source} isBusy={isBusy} t={t} onToggle={toggleEnabled} />
        </div>

        {requiresCredential ? (
          <section className="source-detail-section">
            <h3>{t("sourceCredentialSection")}</h3>

            {credentialEditing ? (
              <div className="source-editor">
                <label htmlFor={`source-token-${source.id}`}>{t("sourceCredentialLabel")}</label>
                <input
                  id={`source-token-${source.id}`}
                  type="password"
                  autoComplete="off"
                  placeholder={t("sourceCredentialPlaceholder")}
                  value={credentialDraft}
                  onChange={(event) => setCredentialDraft(event.target.value)}
                />
                <div className="actions">
                  <button type="button" onClick={saveCredential} disabled={isBusy || !credentialDraft.trim()}>
                    {t("saveSettingsButton")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setCredentialEditing(false);
                      setCredentialDraft("");
                    }}
                  >
                    {t("cancelButton")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="credential-row">
                <p className="source-description credential-mask">
                  {configured ? (credentialVisible ? source.credential || "" : maskCredential(source.credential || "")) : t("sourceCredentialMissing")}
                </p>
                <div className="actions credential-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setCredentialVisible((value) => !value)}
                    disabled={!configured}
                    aria-label={credentialVisible ? t("sourceCredentialHide") : t("sourceCredentialShow")}
                    title={credentialVisible ? t("sourceCredentialHide") : t("sourceCredentialShow")}
                  >
                    {credentialVisible ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCredentialEditing(true);
                      setCredentialVisible(false);
                      setCredentialDraft("");
                      setFeedback(null);
                    }}
                    disabled={isBusy}
                  >
                    {configured ? t("sourceCredentialReplace") : t("sourceCredentialAdd")}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setCredentialVisible(false);
                      void clearCredential();
                    }}
                    disabled={isBusy || !configured}
                  >
                    {t("clearSettingsButton")}
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        <section className="source-detail-section">
          <div className="source-section-head">
            <h3>{t("sourceDefinitionLabel")}</h3>
            <div className="source-section-actions">
              <button type="button" className="secondary small-button" onClick={() => setTestDialogOpen(true)} disabled={isBusy}>
                {t("sourceTestButton")}
              </button>
              <button type="button" className="danger small-button" onClick={() => setSpecOpen(true)}>
                {t("sourceDefinitionSpecButton")}
              </button>
              {isBuiltin ? <span className="status-pill">{t("sourceDefinitionReadonly")}</span> : null}
            </div>
          </div>
          {isBuiltin ? <p className="source-description">{t("sourceBuiltinReadonlyHint")}</p> : null}
          <textarea
            className="definition-editor"
            rows={14}
            value={definitionDraft}
            readOnly={definitionReadOnly}
            onChange={(event) => setDefinitionDraft(event.target.value)}
            aria-label={t("sourceDefinitionLabel")}
          />
          {!isBuiltin ? (
            <div className="actions">
              <button type="button" onClick={saveDefinition} disabled={isBusy || !definitionDraft.trim()}>
                {t("sourceDefinitionSave")}
              </button>
              <button type="button" className="danger" onClick={() => setDeleteConfirmOpen(true)} disabled={isBusy}>
                {t("deleteSourceButton")}
              </button>
            </div>
          ) : null}
        </section>
      </div>
      {specOpen ? <SourceDefinitionSpecDialog t={t} onClose={() => setSpecOpen(false)} /> : null}
      {testDialogOpen ? (
        <SourceTestConfirmDialog
          t={t}
          isRunning={testRunning}
          error={testError}
          onClose={() => {
            if (!testRunning) {
              setTestDialogOpen(false);
              setTestError(null);
            }
          }}
          onRun={testSource}
        />
      ) : null}
      {testResult ? <SourceTestResultDialog t={t} result={testResult} onClose={() => setTestResult(null)} /> : null}
      {deleteConfirmOpen ? (
        <ConfirmDialog
          t={t}
          title={t("deleteSourceButton")}
          message={t("deleteSourceConfirm")}
          confirmLabel={deleteRunning ? t("deleteSourceDeleting") : t("deleteSourceButton")}
          isBusy={deleteRunning}
          onCancel={() => {
            if (!deleteRunning) setDeleteConfirmOpen(false);
          }}
          onConfirm={deleteSource}
        />
      ) : null}
      {feedback ? <p className={feedback.kind === "error" ? "feedback-error" : "feedback-ok"}>{feedback.text}</p> : null}
    </section>
  );
}

export function ResearchSourceNewPage({ isBusy, t, onBack, onAddSource }: NewProps) {
  const [definitionDraft, setDefinitionDraft] = useState("");
  const [credentialDraft, setCredentialDraft] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [specOpen, setSpecOpen] = useState(false);

  async function submit() {
    let definition: Record<string, unknown>;
    try {
      definition = parseDefinition(definitionDraft);
    } catch {
      setFeedback({ kind: "error", text: t("addSourceInvalidJson") });
      return;
    }
    try {
      await onAddSource({ definition, credential: credentialDraft.trim() || undefined });
      onBack();
    } catch (err) {
      setFeedback(toError(err, t));
    }
  }

  return (
    <section className="page active source-page" aria-label={t("addSourceTitle")}>
      <div className="source-page-head">
        <div>
          <button type="button" className="secondary small-button" onClick={onBack}>
            {t("backButton")}
          </button>
          <h2>{t("addSourceTitle")}</h2>
        </div>
      </div>
      <div className="source-detail-section">
        <div className="source-section-head">
          <label htmlFor="add-source-definition">{t("addSourceDefinitionLabel")}</label>
          <button type="button" className="danger small-button" onClick={() => setSpecOpen(true)}>
            {t("sourceDefinitionSpecButton")}
          </button>
        </div>
        <textarea
          id="add-source-definition"
          className="definition-editor"
          rows={16}
          placeholder={t("addSourceDefinitionPlaceholder")}
          value={definitionDraft}
          onChange={(event) => setDefinitionDraft(event.target.value)}
        />
        <label htmlFor="add-source-credential">{t("addSourceCredentialLabel")}</label>
        <input
          id="add-source-credential"
          type="password"
          autoComplete="off"
          value={credentialDraft}
          onChange={(event) => setCredentialDraft(event.target.value)}
        />
        <div className="actions">
          <button type="button" onClick={submit} disabled={isBusy || !definitionDraft.trim()}>
            {t("addSourceSubmit")}
          </button>
          <button type="button" className="secondary" onClick={onBack}>
            {t("addSourceCancel")}
          </button>
        </div>
      </div>
      {specOpen ? <SourceDefinitionSpecDialog t={t} onClose={() => setSpecOpen(false)} /> : null}
      {feedback ? <p className={feedback.kind === "error" ? "feedback-error" : "feedback-ok"}>{feedback.text}</p> : null}
    </section>
  );
}

function SourceDefinitionSpecDialog({ t, onClose }: { t(key: MessageKey): string; onClose(): void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="definition-spec-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-definition-spec-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="definition-spec-head">
          <div>
            <p className="eyebrow">{t("sourceDefinitionSpecEyebrow")}</p>
            <h2 id="source-definition-spec-title">{t("sourceDefinitionSpecTitle")}</h2>
          </div>
          <button type="button" className="secondary small-button" onClick={onClose} aria-label={t("closeButton")}>
            {t("closeButton")}
          </button>
        </div>
        <div className="definition-spec-body">
          <SourceDefinitionSpecContent t={t} />
        </div>
      </section>
    </div>
  );
}

function ConfirmDialog({
  t,
  title,
  message,
  confirmLabel,
  isBusy,
  onCancel,
  onConfirm,
}: {
  t(key: MessageKey): string;
  title: string;
  message: string;
  confirmLabel: string;
  isBusy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isBusy, onCancel]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={isBusy ? undefined : onCancel}>
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="definition-spec-head">
          <h2 id="confirm-dialog-title">{title}</h2>
          <button type="button" className="secondary small-button" onClick={onCancel} disabled={isBusy} aria-label={t("closeButton")}>
            {t("closeButton")}
          </button>
        </div>
        <div className="definition-spec-body">
          <p>{message}</p>
          <div className="actions">
            <button type="button" className="danger" onClick={onConfirm} disabled={isBusy}>
              {confirmLabel}
            </button>
            <button type="button" className="secondary" onClick={onCancel} disabled={isBusy}>
              {t("cancelButton")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SourceTestConfirmDialog({
  t,
  isRunning,
  error,
  onClose,
  onRun,
}: {
  t(key: MessageKey): string;
  isRunning: boolean;
  error: Feedback;
  onClose(): void;
  onRun(query: string): void;
}) {
  const [query, setQuery] = useState(t("sourceTestDefaultQuery"));

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isRunning) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isRunning, onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={isRunning ? undefined : onClose}>
      <section
        className="source-test-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-test-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="definition-spec-head">
          <div>
            <p className="eyebrow">{t("sourceTestEyebrow")}</p>
            <h2 id="source-test-confirm-title">{t("sourceTestConfirmTitle")}</h2>
          </div>
          <button type="button" className="secondary small-button" onClick={onClose} disabled={isRunning} aria-label={t("closeButton")}>
            {t("closeButton")}
          </button>
        </div>
        <div className="definition-spec-body">
          <p>{t("sourceTestConfirmText")}</p>
          <p className="source-test-warning">{t("sourceTestCredentialWarning")}</p>
          <label className="source-test-query" htmlFor="source-test-query">
            {t("sourceTestQueryLabel")}
            <input
              id="source-test-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={isRunning}
            />
          </label>
          {error ? <p className="feedback-error">{error.text}</p> : null}
          <div className="actions">
            <button type="button" onClick={() => onRun(query.trim())} disabled={isRunning || !query.trim()}>
              {isRunning ? t("sourceTestRunning") : t("sourceTestRunButton")}
            </button>
            <button type="button" className="secondary" onClick={onClose} disabled={isRunning}>
              {t("cancelButton")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.2 10.2 0 0 1 12 5c6 0 9.5 7 9.5 7a17.5 17.5 0 0 1-3 3.7" />
      <path d="M6.4 6.8C3.9 8.5 2.5 12 2.5 12s3.5 7 9.5 7a9.3 9.3 0 0 0 4.2-1" />
      <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1" />
    </svg>
  );
}

function SourceTestResultDialog({
  t,
  result,
  onClose,
}: {
  t(key: MessageKey): string;
  result: ResearchSourceTestResult;
  onClose(): void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="source-test-result-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-test-result-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="definition-spec-head">
          <div>
            <p className="eyebrow">{t("sourceTestEyebrow")}</p>
            <h2 id="source-test-result-title">{t("sourceTestResultTitle")}</h2>
          </div>
          <button type="button" className="secondary small-button" onClick={onClose} aria-label={t("closeButton")}>
            {t("closeButton")}
          </button>
        </div>
        <div className="definition-spec-body">
          <div className="source-test-summary">
            <span>{t("sourceTestQuerySummary")}: {result.query}</span>
            <span>{t("sourceTestDurationSummary")}: {result.duration_ms}ms</span>
            <span>{t("sourceTestExtractedSummary")}: {result.extracted.length}</span>
          </div>
          {result.error ? <p className="feedback-error">{formatSourceTestError(result.error)}</p> : <p className="feedback-ok">{t("sourceTestSuccess")}</p>}

          <section className="definition-spec-section">
            <h3>{t("sourceTestExtractedTitle")}</h3>
            <pre className="definition-spec-code">{prettyDefinition(result.extracted)}</pre>
          </section>

          {result.pages.map((page) => (
            <section className="definition-spec-section" key={page.page}>
              <h3>{t("sourceTestPageTitle")} {page.page}</h3>
              <div className="source-test-grid">
                <article>
                  <h4>{t("sourceTestRequestTitle")}</h4>
                  <pre className="definition-spec-code">{prettyDefinition(page.request)}</pre>
                </article>
                <article>
                  <h4>{t("sourceTestResponseTitle")}</h4>
                  <pre className="definition-spec-code">{prettyDefinition(page.response || null)}</pre>
                </article>
                <article>
                  <h4>{t("sourceTestPageExtractedTitle")}</h4>
                  <pre className="definition-spec-code">{prettyDefinition(page.extracted || [])}</pre>
                </article>
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function SourceDefinitionSpecContent({ t }: { t(key: MessageKey): string }) {
  return (
    <>
      <p>{t("sourceDefinitionSpecIntro")}</p>

      <section className="definition-spec-section">
        <h3>{t("sourceDefinitionSpecExampleTitle")}</h3>
        <p>{t("sourceDefinitionSpecExampleHint")}</p>
        <pre className="definition-spec-code">{makeSourceDefinitionExample(t)}</pre>
      </section>

      <section className="definition-spec-section">
        <h3>{t("sourceDefinitionSpecRequiredTitle")}</h3>
        <dl className="definition-spec-list">
          <dt>id</dt>
          <dd>{t("sourceDefinitionSpecId")}</dd>
          <dt>name</dt>
          <dd>{t("sourceDefinitionSpecName")}</dd>
          <dt>description</dt>
          <dd>{t("sourceDefinitionSpecDescription")}</dd>
          <dt>max_parallel</dt>
          <dd>{t("sourceDefinitionSpecMaxParallel")}</dd>
        </dl>
      </section>

      <section className="definition-spec-section">
        <h3>{t("sourceDefinitionSpecRequestTitle")}</h3>
        <p>{t("sourceDefinitionSpecRequestIntro")}</p>
        <dl className="definition-spec-list">
          <dt>request.method</dt>
          <dd>{t("sourceDefinitionSpecMethod")}</dd>
          <dt>request.url</dt>
          <dd>{t("sourceDefinitionSpecUrl")}</dd>
          <dt>request.headers</dt>
          <dd>{t("sourceDefinitionSpecHeaders")}</dd>
          <dt>request.body</dt>
          <dd>{t("sourceDefinitionSpecBody")}</dd>
        </dl>
      </section>

      <section className="definition-spec-section">
        <h3>{t("sourceDefinitionSpecPlaceholdersTitle")}</h3>
        <p>{t("sourceDefinitionSpecPlaceholdersIntro")}</p>
        <dl className="definition-spec-list compact">
          <dt>{"{token}"}</dt>
          <dd>{t("sourceDefinitionSpecToken")}</dd>
          <dt>{"{query}"}</dt>
          <dd>{t("sourceDefinitionSpecQuery")}</dd>
          <dt>{"{page}"}</dt>
          <dd>{t("sourceDefinitionSpecPage")}</dd>
          <dt>{"{page_size}"}</dt>
          <dd>{t("sourceDefinitionSpecPageSize")}</dd>
          <dt>{"{cursor}"}</dt>
          <dd>{t("sourceDefinitionSpecCursor")}</dd>
        </dl>
      </section>

      <section className="definition-spec-section">
        <h3>{t("sourceDefinitionSpecPaginationTitle")}</h3>
        <p>{t("sourceDefinitionSpecPaginationIntro")}</p>
        <ul className="definition-spec-bullets">
          <li>{t("sourceDefinitionSpecPaginationNone")}</li>
          <li>{t("sourceDefinitionSpecPaginationPage")}</li>
          <li>{t("sourceDefinitionSpecPaginationOffset")}</li>
          <li>{t("sourceDefinitionSpecPaginationCursor")}</li>
        </ul>
      </section>

      <section className="definition-spec-section">
        <h3>{t("sourceDefinitionSpecFieldMapTitle")}</h3>
        <p>{t("sourceDefinitionSpecFieldMapIntro")}</p>
        <div className="definition-spec-subsection">
          <h4>{t("sourceDefinitionSpecResultFieldsTitle")}</h4>
          <dl className="definition-spec-list">
            <dt>result.items_path</dt>
            <dd>{t("sourceDefinitionSpecItemsPath")}</dd>
            <dt>result.url</dt>
            <dd>{t("sourceDefinitionSpecFieldUrl")}</dd>
            <dt>result.title</dt>
            <dd>{t("sourceDefinitionSpecFieldTitle")}</dd>
            <dt>result.content</dt>
            <dd>{t("sourceDefinitionSpecFieldContent")}</dd>
            <dt>result.next_cursor</dt>
            <dd>{t("sourceDefinitionSpecFieldCursor")}</dd>
          </dl>
        </div>

        <div className="definition-spec-subsection">
          <h4>{t("sourceDefinitionSpecResultModesTitle")}</h4>
          <div className="definition-mode-grid">
            <article className="definition-mode-card">
              <h5>path</h5>
              <p>{t("sourceDefinitionSpecResultPathMode")}</p>
              <pre className="definition-spec-inline-code">{`{ "mode": "path", "value": "company.name" }`}</pre>
            </article>
            <article className="definition-mode-card">
              <h5>paths</h5>
              <p>{t("sourceDefinitionSpecResultPathsMode")}</p>
              <pre className="definition-spec-inline-code">{`{ "mode": "paths", "value": ["summary", "details.scope"] }`}</pre>
            </article>
            <article className="definition-mode-card">
              <h5>template</h5>
              <p>{t("sourceDefinitionSpecResultTemplateMode")}</p>
              <pre className="definition-spec-inline-code">{`{ "mode": "template", "value": "Company: {{item.name}}" }`}</pre>
            </article>
            <article className="definition-mode-card">
              <h5>none</h5>
              <p>{t("sourceDefinitionSpecResultNoneMode")}</p>
              <pre className="definition-spec-inline-code">{`{ "mode": "none" }`}</pre>
            </article>
          </div>
        </div>

        <div className="definition-spec-subsection">
          <h4>{t("sourceDefinitionSpecPathRulesTitle")}</h4>
          <ul className="definition-spec-bullets">
            <li>{t("sourceDefinitionSpecItemsArrayNote")}</li>
            <li>{t("sourceDefinitionSpecItemsMissingNote")}</li>
            <li>{t("sourceDefinitionSpecRelativePathsNote")}</li>
            <li>{t("sourceDefinitionSpecCursorRootNote")}</li>
            <li>{t("sourceDefinitionSpecNestedPathsNote")}</li>
            <li>{t("sourceDefinitionSpecMissingPathNote")}</li>
          </ul>
        </div>

        <div className="definition-spec-subsection">
          <h4>{t("sourceDefinitionSpecResultExampleTitle")}</h4>
          <pre className="definition-spec-code">{resultPathExample}</pre>
        </div>
      </section>

      <section className="definition-spec-section">
        <h3>{t("sourceDefinitionSpecTemplateTitle")}</h3>
        <p>{t("sourceDefinitionSpecTemplateIntro")}</p>
        <div className="definition-spec-subsection">
          <h4>{t("sourceDefinitionSpecTemplateSyntaxTitle")}</h4>
          <ul className="definition-spec-bullets">
            <li>{t("sourceDefinitionSpecTemplateDoubleBrace")}</li>
            <li>{t("sourceDefinitionSpecTemplateNamespaces")}</li>
            <li>{t("sourceDefinitionSpecTemplateMissing")}</li>
            <li>{t("sourceDefinitionSpecTemplateNoToken")}</li>
          </ul>
        </div>

        <div className="definition-spec-subsection">
          <h4>{t("sourceDefinitionSpecTemplateNamespacesTitle")}</h4>
          <div className="definition-mode-grid">
            <article className="definition-mode-card">
              <h5>item</h5>
              <p>{t("sourceDefinitionSpecTemplateItemNamespace")}</p>
            </article>
            <article className="definition-mode-card">
              <h5>context</h5>
              <p>{t("sourceDefinitionSpecTemplateContextNamespace")}</p>
            </article>
          </div>
        </div>

        <div className="definition-spec-subsection">
          <h4>{t("sourceDefinitionSpecTemplateExamplesTitle")}</h4>
          <dl className="definition-spec-list">
            <dt>{"{{item.company_name}}"}</dt>
            <dd>{t("sourceDefinitionSpecTemplateItem")}</dd>
            <dt>{"{{item.details.scope}}"}</dt>
            <dd>{t("sourceDefinitionSpecTemplateNested")}</dd>
            <dt>{"{{item.tags[0]}}"}</dt>
            <dd>{t("sourceDefinitionSpecTemplateIndex")}</dd>
            <dt>{"{{context.query}}"}</dt>
            <dd>{t("sourceDefinitionSpecTemplateQuery")}</dd>
            <dt>{"{{context.page}}"}</dt>
            <dd>{t("sourceDefinitionSpecTemplatePage")}</dd>
          </dl>
        </div>

        <div className="definition-spec-subsection">
          <h4>{t("sourceDefinitionSpecTemplateExampleTitle")}</h4>
          <pre className="definition-spec-code">{templateExample}</pre>
        </div>
      </section>

      <section className="definition-spec-section">
        <h3>{t("sourceDefinitionSpecCredentialTitle")}</h3>
        <p>{t("sourceDefinitionSpecCredentialText")}</p>
      </section>

      <section className="definition-spec-section">
        <h3>{t("sourceDefinitionSpecUnsupportedTitle")}</h3>
        <p>{t("sourceDefinitionSpecUnsupportedText")}</p>
      </section>
    </>
  );
}

function makeSourceDefinitionExample(t: (key: MessageKey) => string): string {
  return JSON.stringify(
    {
      id: "company-search",
      name: t("sourceDefinitionSpecExampleName"),
      description: t("sourceDefinitionSpecExampleDescription"),
      max_parallel: 1,
      request: {
        method: "GET",
        url: "https://api.example.com/search?keyword={query}&page={page}&page_size={page_size}",
        headers: {
          Authorization: "Bearer {token}",
        },
      },
      pagination: {
        mode: "page",
        max_pages: 3,
        page_size: 10,
        start_page: 1,
      },
      result: {
        items_path: "data.results[]",
        url: { mode: "template", value: "https://example.com/company/search?keyword={{context.query}}" },
        title: { mode: "path", value: "name" },
        content: {
          mode: "template",
          value: t("sourceDefinitionSpecExampleContentTemplate"),
        },
      },
      response: {
        content_type: "application/json",
      },
    },
    null,
    2,
  );
}

const resultPathExample = `"result": {
  "items_path": "data.results[]",
  "url": { "mode": "path", "value": "abc.url" },
  "title": { "mode": "path", "value": "names[0].text" },
  "content": { "mode": "paths", "value": ["summary", "details.scope", "tags[0]"] },
  "next_cursor": "paging.next"
}`;

const templateExample = `"content": {
  "mode": "template",
  "value": "Company: {{item.company_name}}\\nScope: {{item.details.scope}}\\nSearch: {{context.query}}"
}`;

function parseDefinition(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("definition must be an object");
  }
  return parsed as Record<string, unknown>;
}

function prettyDefinition(definition: unknown): string {
  if (!definition || typeof definition !== "object") return "{}";
  return JSON.stringify(definition, null, 2);
}

function maskCredential(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "***";
  if (text.length <= 4) return "*".repeat(text.length);
  return `***${text.slice(-4)}`;
}

function sourceRequiresCredential(source: ResearchSourceView): boolean {
  return source.definition?.credential_required !== false;
}

function formatSourceTestError(error: NonNullable<ResearchSourceTestResult["error"]>): string {
  const code = error.code ? `${error.code}: ` : "";
  return `${code}${error.message || "Source test failed."}`;
}

function toError(err: unknown, t: (key: MessageKey) => string): Feedback {
  if (err instanceof Error && err.message) return { kind: "error", text: err.message };
  return { kind: "error", text: t("errorToolFailed") };
}
