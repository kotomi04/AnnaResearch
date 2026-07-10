import { useEffect, useMemo, useRef, useState } from "react";
import { connectAnnaRuntime } from "./api/annaRuntime";
import { getResearchFileDownloadDescriptors, uploadResearchFilesToAps } from "./api/apsFiles";
import { AnnaResearchApi, createStandaloneApi, type ResearchApi } from "./api/researchApi";
import { DraftGenerationPage } from "./components/DraftGenerationPage";
import { FocusReviewPage } from "./components/FocusReviewPage";
import { LanguageToggle } from "./components/LanguageToggle";
import { OutlineReviewPage } from "./components/OutlineReviewPage";
import { AttachmentPreviewDialog, type AttachmentPreviewKind } from "./components/AttachmentPreviewDialog";
import { ReportDisplayPage } from "./components/ReportDisplayPage";
import { ReportGenerationPage } from "./components/ReportGenerationPage";
import { ResearchForm } from "./components/ResearchForm";
import { ResearchLibraryPage } from "./components/ResearchLibraryPage";
import {
  ResearchSourceDetailPage,
  ResearchSourceListPage,
  ResearchSourceNewPage,
} from "./components/ResearchSourcePanel";
import { RoleReviewPage } from "./components/RoleReviewPage";
import { TaskPickerPage } from "./components/TaskPickerPage";
import { WorkflowStepper } from "./components/WorkflowStepper";
import { MAX_RESEARCH_ITERATIONS, useResearchJob } from "./hooks/useResearchJob";
import type { FocusCandidate, RoleCandidate } from "./hooks/useResearchJob";
import { localizedError, localizedJobMessage } from "./i18n/status";
import { useLocale } from "./i18n/useLocale";
import type { AnnaRuntimeApi, CitationSource, ReportSection, ResearchAttachment } from "./types";
import { summarizePlan } from "./workflow/planSummary";
import { projectGuidedStep, type GuidedStepId } from "./workflow/stepState";

type AppPage = "task-picker" | "workflow" | "library" | "sources" | "source-detail" | "source-new";

interface AttachmentPreviewState {
  kind: AttachmentPreviewKind;
  name: string;
  url: string;
  objectUrl?: string;
}

