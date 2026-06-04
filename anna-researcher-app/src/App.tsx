import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { connectAnnaRuntime } from "./api/annaRuntime";
import { AnnaResearchApi, createStandaloneApi, type ResearchApi } from "./api/researchApi";
import { LanguageToggle } from "./components/LanguageToggle";
import { ReportView } from "./components/ReportView";
import { ResearchForm } from "./components/ResearchForm";
import {
  ResearchSourceDetailPage,
  ResearchSourceListPage,
  ResearchSourceNewPage,
} from "./components/ResearchSourcePanel";
import { ResearchTimeline } from "./components/ResearchTimeline";
import { StatusPanel } from "./components/StatusPanel";
import { MAX_RESEARCH_ITERATIONS, useResearchJob } from "./hooks/useResearchJob";
import type { FocusCandidate, RoleCandidate } from "./hooks/useResearchJob";
import { useLocale } from "./i18n/useLocale";
import { localizedError, localizedJobMessage } from "./i18n/status";
import type { ReportSection } from "./types";

export function App() {
  const { locale, setLocale, t } = useLocale();
  const [api, setApi] = useState<ResearchApi>(() => createStandaloneApi());
  const [runtimeError, setRuntimeError] = useState<unknown>(null);
  const [validationMessage, setValidationMessage] = useState("");
  const [appPage, setAppPage] = useState<"intro" | "result" | "sources" | "source-detail" | "source-new">("intro");
  const [sourceReturnPage, setSourceReturnPage] = useState<"intro" | "result">("intro");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [briefNameDraft, setBriefNameDraft] = useState("");
  const [researchNeedDraft, setResearchNeedDraft] = useState("");
  const [selectedFocusIds, setSelectedFocusIds] = useState<string[]>([]);
  const [regenInstruction, setRegenInstruction] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function connect() {
      try {
        const anna = await connectAnnaRuntime();
        if (!cancelled) {
          setRuntimeError(null);
          setApi(new AnnaResearchApi(anna));
        }
      } catch (err) {
        console.warn("[anna-researcher] standalone mode:", err instanceof Error ? err.message : err);
        if (!cancelled) {
          setRuntimeError(err);
          setApi(createStandaloneApi());
        }
      }
    }
    void connect();
    return () => {
      cancelled = true;
    };
  }, []);

  const research = useResearchJob(api);
  const jobMessage = localizedJobMessage(research.job, t);
  const asyncErrorMessage = research.error ? localizedError(research.error, t) : "";
  const runtimeErrorMessage = runtimeError ? t("runtimeMissing") : "";
  const message = validationMessage || runtimeErrorMessage || asyncErrorMessage || jobMessage.message;
  const isMessageError = Boolean(validationMessage || runtimeErrorMessage || asyncErrorMessage || jobMessage.isError);

  const sourceResult = useMemo(() => research.result, [research.result]);
  const selectedSource = useMemo(
    () => research.sources.find((source) => source.id === selectedSourceId) ?? null,
    [research.sources, selectedSourceId],
  );
  const ready = research.canStart;
  const stepLabel = makeIntroStepLabel(research.job?.max_iterations);
  const hasCompletedResult = hasCompletedResearchResult(research.job, sourceResult);
  const showIntroPage = appPage === "intro" && !research.isBusy;

  function start(input: { briefName: string; researchNeed: string }) {
    setValidationMessage("");
    setAppPage("result");
    void research.start(formatResearchQuery(input, locale));
  }

  function updateRoleCandidate(index: number, patch: Partial<RoleCandidate>) {
    research.setRoleCandidates(research.roleCandidates.map((candidate, idx) => (idx === index ? { ...candidate, ...patch } : candidate)));
  }

  function updateFocusCandidate(index: number, patch: Partial<FocusCandidate>) {
    research.setFocusCandidates(research.focusCandidates.map((candidate, idx) => (idx === index ? { ...candidate, ...patch } : candidate)));
  }

  function updateOutlineSection(index: number, patch: Partial<ReportSection>) {
    research.setOutlineDraft(research.outlineDraft.map((section, idx) => (idx === index ? { ...section, ...patch } : section)));
  }

  function addOutlineSection() {
    if (research.outlineDraft.length >= 8) return;
    research.setOutlineDraft([
      ...research.outlineDraft,
      {
        id: `section-${research.outlineDraft.length + 1}`,
        title: locale === "zh-CN" ? "新段落" : "New section",
        outline: locale === "zh-CN" ? "补充这一段需要研究的内容。" : "Describe what this section should research.",
        allowed_source_ids: research.sources.filter((source) => source.enabled && source.credential_status === "configured").slice(0, 1).map((source) => source.id),
        max_iterations: 5,
      },
    ]);
  }

  function deleteOutlineSection(index: number) {
    if (research.outlineDraft.length <= 1) return;
    research.setOutlineDraft(research.outlineDraft.filter((_, idx) => idx !== index).map((section, idx) => ({ ...section, id: `section-${idx + 1}` })));
  }

  function toggleSectionSource(index: number, sourceId: string) {
    const section = research.outlineDraft[index];
    if (!section) return;
    const current = new Set(section.allowed_source_ids);
    if (current.has(sourceId)) current.delete(sourceId);
    else current.add(sourceId);
    updateOutlineSection(index, { allowed_source_ids: Array.from(current).sort() });
  }

  function showLastResult() {
    if (hasCompletedResult) {
      setValidationMessage("");
      setAppPage("result");
    }
  }

  function showNewResearch() {
    setValidationMessage("");
    setAppPage("intro");
  }

  function showSources() {
    setValidationMessage("");
    setSourceReturnPage(appPage === "result" ? "result" : "intro");
    setAppPage("sources");
  }

  function returnFromSources() {
    setValidationMessage("");
    setSelectedSourceId("");
    setAppPage(sourceReturnPage);
  }

  function showSourceDetail(id: string) {
    setValidationMessage("");
    setSelectedSourceId(id);
    setAppPage("source-detail");
  }

  function showNewSource() {
    setValidationMessage("");
    setSelectedSourceId("");
    setAppPage("source-new");
  }

  function backToSourceList() {
    setValidationMessage("");
    setAppPage("sources");
  }

  async function saveCredential(input: { id: string; credential?: string; clear?: boolean }) {
    setValidationMessage("");
    await research.updateSourceCredential(input);
  }

  async function toggleSourceEnabled(input: { id: string; enabled: boolean }) {
    setValidationMessage("");
    await research.setSourceEnabled(input);
  }

  async function addSource(input: { definition: Record<string, unknown>; credential?: string }) {
    setValidationMessage("");
    await research.upsertSource(input);
  }

  async function saveSourceDefinition(input: { definition: Record<string, unknown> }) {
    setValidationMessage("");
    return research.upsertSource(input);
  }

  async function deleteSource(input: { id: string }) {
    setValidationMessage("");
    await research.deleteSource(input);
  }

  async function testSource(input: { id: string; definition: Record<string, unknown>; query: string }) {
    setValidationMessage("");
    return research.testSource(input);
  }

  return (
    <main className="workbench" lang={locale}>
      <section className="app-window">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t("appTitle")}</p>
            <h1>{t("appSubtitle")}</h1>
          </div>
          <div className="topbar-actions">
            <LanguageToggle locale={locale} setLocale={setLocale} t={t} />
            <button type="button" className="secondary source-button" onClick={showSources} data-testid="open-source-panel">
              {t("sourcesButton")}
            </button>
          </div>
        </header>

        <div className="app-window-body">
          {appPage === "sources" ? (
            <ResearchSourceListPage
              sources={research.sources}
              isBusy={research.isBusy}
              errorMessage={runtimeErrorMessage || asyncErrorMessage}
              t={t}
              onBack={returnFromSources}
              onAdd={showNewSource}
              onOpenSource={showSourceDetail}
            />
          ) : appPage === "source-detail" ? (
            <ResearchSourceDetailPage
              source={selectedSource}
              isBusy={research.isBusy}
              t={t}
              onBack={backToSourceList}
              onSaveCredential={saveCredential}
              onToggleEnabled={toggleSourceEnabled}
              onSaveDefinition={saveSourceDefinition}
              onDeleteSource={deleteSource}
              onTestSource={testSource}
            />
          ) : appPage === "source-new" ? (
            <ResearchSourceNewPage
              isBusy={research.isBusy}
              t={t}
              onBack={backToSourceList}
              onAddSource={addSource}
            />
          ) : showIntroPage ? (
            <ResearchForm
              isBusy={research.isBusy}
              canStart={ready}
              briefName={briefNameDraft}
              researchNeed={researchNeedDraft}
              t={t}
              stepLabel={stepLabel}
              validationMessage={validationMessage}
              canShowLastResult={hasCompletedResult}
              onBriefNameChange={setBriefNameDraft}
              onResearchNeedChange={setResearchNeedDraft}
              onShowLastResult={showLastResult}
              onStart={start}
              onValidationError={setValidationMessage}
            />
          ) : (
            <section className="page active research-page">
              <div className="result-toolbar">
                <button type="button" className="secondary small-button" onClick={showNewResearch}>
                  {t("newResearchButton")}
                </button>
              </div>
              <StatusPanel job={research.job} message={message} isError={isMessageError} t={t} />
              {research.phase === "role_review" ? (
                <ReviewPanel
                  title={locale === "zh-CN" ? "选择研究角色" : "Choose Research Role"}
                  actionLabel={locale === "zh-CN" ? "重新生成角色" : "Regenerate roles"}
                  instruction={regenInstruction}
                  onInstructionChange={setRegenInstruction}
                  onRegenerate={() => research.regenerateRoles(regenInstruction)}
                >
                  <div className="card-grid">
                    {research.roleCandidates.map((candidate, index) => (
                      <article className="option-card" key={index}>
                        <label>
                          {locale === "zh-CN" ? "角色名称" : "Role"}
                          <input value={candidate.server} onChange={(event) => updateRoleCandidate(index, { server: event.target.value })} />
                        </label>
                        <label>
                          {locale === "zh-CN" ? "角色提示词" : "Role prompt"}
                          <textarea value={candidate.agent_role_prompt} onChange={(event) => updateRoleCandidate(index, { agent_role_prompt: event.target.value })} />
                        </label>
                        {candidate.rationale ? <p className="muted">{candidate.rationale}</p> : null}
                        <button type="button" onClick={() => research.confirmRole(candidate)}>
                          {locale === "zh-CN" ? "选择这个角色" : "Use this role"}
                        </button>
                      </article>
                    ))}
                  </div>
                </ReviewPanel>
              ) : research.phase === "focus_review" ? (
                <ReviewPanel
                  title={locale === "zh-CN" ? "选择研究重点" : "Choose Research Focuses"}
                  actionLabel={locale === "zh-CN" ? "重新生成重点" : "Regenerate focuses"}
                  instruction={regenInstruction}
                  onInstructionChange={setRegenInstruction}
                  onRegenerate={() => research.regenerateFocuses(regenInstruction)}
                >
                  <div className="card-grid">
                    {research.focusCandidates.map((candidate, index) => {
                      const checked = selectedFocusIds.includes(candidate.id);
                      return (
                        <article className="option-card" key={candidate.id}>
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedFocusIds((ids) => checked ? ids.filter((id) => id !== candidate.id) : [...ids, candidate.id].slice(0, 5));
                              }}
                            />
                            {locale === "zh-CN" ? "选择" : "Select"}
                          </label>
                          <textarea value={candidate.text} onChange={(event) => updateFocusCandidate(index, { text: event.target.value })} />
                          {candidate.rationale ? <p className="muted">{candidate.rationale}</p> : null}
                        </article>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={selectedFocusIds.length < 1 || selectedFocusIds.length > 5}
                    onClick={() => research.confirmFocuses(research.focusCandidates.filter((focus) => selectedFocusIds.includes(focus.id)).map((focus) => focus.text))}
                  >
                    {locale === "zh-CN" ? "确认研究重点" : "Confirm focuses"}
                  </button>
                </ReviewPanel>
              ) : research.phase === "outline_review" ? (
                <ReviewPanel
                  title={locale === "zh-CN" ? "确认研究大纲" : "Confirm Research Outline"}
                  actionLabel={locale === "zh-CN" ? "重新生成大纲" : "Regenerate outline"}
                  instruction={regenInstruction}
                  onInstructionChange={setRegenInstruction}
                  onRegenerate={() => research.regenerateOutline(regenInstruction)}
                >
                  <div className="outline-list">
                    {research.outlineDraft.map((section, index) => (
                      <article className="option-card" key={section.id}>
                        <div className="section-card-header">
                          <strong>{section.id}</strong>
                          <button type="button" className="secondary small-button" onClick={() => deleteOutlineSection(index)}>
                            {locale === "zh-CN" ? "删除" : "Delete"}
                          </button>
                        </div>
                        <label>
                          {locale === "zh-CN" ? "标题" : "Title"}
                          <input value={section.title} onChange={(event) => updateOutlineSection(index, { title: event.target.value })} />
                        </label>
                        <label>
                          {locale === "zh-CN" ? "大纲内容" : "Outline"}
                          <textarea value={section.outline} onChange={(event) => updateOutlineSection(index, { outline: event.target.value })} />
                        </label>
                        <label>
                          {locale === "zh-CN" ? "最大迭代次数" : "Max iterations"}
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={section.max_iterations}
                            onChange={(event) => updateOutlineSection(index, { max_iterations: Number(event.target.value) })}
                          />
                        </label>
                        <div className="source-chip-list">
                          {research.sources.filter((source) => source.enabled && source.credential_status === "configured").map((source) => (
                            <label className="checkbox-row" key={source.id}>
                              <input
                                type="checkbox"
                                checked={section.allowed_source_ids.includes(source.id)}
                                onChange={() => toggleSectionSource(index, source.id)}
                              />
                              {source.name}
                            </label>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="button-row">
                    <button type="button" className="secondary" onClick={addOutlineSection} disabled={research.outlineDraft.length >= 8}>
                      {locale === "zh-CN" ? "添加段落" : "Add section"}
                    </button>
                    <button
                      type="button"
                      disabled={!isOutlineConfirmable(research.outlineDraft)}
                      onClick={() => research.confirmOutlineAndRun(research.outlineDraft)}
                    >
                      {locale === "zh-CN" ? "确认大纲并开始研究" : "Confirm outline and research"}
                    </button>
                  </div>
                </ReviewPanel>
              ) : (
                <>
                  <ResearchTimeline iterations={mergedIterations(research.job)} t={t} />
                  <ReportView result={sourceResult} t={t} />
                </>
              )}
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

function ReviewPanel(props: {
  title: string;
  actionLabel: string;
  instruction: string;
  children: React.ReactNode;
  onInstructionChange(value: string): void;
  onRegenerate(): void;
}) {
  return (
    <section className="guided-panel">
      <div className="guided-panel-header">
        <h2>{props.title}</h2>
        <div className="regen-controls">
          <input
            value={props.instruction}
            placeholder="Optional regeneration instruction"
            onChange={(event) => props.onInstructionChange(event.target.value)}
          />
          <button type="button" className="secondary" onClick={props.onRegenerate}>
            {props.actionLabel}
          </button>
        </div>
      </div>
      {props.children}
    </section>
  );
}

function isOutlineConfirmable(sections: ReportSection[]): boolean {
  return sections.length >= 1 && sections.length <= 8 && sections.every((section) =>
    section.title.trim() &&
    section.outline.trim() &&
    section.allowed_source_ids.length >= 1 &&
    section.max_iterations >= 1 &&
    section.max_iterations <= 10
  );
}

function mergedIterations(job: { iterations?: unknown[]; section_iterations?: Record<string, unknown[]> } | null | undefined) {
  if (!job?.section_iterations) return job?.iterations as Parameters<typeof ResearchTimeline>[0]["iterations"];
  return Object.values(job.section_iterations).flat() as Parameters<typeof ResearchTimeline>[0]["iterations"];
}

export function formatResearchQuery(input: { briefName: string; researchNeed: string }, locale: string): string {
  const briefName = input.briefName.trim();
  const researchNeed = input.researchNeed.trim();
  if (locale === "zh-CN") {
    return [
      briefName ? `研究主题：${briefName}` : "研究主题：未提供",
      "",
      "研究具体内容：",
      researchNeed,
    ].join("\n");
  }
  return [
    briefName ? `Research topic: ${briefName}` : "Research topic: Not provided",
    "",
    "Research need:",
    researchNeed,
  ].join("\n");
}

export function makeStepLabel(input: { phase: string; iteration?: number; maxIterations?: number }): string {
  const max = Math.max(1, input.maxIterations || MAX_RESEARCH_ITERATIONS);
  const current = input.phase === "completed"
    ? max
    : Math.max(1, Math.min(max, Number(input.iteration || 1)));
  return `Step ${current}/${max}`;
}

export function makeIntroStepLabel(maxIterations?: number): string {
  return `Step 1/${Math.max(1, maxIterations || MAX_RESEARCH_ITERATIONS)}`;
}

export function hasCompletedResearchResult(
  job: { status?: string; result?: unknown } | null | undefined,
  result: unknown,
): boolean {
  return job?.status === "completed" && Boolean(result || job.result);
}
