import { Fragment, cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { MessageKey } from "../i18n/messages";
import type { CitationSource, ResearchResult, SearchResult } from "../types";
import { SourceList } from "./SourceList";
import { SourceSiteIcon } from "./SourceSiteIcon";

interface Props {
  result: ResearchResult | null;
  isBusy?: boolean;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
  onSemanticRewrite?(input: { selectedText: string; instruction: string; refreshResearch?: boolean }): Promise<unknown>;
  onSemanticRewritePreview?(input: { selectedText: string; instruction: string; refreshResearch?: boolean }): Promise<SemanticRewriteProposal>;
  onApplySemanticRewrite?(proposalId: string): Promise<unknown>;
  onDiscardSemanticRewrite?(proposalId: string): void;
  onManualReportSave?(input: { reportMarkdown: string }): Promise<unknown>;
  onAttachmentOpen?(source: Extract<CitationSource, { kind: "attachment" }>): void;
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
  onAttachmentOpen,
}: Props) {
  const markdown = result?.report_markdown || "";
  const sourceUrls = result?.source_urls || [];
  const citationSources = result?.citation_sources?.length ? result.citation_sources : sourceUrls.map((url) => ({ kind: "url" as const, url }));
  const sourceItems = result?.sources || [];
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
  const [citationCard, setCitationCard] = useState<CitationCardState | null>(null);
  const citationHideTimer = useRef<number | null>(null);
  const selectionDragRef = useRef(false);
  const canRewrite = Boolean(markdown && (onSemanticRewritePreview || onSemanticRewrite));
  const canManualEdit = Boolean(markdown && onManualReportSave);
  const markdownComponents = reportMarkdownComponents({
    selectedText,
    citationSources,
    onShowCitation: showCitationCard,
    onHideCitation: scheduleHideCitation,
  });

  useEffect(() => {
    if (!editing) setManualDraft(markdown);
  }, [editing, markdown]);

  useEffect(() => {
    setCitationCard(null);
  }, [markdown]);

  useEffect(() => {
    if (!citationCard) return;
    const updateCitationPosition = () => {
      setCitationCard((current) => {
        if (!current) return current;
        const nextPosition = positionCitationCard(current.anchor);
        return nextPosition ? { ...current, ...nextPosition } : null;
      });
    };
    window.addEventListener("scroll", updateCitationPosition, true);
    window.addEventListener("resize", updateCitationPosition);
    return () => {
      window.removeEventListener("scroll", updateCitationPosition, true);
      window.removeEventListener("resize", updateCitationPosition);
    };
  }, [citationCard]);

  function clearCitationHideTimer() {
    if (citationHideTimer.current !== null) {
      window.clearTimeout(citationHideTimer.current);
      citationHideTimer.current = null;
    }
  }

  function scheduleHideCitation() {
    clearCitationHideTimer();
    citationHideTimer.current = window.setTimeout(() => setCitationCard(null), 140);
  }

  function showCitationCard(numbers: number[], activeNumber: number, anchor: HTMLElement) {
    if (selectionDragRef.current) return;
    clearCitationHideTimer();
    const validNumbers = numbers.filter((number) => citationSources[number - 1]);
    const fallbackNumbers = citationSources[activeNumber - 1] ? [activeNumber] : [];
    const nextNumbers = validNumbers.length ? validNumbers : fallbackNumbers;
    if (!nextNumbers.length) return;
    const activeIndex = Math.max(0, nextNumbers.indexOf(activeNumber));
    const position = positionCitationCard(anchor);
    if (!position) return;
    setCitationCard({
      numbers: nextNumbers,
      activeIndex,
      anchor,
      ...position,
    });
  }

  function captureSelection(event: React.MouseEvent) {
    if (!canRewrite) return;
    const captured = captureSelectionAtPoint(event.clientX, event.clientY);
    if (captured) event.preventDefault();
  }

  function captureSelectionAtPoint(clientX: number, clientY: number): boolean {
    const selection = window.getSelection();
    const text = expandPartialCitationSelection(selection?.toString() || "").trim();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const report = reportRef.current;
    if (!text || !range || !report?.contains(range.commonAncestorContainer)) {
      setContextMenu(null);
      return false;
    }
    setSelectedText(text);
    setContextMenu({
      x: Math.min(clientX, window.innerWidth - 132),
      y: Math.min(clientY, window.innerHeight - 48),
    });
    return true;
  }

  function beginReportSelection(event: React.MouseEvent) {
    if (!canRewrite || event.button !== 0) return;
    selectionDragRef.current = true;
    setCitationCard(null);
    setContextMenu(null);
  }

  function endReportSelection(event: React.MouseEvent) {
    if (!canRewrite || event.button !== 0) return;
    const { clientX, clientY } = event;
    window.setTimeout(() => {
      selectionDragRef.current = false;
      captureSelectionAtPoint(clientX, clientY);
    }, 0);
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
          <article
            id="report"
            ref={reportRef}
            className={`report ${markdown ? "" : "empty"}`}
            onMouseDown={beginReportSelection}
            onMouseUp={endReportSelection}
            onContextMenu={captureSelection}
          >
            {markdown ? <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown> : t("emptyReport")}
          </article>
        )}
      </div>
      {citationCard ? (
        <CitationCard
          state={citationCard}
          sourceUrls={sourceUrls}
          citationSources={citationSources}
          sourceItems={sourceItems}
          onMouseEnter={clearCitationHideTimer}
          onMouseLeave={scheduleHideCitation}
          onNavigate={(direction) =>
            setCitationCard((current) =>
              current
                ? {
                    ...current,
                    activeIndex: (current.activeIndex + direction + current.numbers.length) % current.numbers.length,
                  }
                : current,
            )
          }
          onAttachmentOpen={onAttachmentOpen}
        />
      ) : null}
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
        <SourceList urls={sourceUrls} sources={sourceItems} citationSources={citationSources} t={t} onAttachmentOpen={onAttachmentOpen} />
      </div>
    </section>
  );
}