export function App() {
  const { locale, setLocale, t } = useLocale();
  const [api, setApi] = useState<ResearchApi>(() => createStandaloneApi());
  const [annaRuntime, setAnnaRuntime] = useState<AnnaRuntimeApi | null>(null);
  const [runtimeError, setRuntimeError] = useState<unknown>(null);
  const [validationMessage, setValidationMessage] = useState("");
  const [appPage, setAppPage] = useState<AppPage>("task-picker");
  const [libraryReturnPage, setLibraryReturnPage] = useState<AppPage>("task-picker");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [briefNameDraft, setBriefNameDraft] = useState("");
  const [researchNeedDraft, setResearchNeedDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewState | null>(null);
  const attachmentObjectUrlRef = useRef<string | null>(null);
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
          setAnnaRuntime(anna);
          setApi(new AnnaResearchApi(anna));
        }
      } catch (err) {
        console.warn("[anna-researcher] standalone mode:", err instanceof Error ? err.message : err);
        if (!cancelled) {
          setRuntimeError(err);
          setAnnaRuntime(null);
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
  const sourceResult = useMemo(() => {
    if (requestedStep === "report" && !research.result && research.lastCompletedResult) return research.lastCompletedResult;
    return research.result;
  }, [requestedStep, research.lastCompletedResult, research.result]);
  const projectionJob = requestedStep === "report" && !research.job ? research.lastCompletedJob : research.job;
  const hasCompletedResult = hasCompletedResearchResult(research.lastCompletedJob ?? research.job, research.lastCompletedResult ?? sourceResult);
  const mostRecentJob = research.historyJobs[0] ?? research.job;
  const projection = projectGuidedStep({
    requestedStep,
    phase: research.phase,
    canStart: research.canStart,
    job: projectionJob,
    result: sourceResult,
  });
  const step = projection.current;
  const jobMessage = localizedJobMessage(research.job, t);
  const asyncErrorMessage = research.error ? localizedError(research.error, t) : "";
  const runtimeErrorMessage = runtimeError ? t("runtimeMissing") : "";
  const alertMessage = validationMessage || runtimeErrorMessage || asyncErrorMessage;
  const message = alertMessage || jobMessage.message;
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
    } else if (research.phase === "role_review" || research.phase === "generating_roles") {
      setRequestedStep("role");
    } else if (research.phase === "focus_review" || research.phase === "generating_focuses") {
      setRequestedStep("focus");
    } else if (research.phase === "outline_review" || research.phase === "generating_outline") {
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

  useEffect(() => {
    if (research.job?.confirmed_focuses?.length && research.focusCandidates.length) {
      setSelectedFocusIds(research.focusCandidates.map((focus) => focus.id));
    }
  }, [research.focusCandidates, research.job?.confirmed_focuses]);

  useEffect(() => {
    if (!research.job?.query) return;
    const parsed = parseResearchQuery(research.job.query);
    setBriefNameDraft(parsed.briefName);
    setResearchNeedDraft(parsed.researchNeed);
  }, [research.job?.research_id, research.job?.query]);

  useEffect(() => () => revokeAttachmentObjectUrl(), []);

  function revokeAttachmentObjectUrl() {
    if (!attachmentObjectUrlRef.current) return;
    URL.revokeObjectURL(attachmentObjectUrlRef.current);
    attachmentObjectUrlRef.current = null;
  }

  function showAttachmentPreview(nextPreview: AttachmentPreviewState) {
    revokeAttachmentObjectUrl();
    if (nextPreview.objectUrl) attachmentObjectUrlRef.current = nextPreview.objectUrl;
    setAttachmentPreview(nextPreview);
  }

  function closeAttachmentPreview() {
    setAttachmentPreview(null);
    window.setTimeout(() => revokeAttachmentObjectUrl(), 0);
  }

  function openPendingAttachment(file: File) {
    setValidationMessage("");
    const kind = previewKindForFile(file);
    if (kind === "unsupported") {
      showAttachmentPreview({ kind, name: file.name || "attachment", url: "" });
      return;
    }
    if (kind) {
      const objectUrl = URL.createObjectURL(file);
      showAttachmentPreview({ kind, name: file.name || "attachment", url: objectUrl, objectUrl });
      return;
    }
  }

  async function openUploadedAttachment(attachment: ResearchAttachment) {
    setValidationMessage("");
    const kind = previewKindForAttachment(attachment);
    try {
      if (kind === "unsupported") {
        showAttachmentPreview({ kind, name: attachment.name || "attachment", url: "" });
        return;
      }
      if (!annaRuntime?.files) throw new Error("Anna files API is unavailable.");
      const path = String(attachment.path || "").trim();
      if (!path) throw new Error("Attachment path is missing.");
      const response = await annaRuntime.files.download_url({ path });
      const downloadUrl = String(response.get_url || response.url || "").trim();
      if (!downloadUrl) throw new Error(`Anna files download_url did not return a URL for ${attachment.name || path}.`);
      if (kind) {
        showAttachmentPreview({ kind, name: attachment.name || "attachment", url: downloadUrl });
        return;
      }
    } catch (err) {
      setValidationMessage(localizedError(err, t));
    }
  }

  async function openCitationAttachment(source: Extract<CitationSource, { kind: "attachment" }>) {
    setValidationMessage("");
    const attachment = findAttachmentForCitation(source, [
      ...(research.job?.attachments || []),
      ...(research.lastCompletedJob?.attachments || []),
    ]);
    const name = source.file_name || attachment?.name || "attachment";
    const contentType = source.content_type || attachment?.content_type;
    const path = String(source.path || attachment?.path || "").trim();
    const kind = previewKindForMetadata(name || path, contentType);
    try {
      if (kind === "unsupported") {
        showAttachmentPreview({ kind, name, url: "" });
        return;
      }
      if (!annaRuntime?.files) throw new Error("Anna files API is unavailable.");
      if (!path) throw new Error("Attachment path is missing.");
      const response = await annaRuntime.files.download_url({ path });
      const downloadUrl = String(response.get_url || response.url || "").trim();
      if (!downloadUrl) throw new Error(`Anna files download_url did not return a URL for ${name || path}.`);
      showAttachmentPreview({ kind, name, url: downloadUrl });
    } catch (err) {
      setValidationMessage(localizedError(err, t));
    }
  }

  function start(input: { briefName: string; researchNeed: string }) {
    setValidationMessage("");
    setSelectedRoleIndex(0);
    setSelectedFocusIds([]);
    setRegenInstruction("");
    setRequestedStep("role");
    const attachments = pendingAttachments;
    void research.start(formatResearchQuery(input, locale), {
      onJobCreated: async (createdJob) => {
        if (!attachments.length) return;
        if (!createdJob.research_id) throw new Error("Research job is missing research_id.");
        const uploaded = await uploadResearchFilesToAps({
          filesApi: annaRuntime?.files,
          researchId: createdJob.research_id,
          files: attachments,
        });
        await api.updateResearchJob(createdJob.research_id, { attachments: uploaded });
        const descriptors = await getResearchFileDownloadDescriptors({
          filesApi: annaRuntime?.files,
          agentApi: annaRuntime?.agent,
          researchQuery: createdJob.query,
          attachments: uploaded,
        });
        await api.prepareAttachments(createdJob.research_id, descriptors);
        await api.embedAttachmentChunks(createdJob.research_id);
        await api.summarizeAttachments(createdJob.research_id, { query: createdJob.query, top_k: 6 });
        setPendingAttachments((current) => current.filter((file) => !attachments.includes(file)));
      },
    });
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
    if (canResumeResearchJob(research.job)) {
      void research.resumeResearchJob();
      return;
    }
    void research.confirmOutlineAndRun(research.outlineDraft);
  }

  function showSources() {
    if (!projection.canOpenSources) return;
    setValidationMessage("");
    setAppPage("sources");
  }

  function showLibrary() {
    setValidationMessage("");
    void research.refreshHistoryJobs().catch((err) => setValidationMessage(localizedError(err, t)));
    setLibraryReturnPage(appPage === "library" ? "task-picker" : appPage);
    setAppPage("library");
  }

  function showNewResearch() {
    setValidationMessage("");
    setBriefNameDraft("");
    setResearchNeedDraft("");
    setPendingAttachments([]);
    setSelectedRoleIndex(0);
    setSelectedFocusIds([]);
    setRegenInstruction("");
    setRequestedStep("need");
    setAppPage("workflow");
    research.resetForNewResearch();
  }

  function showTaskPicker() {
    setValidationMessage("");
    void research.refreshHistoryJobs().catch((err) => setValidationMessage(localizedError(err, t)));
    setAppPage("task-picker");
  }

  function goBackFromLibrary() {
    setValidationMessage("");
    setAppPage(libraryReturnPage === "library" ? "task-picker" : libraryReturnPage);
  }

  function continueLatestTask() {
    setValidationMessage("");
    const recentId = mostRecentJob?.research_id;
    if (recentId) {
      void openHistoryTask(recentId).catch((err) => setValidationMessage(localizedError(err, t)));
      return;
    }
    if (hasCompletedResult) {
      setRequestedStep("report");
      setAppPage("workflow");
    }
  }

  async function openHistoryTask(researchId: string) {
    setValidationMessage("");
    const selected = await research.openResearchJob(researchId);
    if (selected?.status === "completed" && selected.result) {
      setRequestedStep("report");
    } else if (canResumeResearchJob(selected)) {
      setRequestedStep("generate");
      void research.resumeResearchJob(researchId).catch((err) => setValidationMessage(localizedError(err, t)));
    } else {
      setRequestedStep("need");
    }
    setAppPage("workflow");
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
          <div className="brand-block">
            <span className="brand-icon" aria-hidden="true">/</span>
            <h1>{t("appTitle")}</h1>
          </div>
          <div className="topbar-actions">
            <LanguageToggle locale={locale} setLocale={setLocale} t={t} />
            <button type="button" className="secondary source-button" onClick={showLibrary} disabled={research.isBusy}>
              {t("libraryButton")}
            </button>
            {projection.canOpenSources ? (
              <button type="button" className="secondary source-button" onClick={showSources} data-testid="open-source-panel">
                {t("sourcesButton")}
              </button>
            ) : null}
          </div>
        </header>

        <div className="app-window-body">
          {appPage === "task-picker" ? (
            <TaskPickerPage
              jobs={research.historyJobs}
              canContinue={Boolean(mostRecentJob?.research_id) || hasCompletedResult}
              isBusy={research.isBusy}
              message={alertMessage}
              workspacePath={research.settings?.research_root}
              t={t}
              onCreate={showNewResearch}
              onContinue={continueLatestTask}
              onOpenLibrary={showLibrary}
              onOpenTask={(researchId) => {
                void openHistoryTask(researchId).catch((err) => setValidationMessage(localizedError(err, t)));
              }}
            />
          ) : appPage === "library" ? (
            <ResearchLibraryPage
              jobs={research.historyJobs}
              currentJob={research.job}
              isBusy={research.isBusy}
              errorMessage={alertMessage}
              t={t}
              onBack={goBackFromLibrary}
              onCreate={showNewResearch}
              onOpen={(researchId) => {
                void openHistoryTask(researchId).catch((err) => setValidationMessage(localizedError(err, t)));
              }}
            />
          ) : appPage === "sources" ? (
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
              onToggleEnabled={toggleSourceEnabled}
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
            <div className="workflow-pages">
              <WorkflowStepper
                current={step}
                completed={projection.completedSteps}
                available={projection.availableSteps}
                locked={projection.locked}
                t={t}
                onNavigate={setRequestedStep}
              />
              {research.phase === "generating_roles" ? (
                <DraftGenerationPage
                  stepLabel={t("stepRole")}
                  title={t("generatingRolesTitle")}
                  message={t("generatingRolesMessage")}
                  t={t}
                />
              ) : research.phase === "generating_focuses" ? (
                <DraftGenerationPage
                  stepLabel={t("stepFocus")}
                  title={t("generatingFocusesTitle")}
                  message={t("generatingFocusesMessage")}
                  t={t}
                />
              ) : research.phase === "generating_outline" ? (
                <DraftGenerationPage
                  stepLabel={t("stepOutline")}
                  title={t("generatingOutlineTitle")}
                  message={t("generatingOutlineMessage")}
                  t={t}
                />
              ) : step === "need" ? (
                <ResearchForm
                  isBusy={research.isBusy}
                  canStart={research.canStart}
                  briefName={briefNameDraft}
                  researchNeed={researchNeedDraft}
                  attachments={pendingAttachments}
                  uploadedAttachments={research.job?.attachments || []}
                  t={t}
                  stepLabel={makeIntroStepLabel(research.job?.max_iterations)}
                  validationMessage={alertMessage}
                  canShowLastResult={hasCompletedResult}
                  onOpenLibrary={showLibrary}
                  onBriefNameChange={setBriefNameDraft}
                  onResearchNeedChange={setResearchNeedDraft}
                  onAttachmentAdd={(files) => setPendingAttachments((current) => [...current, ...files])}
                  onAttachmentOpen={openPendingAttachment}
                  onAttachmentRemove={(index) => setPendingAttachments((current) => current.filter((_, idx) => idx !== index))}
                  onUploadedAttachmentOpen={(file) => void openUploadedAttachment(file)}
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
                  isBusy={research.isBusy}
                  t={t}
                  onNewResearch={showNewResearch}
                  onSemanticRewrite={research.semanticRewriteSelection}
                  onSemanticRewritePreview={research.previewSemanticRewriteSelection}
                  onApplySemanticRewrite={research.applySemanticRewriteProposal}
                  onDiscardSemanticRewrite={research.discardSemanticRewriteProposal}
                  onManualReportSave={research.saveManualReportMarkdown}
                  onAttachmentOpen={(source) => void openCitationAttachment(source)}
                />
              )}
              {attachmentPreview ? (
                <AttachmentPreviewDialog
                  kind={attachmentPreview.kind}
                  name={attachmentPreview.name}
                  url={attachmentPreview.url}
                  t={t}
                  onClose={closeAttachmentPreview}
                />
              ) : null}
            </div>
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

export function parseResearchQuery(query: string): { briefName: string; researchNeed: string } {
  const text = String(query || "").trim();
  const zh = /^研究主题：([\s\S]*?)\n\s*\n研究具体内容：\n?([\s\S]*)$/u.exec(text);
  if (zh) return { briefName: zh[1].trim(), researchNeed: zh[2].trim() };
  const en = /^Research topic: ([\s\S]*?)\n\s*\nResearch need:\n?([\s\S]*)$/u.exec(text);
  if (en) return { briefName: en[1].trim(), researchNeed: en[2].trim() };
  return { briefName: "", researchNeed: text };
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

function previewKindForFile(file: File): AttachmentPreviewKind {
  return previewKindForMetadata(file.name, file.type);
}

function previewKindForAttachment(attachment: ResearchAttachment): AttachmentPreviewKind {
  return previewKindForMetadata(attachment.name || attachment.path, attachment.content_type);
}

function findAttachmentForCitation(source: Extract<CitationSource, { kind: "attachment" }>, attachments: ResearchAttachment[]): ResearchAttachment | null {
  const path = String(source.path || "").trim();
  const fileName = String(source.file_name || "").trim();
  return (
    attachments.find((attachment) => path && attachment.path === path) ||
    attachments.find((attachment) => fileName && attachment.name === fileName) ||
    null
  );
}

function previewKindForMetadata(nameValue?: string, contentTypeValue?: string): AttachmentPreviewKind {
  const name = String(nameValue || "").toLowerCase();
  const contentType = String(contentTypeValue || "").toLowerCase();
  if (contentType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name)) return "image";
  if (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    /\.(txt|md|markdown|csv|tsv|json)$/i.test(name)
  ) {
    return "text";
  }
  return "unsupported";
}

export function hasCompletedResearchResult(
  job: { status?: string; result?: unknown } | null | undefined,
  result: unknown,
): boolean {
  return job?.status === "completed" && Boolean(result || job.result);
}

export function canResumeResearchJob(
  job: { status?: string; confirmed_role?: unknown; confirmed_focuses?: unknown[]; confirmed_outline?: unknown[] } | null | undefined,
): boolean {
  return job?.status !== "completed" && Boolean(job?.confirmed_role && job.confirmed_focuses?.length && job.confirmed_outline?.length);
}
