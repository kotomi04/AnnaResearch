import { useEffect, useMemo, useState } from "react";
import { connectAnnaRuntime } from "./api/annaRuntime";
import { AnnaResearchApi, createStandaloneApi, type ResearchApi } from "./api/researchApi";
import { FocusReviewPage } from "./components/FocusReviewPage";
import { LanguageToggle } from "./components/LanguageToggle";
import { OutlineReviewPage } from "./components/OutlineReviewPage";
import { ReportDisplayPage } from "./components/ReportDisplayPage";
import { ReportGenerationPage } from "./components/ReportGenerationPage";
import { ResearchForm } from "./components/ResearchForm";
import {
  ResearchSourceDetailPage,
  ResearchSourceListPage,
  ResearchSourceNewPage,
} from "./components/ResearchSourcePanel";
import { RoleReviewPage } from "./components/RoleReviewPage";
import { WorkflowStepper } from "./components/WorkflowStepper";
import { MAX_RESEARCH_ITERATIONS, useResearchJob } from "./hooks/useResearchJob";
import type { FocusCandidate, RoleCandidate } from "./hooks/useResearchJob";
import { localizedError, localizedJobMessage } from "./i18n/status";
import { useLocale } from "./i18n/useLocale";
import type { ReportSection } from "./types";
import { summarizePlan } from "./workflow/planSummary";
import { projectGuidedStep, type GuidedStepId } from "./workflow/stepState";

type AppPage = "workflow" | "sources" | "source-detail" | "source-new";