interface CitationCardState {
  numbers: number[];
  activeIndex: number;
  anchor: HTMLElement;
  x: number;
  y: number;
  placement: "above" | "below";
}

function CitationCard({
  state,
  sourceUrls,
  citationSources,
  sourceItems,
  onMouseEnter,
  onMouseLeave,
  onNavigate,
  onAttachmentOpen,
}: {
  state: CitationCardState;
  sourceUrls: string[];
  citationSources: CitationSource[];
  sourceItems: SearchResult[];
  onMouseEnter(): void;
  onMouseLeave(): void;
  onNavigate(direction: -1 | 1): void;
  onAttachmentOpen?(source: Extract<CitationSource, { kind: "attachment" }>): void;
}) {
  const number = state.numbers[state.activeIndex] || state.numbers[0];
  const citation = citationSources[number - 1] || (sourceUrls[number - 1] ? { kind: "url" as const, url: sourceUrls[number - 1] } : null);
  if (!citation) return null;
  if (citation.kind === "attachment") {
    return (
      <aside
        className={`citation-card ${state.placement === "above" ? "above" : "below"}`}
        style={{ left: state.x, top: state.y }}
        aria-label={`Reference ${number}`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="citation-card-nav">
          <div className="citation-card-switchers">
            <button type="button" className="citation-card-arrow" onClick={() => onNavigate(-1)} disabled={state.numbers.length <= 1} aria-label="Previous reference">
              ←
            </button>
            <button type="button" className="citation-card-arrow" onClick={() => onNavigate(1)} disabled={state.numbers.length <= 1} aria-label="Next reference">
              →
            </button>
          </div>
          <span className="citation-card-count">{state.activeIndex + 1}/{state.numbers.length}</span>
          <span className="citation-card-source-count">{state.numbers.length} 个来源</span>
        </div>
        <div className="citation-card-body">
          <span className="citation-card-host">
            上传文件
          </span>
          {onAttachmentOpen ? (
            <button type="button" className="citation-card-attachment-button" onClick={() => onAttachmentOpen(citation)}>
              {citation.file_name}
            </button>
          ) : (
            <strong>{citation.file_name}</strong>
          )}
          {attachmentChunkLabel(citation) ? <span className="citation-card-host">{attachmentChunkLabel(citation)}</span> : null}
          {citation.quote ? <span className="citation-card-snippet">{citation.quote}</span> : null}
        </div>
      </aside>
    );
  }
  const url = citation.url;
  const source = sourceForUrl(sourceItems, url);
  const host = hostFromUrl(url);
  const title = source?.title || url;
  const snippet = source?.content ? compactSnippet(source.content) : "";
  const fallbackInitial = (host || title || url || "S").trim().charAt(0).toUpperCase() || "S";

  return (
    <aside
      className={`citation-card ${state.placement === "above" ? "above" : "below"}`}
      style={{ left: state.x, top: state.y }}
      aria-label={`Reference ${number}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="citation-card-nav">
        <div className="citation-card-switchers">
          <button type="button" className="citation-card-arrow" onClick={() => onNavigate(-1)} disabled={state.numbers.length <= 1} aria-label="Previous reference">
            ←
          </button>
          <button type="button" className="citation-card-arrow" onClick={() => onNavigate(1)} disabled={state.numbers.length <= 1} aria-label="Next reference">
            →
          </button>
        </div>
        <span className="citation-card-count">{state.activeIndex + 1}/{state.numbers.length}</span>
        <span className="citation-card-source-count">{state.numbers.length} 个来源</span>
      </div>
      <a className="citation-card-body" href={url} target="_blank" rel="noreferrer noopener">
        <span className="citation-card-host">
          <SourceSiteIcon
            host={host}
            icon={source?.icon}
            imageClassName="citation-card-icon"
            fallbackClassName="citation-card-site-mark"
            fallbackText={fallbackInitial}
          />
          {host || "Source"}
        </span>
        <strong>{title}</strong>
        {snippet ? <span className="citation-card-snippet">{snippet}</span> : null}
      </a>
    </aside>
  );
}

function positionCitationCard(anchor: HTMLElement): Pick<CitationCardState, "x" | "y" | "placement"> | null {
  if (!anchor.isConnected) return null;
  const rect = anchor.getBoundingClientRect();
  const gap = 8;
  const margin = 12;
  const cardWidth = Math.min(360, Math.max(280, window.innerWidth - 24));
  const cardHeight = Math.min(240, Math.max(160, window.innerHeight - margin * 2));
  const maxX = Math.max(margin, window.innerWidth - cardWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - cardHeight - margin);
  if (rect.width <= 0 || rect.height <= 0) {
    return {
      x: Math.min(Math.max(margin, rect.left || margin), maxX),
      y: Math.min(Math.max(margin, (rect.bottom || margin) + gap), maxY),
      placement: "below",
    };
  }
  if (rect.bottom < margin || rect.top > window.innerHeight - margin) return null;
  if (rect.right < margin || rect.left > window.innerWidth - margin) return null;
  const centeredX = rect.left + rect.width / 2 - cardWidth / 2;
  const belowFits = rect.bottom + gap + cardHeight <= window.innerHeight - margin;
  const placement = belowFits ? "below" : "above";
  const rawY = placement === "below" ? rect.bottom + gap : rect.top - cardHeight - gap;
  return {
    x: Math.min(Math.max(margin, centeredX), maxX),
    y: Math.min(Math.max(margin, rawY), maxY),
    placement,
  };
}

function reportMarkdownComponents({
  selectedText,
  citationSources,
  onShowCitation,
  onHideCitation,
}: {
  selectedText: string;
  citationSources: CitationSource[];
  onShowCitation(numbers: number[], activeNumber: number, anchor: HTMLElement): void;
  onHideCitation(): void;
}): Parameters<typeof ReactMarkdown>[0]["components"] {
  const text = selectedText.trim();
  const wrap = (tag: "p" | "li" | "h1" | "h2" | "h3" | "h4" | "blockquote", children: ReactNode) => {
    const blockText = textContentOf(children);
    const highlighted = text ? highlightReactText(children, text) : children;
    const content = renderCitationButtons(highlighted, blockText, citationSources, onShowCitation, onHideCitation);
    const Tag = tag;
    return <Tag>{content}</Tag>;
  };
  return {
    p: ({ children }) => wrap("p", children),
    li: ({ children }) => wrap("li", children),
    h1: ({ children }) => wrap("h1", children),
    h2: ({ children }) => wrap("h2", children),
    h3: ({ children }) => wrap("h3", children),
    h4: ({ children }) => wrap("h4", children),
    blockquote: ({ children }) => wrap("blockquote", children),
  };
}

function renderCitationButtons(
  children: ReactNode,
  blockText: string,
  citationSources: CitationSource[],
  onShowCitation: (numbers: number[], activeNumber: number, anchor: HTMLElement) => void,
  onHideCitation: () => void,
  cursor: { current: number } = { current: 0 },
): ReactNode {
  if (typeof children === "string") return renderCitationString(children, blockText, citationSources, onShowCitation, onHideCitation, cursor);
  if (typeof children === "number") return renderCitationString(String(children), blockText, citationSources, onShowCitation, onHideCitation, cursor);
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{renderCitationButtons(child, blockText, citationSources, onShowCitation, onHideCitation, cursor)}</Fragment>
    ));
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    if (children.type === "mark") return children;
    const props = children.props;
    return cloneElement(children, {
      children: renderCitationButtons(props.children, blockText, citationSources, onShowCitation, onHideCitation, cursor),
    });
  }
  return children;
}

function renderCitationString(
  text: string,
  blockText: string,
  citationSources: CitationSource[],
  onShowCitation: (numbers: number[], activeNumber: number, anchor: HTMLElement) => void,
  onHideCitation: () => void,
  cursor: { current: number },
): ReactNode {
  const parts: ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const number = Number(match[1]);
    const absoluteIndex = cursor.current + match.index;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (citationSources[number - 1]) {
      const sentenceNumbers = citationNumbersForSentence(blockText, absoluteIndex).filter((candidate) => citationSources[candidate - 1]);
      parts.push(
        <span
          key={`${cursor.current}-${match.index}-${number}`}
          role="button"
          tabIndex={0}
          className="citation-chip"
          onMouseEnter={(event) => onShowCitation(sentenceNumbers.length ? sentenceNumbers : [number], number, event.currentTarget)}
          onMouseLeave={onHideCitation}
          onFocus={(event) => onShowCitation(sentenceNumbers.length ? sentenceNumbers : [number], number, event.currentTarget)}
          onBlur={onHideCitation}
          title={citationTitle(citationSources[number - 1])}
          aria-label={`[${number}]`}
        >
          [{number}]
        </span>,
      );
    } else {
      parts.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (!parts.length) {
    cursor.current += text.length;
    return text;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  cursor.current += text.length;
  return <>{parts}</>;
}

function citationNumbersForSentence(blockText: string, citationIndex: number): number[] {
  const start = Math.max(
    blockText.lastIndexOf("。", citationIndex - 1),
    blockText.lastIndexOf("！", citationIndex - 1),
    blockText.lastIndexOf("？", citationIndex - 1),
    blockText.lastIndexOf(".", citationIndex - 1),
    blockText.lastIndexOf("!", citationIndex - 1),
    blockText.lastIndexOf("?", citationIndex - 1),
    blockText.lastIndexOf("\n", citationIndex - 1),
  ) + 1;
  const after = blockText.slice(citationIndex);
  const nextPunctuation = after.search(/[。！？.!?\n]/);
  const end = nextPunctuation >= 0 ? citationIndex + nextPunctuation + 1 : blockText.length;
  return uniqueNumbers(Array.from(blockText.slice(start, end).matchAll(/\[(\d+)\]/g)).map((match) => Number(match[1])));
}

function uniqueNumbers(numbers: number[]): number[] {
  return Array.from(new Set(numbers.filter((number) => Number.isFinite(number) && number > 0)));
}

function citationTitle(source: CitationSource | undefined): string {
  if (!source) return "";
  if (source.kind === "url") return source.url;
  const label = attachmentChunkLabel(source);
  return `${source.file_name}${label ? ` · ${label}` : ""}`;
}

function attachmentChunkLabel(reference: Extract<CitationSource, { kind: "attachment" }>): string {
  const chunkId = String(reference.chunk_id || "");
  const match = /:(?:0*)(\d+)$/.exec(chunkId);
  if (match) return `chunk ${Number(match[1])}`;
  if (chunkId.endsWith(":image-summary")) return "";
  return chunkId ? "chunk" : "";
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceForUrl(sources: SearchResult[], url: string): SearchResult | null {
  const normalized = normalizeUrlForMatch(url);
  return sources.find((source) => normalizeUrlForMatch(source.url) === normalized) || null;
}

function normalizeUrlForMatch(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/";
    return parsed.toString();
  } catch {
    return String(url || "").trim().replace(/\/$/, "");
  }
}

function compactSnippet(text: string): string {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > 260 ? `${clean.slice(0, 259).trim()}…` : clean;
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
  const citationExpandedSelection = expandPartialCitationSelection(selectedText);
  if (citationExpandedSelection !== selectedText) {
    const expandedStart = plainText.indexOf(citationExpandedSelection);
    if (expandedStart >= 0) return { start: expandedStart, end: expandedStart + citationExpandedSelection.length };
  }
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

function expandPartialCitationSelection(text: string): string {
  const normalized = text.replace(/\u00a0/g, " ");
  const partialMatch = normalized.match(/^(.*)\[(\d*)$/s);
  if (!partialMatch) return normalized;
  const prefix = partialMatch[1] || "";
  const number = partialMatch[2] || "";
  return `${prefix}[${number || "1"}]`;
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
