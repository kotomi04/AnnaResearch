import { Fragment, cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { MessageKey } from "../i18n/messages";
import type { ResearchResult } from "../types";
import { SourceList } from "./SourceList";

interface Props {
  result: ResearchResult | null;
  isBusy?: boolean;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
  onSemanticRewrite?(input: { selectedText: string; instruction: string; refreshResearch?: boolean }): Promise<unknown>;
  onSemanticRewritePreview?(input: { selectedText: string; instruction: string; refreshResearch?: boolean }): Promise<SemanticRewriteProposal>;
  onApplySemanticRewrite?(proposalId: string): Promise<unknown>;
  onDiscardSemanticRewrite?(proposalId: string): void;
  onManualReportSave?(input: { reportMarkdown: string }): Promise<unknown>;
}

interface SemanticRewriteProposal {
  proposalId?: string;
  originalText?: string;
  rewrittenText: string;
  references?: Array<{ number: number; url: string; scope: "selected" | "nearby" | "section" | "fresh" }>;
}

export function ReportView({
  result,
  isBusy = false,
  t,
  onSemanticRewrite,
  onSemanticRewritePreview,
  onApplySemanticRewrite,
  onDiscardSemanticRewrite,
  onManualReportSave,
}: Props) {
  const markdown = result?.report_markdown || "";
  const sourceUrls = result?.source_urls || [];
  const reportRef = useRef<HTMLElement | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<SemanticRewriteProposal | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [manualDraft, setManualDraft] = useState(markdown);
  const [manualStatus, setManualStatus] = useState("");
  const [manualError, setManualError] = useState("");
  const canRewrite = Boolean(markdown && (onSemanticRewritePreview || onSemanticRewrite));
  const canManualEdit = Boolean(markdown && onManualReportSave);
  const markdownComponents = selectedText ? highlightedMarkdownComponents(selectedText) : undefined;

  useEffect(() => {
    if (!editing) setManualDraft(markdown);
  }, [editing, markdown]);

  function captureSelection(event: React.MouseEvent) {
    if (!canRewrite) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim() || "";
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const report = reportRef.current;
    if (!text || !range || !report?.contains(range.commonAncestorContainer)) {
      setContextMenu(null);
      return;
    }
    event.preventDefault();
    setSelectedText(text);
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 132),
      y: Math.min(event.clientY, window.innerHeight - 48),
    });
  }

  function openRewritePanel() {
    if (!selectedText) return;
    setContextMenu(null);
    setPanelOpen(true);
    setProposal(null);
    setStatus("");
    setError("");
  }

  async function submitRewrite(refreshResearch = false) {
    if (!selectedText.trim() || !instruction.trim()) return;
    setStatus(refreshResearch ? t("rewriteResearchRunning") : t("rewriteRunning"));
    setError("");
    setProposal(null);
    try {
      if (onSemanticRewritePreview) {
        const nextProposal = await onSemanticRewritePreview({ selectedText, instruction, refreshResearch });
        setProposal(nextProposal);
        setStatus(t("rewritePreviewReady"));
      } else if (onSemanticRewrite) {
        await onSemanticRewrite({ selectedText, instruction, refreshResearch });
        setStatus(t("rewriteApplied"));
        setSelectedText("");
        setInstruction("");
        window.getSelection()?.removeAllRanges();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("rewriteFailed"));
      setStatus("");
    }
  }

  async function applyProposal() {
    if (!proposal?.proposalId || !onApplySemanticRewrite) return;
    setStatus(t("rewriteApplying"));
    setError("");
    try {
      await onApplySemanticRewrite(proposal.proposalId);
      setStatus(t("rewriteApplied"));
      setSelectedText("");
      setInstruction("");
      setProposal(null);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("rewriteFailed"));
      setStatus("");
    }
  }

  function discardProposal() {
    if (proposal?.proposalId) onDiscardSemanticRewrite?.(proposal.proposalId);
    setProposal(null);
    setStatus(t("rewriteDiscarded"));
  }

  function clearRewrite() {
    if (proposal?.proposalId) onDiscardSemanticRewrite?.(proposal.proposalId);
    setSelectedText("");
    setInstruction("");
    setProposal(null);
    setPanelOpen(false);
    setContextMenu(null);
    setStatus("");
    setError("");
    window.getSelection()?.removeAllRanges();
  }

  function startManualEdit() {
    setManualDraft(markdown);
    setEditing(true);
    setManualStatus("");
    setManualError("");
    clearRewrite();
  }

  function cancelManualEdit() {
    setManualDraft(markdown);
    setEditing(false);
    setManualStatus("");
    setManualError("");
  }

  async function saveManualEdit() {
    if (!onManualReportSave || !manualDraft.trim()) return;
    setManualStatus(t("manualReportSaving"));
    setManualError("");
    try {
      await onManualReportSave({ reportMarkdown: manualDraft });
      setEditing(false);
      setManualStatus(t("manualReportSaved"));
    } catch (err) {
      setManualError(err instanceof Error ? err.message : t("manualReportFailed"));
      setManualStatus("");
    }
  }

  return (
    <section className="result-band" aria-label={t("resultAria")}>
      <div className="report-main">
        <div className="report-edit-bar">
          {canManualEdit ? (
            editing ? (
              <>
                <button type="button" className="primary-action" disabled={isBusy || !manualDraft.trim()} onClick={saveManualEdit}>
                  {t("manualReportSaveButton")}
                </button>
                <button type="button" className="secondary-action" disabled={isBusy} onClick={cancelManualEdit}>
                  {t("manualReportCancelButton")}
                </button>
              </>
            ) : (
              <button type="button" className="secondary-action" disabled={isBusy} onClick={startManualEdit}>
                {t("manualReportEditButton")}
              </button>
            )
          ) : null}
          {manualStatus ? <span className="manual-report-status">{manualStatus}</span> : null}
          {manualError ? <span className="manual-report-status" data-error="true">{manualError}</span> : null}
        </div>
        {editing ? (
          <textarea
            className="report-markdown-editor"
            value={manualDraft}
            aria-label={t("manualReportEditorLabel")}
            onChange={(event) => setManualDraft(event.target.value)}
            disabled={isBusy}
          />
        ) : (
          <article id="report" ref={reportRef} className={`report ${markdown ? "" : "empty"}`} onContextMenu={captureSelection}>
            {markdown ? <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown> : t("emptyReport")}
          </article>
        )}
      </div>
      {contextMenu ? (
        <div className="report-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button type="button" onClick={openRewritePanel}>{t("rewriteContextMenu")}</button>
        </div>
      ) : null}
      <div className="report-side-panel">
        {canRewrite ? (
          <section className="rewrite-panel" aria-label={t("rewritePanelTitle")}>
            <div className="rewrite-panel-head">
              <strong>{t("rewritePanelTitle")}</strong>
              <button type="button" className="text-button" onClick={clearRewrite}>{t("rewriteClear")}</button>
            </div>
            <p className="rewrite-panel-hint">{t("rewritePanelHint")}</p>
            {selectedText ? <div className="selected-text-preview">{selectedText}</div> : null}
            {panelOpen ? (
              <div className="rewrite-comment-tools">
                <label>
                  <span>{t("rewriteCommentLabel")}</span>
                  <textarea
                    rows={4}
                    value={instruction}
                    placeholder={t("rewriteCommentPlaceholder")}
                    onChange={(event) => setInstruction(event.target.value)}
                    disabled={isBusy}
                  />
                </label>
                <button
                  type="button"
                  className="primary-action"
                  disabled={isBusy || !instruction.trim() || !selectedText.trim()}
                  onClick={() => void submitRewrite(false)}
                >
                  {t("rewriteSendButton")}
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={isBusy || !instruction.trim() || !selectedText.trim()}
                  onClick={() => void submitRewrite(true)}
                >
                  {t("rewriteResearchButton")}
                </button>
                {proposal ? (
                  <div className="rewrite-proposal">
                    <div>
                      <span>{t("rewriteBeforeLabel")}</span>
                      <p>{proposal.originalText || selectedText}</p>
                    </div>
                    <div>
                      <span>{t("rewriteAfterLabel")}</span>
                      <p>{proposal.rewrittenText}</p>
                    </div>
                    {proposal.references?.length ? (
                      <div className="rewrite-reference-list">
                        <span>{t("rewriteReferencesLabel")}</span>
                        <ol>
                          {proposal.references.map((reference) => (
                            <li key={`${reference.number}-${reference.url}`}>
                              <a href={reference.url} target="_blank" rel="noreferrer noopener">
                                [{reference.number}] {reference.url}
                              </a>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                    <div className="rewrite-proposal-actions">
                      <button type="button" className="primary-action" disabled={isBusy || !proposal.proposalId} onClick={applyProposal}>
                        {t("rewriteApplyButton")}
                      </button>
                      <button type="button" className="secondary-action" disabled={isBusy} onClick={discardProposal}>
                        {t("rewriteDiscardButton")}
                      </button>
                    </div>
                  </div>
                ) : null}
                {status ? <p className="rewrite-status">{status}</p> : null}
                {error ? <p className="rewrite-status" data-error="true">{error}</p> : null}
              </div>
            ) : null}
          </section>
        ) : null}
        <SourceList urls={sourceUrls} t={t} />
      </div>
    </section>
  );
}

function highlightedMarkdownComponents(selectedText: string): Parameters<typeof ReactMarkdown>[0]["components"] {
  const text = selectedText.trim();
  return {
    p: ({ children }) => <p>{highlightReactText(children, text)}</p>,
    li: ({ children }) => <li>{highlightReactText(children, text)}</li>,
    h1: ({ children }) => <h1>{highlightReactText(children, text)}</h1>,
    h2: ({ children }) => <h2>{highlightReactText(children, text)}</h2>,
    h3: ({ children }) => <h3>{highlightReactText(children, text)}</h3>,
    h4: ({ children }) => <h4>{highlightReactText(children, text)}</h4>,
    blockquote: ({ children }) => <blockquote>{highlightReactText(children, text)}</blockquote>,
  };
}

function highlightReactText(children: ReactNode, selectedText: string): ReactNode {
  const plainText = textContentOf(children);
  const range = selectedRangeInBlock(plainText, selectedText);
  if (!range) return children;
  return highlightRange(children, range.start, range.end, { current: 0 });
}

function selectedRangeInBlock(plainText: string, selectedText: string): { start: number; end: number } | null {
  if (!plainText.trim() || !selectedText.trim()) return null;
  const directStart = plainText.indexOf(selectedText);
  if (directStart >= 0) return { start: directStart, end: directStart + selectedText.length };
  const normalizedBlock = normalizeComparableText(plainText);
  const normalizedSelection = normalizeComparableText(selectedText);
  if (normalizedSelection.includes(normalizedBlock)) return { start: 0, end: plainText.length };
  for (const segment of selectedText.split(/\n+/).map((part) => part.trim()).filter(Boolean)) {
    const directSegmentStart = plainText.indexOf(segment);
    if (directSegmentStart >= 0) return { start: directSegmentStart, end: directSegmentStart + segment.length };
    const normalizedSegment = normalizeComparableText(segment);
    if (normalizedSegment && normalizedBlock.includes(normalizedSegment)) return { start: 0, end: plainText.length };
  }
  return null;
}

function normalizeComparableText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function highlightRange(children: ReactNode, start: number, end: number, cursor: { current: number }): ReactNode {
  if (typeof children === "string") return highlightStringRange(children, start, end, cursor);
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{highlightRange(child, start, end, cursor)}</Fragment>
    ));
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    const props = children.props;
    return cloneElement(children, {
      children: highlightRange(props.children, start, end, cursor),
    });
  }
  return children;
}

function highlightStringRange(text: string, start: number, end: number, cursor: { current: number }): ReactNode {
  const textStart = cursor.current;
  const textEnd = textStart + text.length;
  cursor.current = textEnd;
  if (end <= textStart || start >= textEnd) return text;
  const localStart = Math.max(0, start - textStart);
  const localEnd = Math.min(text.length, end - textStart);
  return (
    <>
      {text.slice(0, localStart)}
      <mark className="report-rewrite-highlight">{text.slice(localStart, localEnd)}</mark>
      {text.slice(localEnd)}
    </>
  );
}

function textContentOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContentOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContentOf(node.props.children);
  return "";
}