export function App() {
  const { locale, setLocale, t } = useLocale();
  const [api, setApi] = useState<ResearchApi>(() => createStandaloneApi());
  const [runtimeError, setRuntimeError] = useState<unknown>(null);
  const [validationMessage, setValidationMessage] = useState("");
  const [appPage, setAppPage] = useState<AppPage>("workflow");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [briefNameDraft, setBriefNameDraft] = useState("");
  const [researchNeedDraft, setResearchNeedDraft] = useState("");
  const [selectedRoleIndex, setSelectedRoleIndex] = useState(0);
  const [selectedFocusIds, setSelectedFocusIds] = useState<string[]>([]);
  const [regenInstruction, setRegenInstruction] = useState("");
  const [requestedStep, setRequestedStep] = useState<GuidedStepId | undefined>("need");

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
  const sourceResult = useMemo(() => research.result, [research.result]);
  const hasCompletedResult = hasCompletedResearchResult(research.job, sourceResult);
  const projection = projectGuidedStep({
    requestedStep,
    phase: research.phase,
    canStart: research.canStart,
    job: research.job,
    result: sourceResult,
  });
  const step = projection.current;
  const jobMessage = localizedJobMessage(research.job, t);
  const asyncErrorMessage = research.error ? localizedError(research.error, t) : "";
  const runtimeErrorMessage = runtimeError ? t("runtimeMissing") : "";
  const message = validationMessage || runtimeErrorMessage || asyncErrorMessage || jobMessage.message;
  const isMessageError = Boolean(validationMessage || runtimeErrorMessage || asyncErrorMessage || jobMessage.isError);
  const selectedSource = useMemo(
    () => research.sources.find((source) => source.id === selectedSourceId) ?? null,
    [research.sources, selectedSourceId],
  );
  const planSummary = summarizePlan({
    role: research.job?.confirmed_role,
    focuses: research.job?.confirmed_focuses,
    sections: research.outlineDraft.length ? research.outlineDraft : research.job?.confirmed_outline,
  });

  useEffect(() => {
    if (research.phase === "settings_required") {
      setRequestedStep("need");
    } else if (research.phase === "role_review") {
      setRequestedStep("role");
    } else if (research.phase === "focus_review") {
      setRequestedStep("focus");
    } else if (research.phase === "outline_review") {
      setRequestedStep("outline");
    } else if (research.phase === "running") {
      setRequestedStep("generate");
    } else if (research.phase === "completed") {
      setRequestedStep("report");
    }
  }, [research.phase]);

  useEffect(() => {
    if (research.roleCandidates.length && selectedRoleIndex >= research.roleCandidates.length) {
      setSelectedRoleIndex(0);
    }
  }, [research.roleCandidates.length, selectedRoleIndex]);

  function start(input: { briefName: string; researchNeed: string }) {
    setValidationMessage("");
    setSelectedRoleIndex(0);
    setSelectedFocusIds([]);
    setRegenInstruction("");
    setRequestedStep("role");
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

  function moveOutlineSection(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= research.outlineDraft.length) return;
    const next = [...research.outlineDraft];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    research.setOutlineDraft(next.map((section, idx) => ({ ...section, id: `section-${idx + 1}` })));
  }

  function toggleSectionSource(index: number, sourceId: string) {
    const section = research.outlineDraft[index];
    if (!section) return;
    const current = new Set(section.allowed_source_ids);
    if (current.has(sourceId)) current.delete(sourceId);
    else current.add(sourceId);
    updateOutlineSection(index, { allowed_source_ids: Array.from(current).sort() });
  }

  function confirmRole() {
    const role = research.roleCandidates[selectedRoleIndex];
    if (!role) return;
    setRegenInstruction("");
    void research.confirmRole(role);
  }

  function confirmFocuses() {
    const focuses = research.focusCandidates.filter((focus) => selectedFocusIds.includes(focus.id)).map((focus) => focus.text);
    setRegenInstruction("");
    void research.confirmFocuses(focuses);
  }

  function startGeneration() {
    setRegenInstruction("");
    setRequestedStep("generate");
    void research.confirmOutlineAndRun(research.outlineDraft);
  }

  function showSources() {
    if (!projection.canOpenSources) return;
    setValidationMessage("");
    setAppPage("sources");
  }

  function showNewResearch() {
    setValidationMessage("");
    setSelectedRoleIndex(0);
    setSelectedFocusIds([]);
    setRegenInstruction("");
    setRequestedStep("need");
    setAppPage("workflow");
    research.resetForNewResearch();
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
            {projection.canOpenSources ? (
              <button type="button" className="secondary source-button" onClick={showSources} data-testid="open-source-panel">
                {t("sourcesButton")}
              </button>
            ) : null}
          </div>
        </header>

        <div className="app-window-body">
          {appPage === "sources" ? (
            <ResearchSourceListPage
              sources={research.sources}
              isBusy={research.isBusy}
              errorMessage={runtimeErrorMessage || asyncErrorMessage}
              t={t}
              onBack={() => setAppPage("workflow")}
              onAdd={() => {
                setSelectedSourceId("");
                setAppPage("source-new");
              }}
              onOpenSource={(id) => {
                setSelectedSourceId(id);
                setAppPage("source-detail");
              }}
            />
          ) : appPage === "source-detail" ? (
            <ResearchSourceDetailPage
              source={selectedSource}
              isBusy={research.isBusy}
              t={t}
              onBack={() => setAppPage("sources")}
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
              onBack={() => setAppPage("sources")}
              onAddSource={addSource}
            />
          ) : (
            <>
              <WorkflowStepper
                current={step}
                completed={projection.completedSteps}
                available={projection.availableSteps}
                locked={projection.locked}
                t={t}
                onNavigate={setRequestedStep}
              />
              {step === "need" ? (
                <ResearchForm
                  isBusy={research.isBusy}
                  canStart={research.canStart}
                  briefName={briefNameDraft}
                  researchNeed={researchNeedDraft}
                  t={t}
                  stepLabel={makeIntroStepLabel(research.job?.max_iterations)}
                  validationMessage={message}
                  canShowLastResult={hasCompletedResult}
                  onBriefNameChange={setBriefNameDraft}
                  onResearchNeedChange={setResearchNeedDraft}
                  onShowLastResult={() => setRequestedStep("report")}
                  onStart={start}
                  onValidationError={setValidationMessage}
                />
              ) : step === "role" ? (
                <RoleReviewPage
                  candidates={research.roleCandidates}
                  selectedIndex={selectedRoleIndex}
                  instruction={regenInstruction}
                  isBusy={research.isBusy}
                  t={t}
                  onSelectedIndexChange={setSelectedRoleIndex}
                  onCandidateChange={updateRoleCandidate}
                  onInstructionChange={setRegenInstruction}
                  onRegenerate={() => research.regenerateRoles(regenInstruction)}
                  onBack={() => setRequestedStep("need")}
                  onConfirm={confirmRole}
                />
              ) : step === "focus" ? (
                <FocusReviewPage
                  candidates={research.focusCandidates}
                  selectedIds={selectedFocusIds}
                  instruction={regenInstruction}
                  summary={planSummary}
                  isBusy={research.isBusy}
                  t={t}
                  onSelectedIdsChange={setSelectedFocusIds}
                  onCandidateChange={updateFocusCandidate}
                  onInstructionChange={setRegenInstruction}
                  onRegenerate={() => research.regenerateFocuses(regenInstruction)}
                  onBack={() => setRequestedStep("role")}
                  onConfirm={confirmFocuses}
                />
              ) : step === "outline" ? (
                <OutlineReviewPage
                  sections={research.outlineDraft}
                  sources={research.sources}
                  instruction={regenInstruction}
                  summary={planSummary}
                  isBusy={research.isBusy}
                  t={t}
                  onSectionChange={updateOutlineSection}
                  onAddSection={addOutlineSection}
                  onDeleteSection={deleteOutlineSection}
                  onMoveSection={moveOutlineSection}
                  onToggleSectionSource={toggleSectionSource}
                  onInstructionChange={setRegenInstruction}
                  onRegenerate={() => research.regenerateOutline(regenInstruction)}
                  onBack={() => setRequestedStep("focus")}
                  onStartGeneration={startGeneration}
                />
              ) : step === "generate" ? (
                <ReportGenerationPage
                  job={research.job}
                  events={research.runEvents}
                  previews={research.sectionPreviews}
                  sources={research.sources}
                  summary={planSummary}
                  message={message}
                  isError={isMessageError}
                  t={t}
                />
              ) : (
                <ReportDisplayPage
                  result={sourceResult}
                  events={research.runEvents}
                  previews={research.sectionPreviews}
                  t={t}
                  onNewResearch={showNewResearch}
                />
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
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
