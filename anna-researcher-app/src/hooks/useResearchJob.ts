import { useCallback, useEffect, useRef, useState } from "react";
import { collectAgentText } from "../api/agentSession";
import type { ResearchApi } from "../api/researchApi";
import type {
  AnnaAgentSession,
  CitationSource,
  ConfirmedResearchRole,
  IterationEntry,
  ReportFraming,
  ReportSection,
  ResearchJob,
  ResearchPhase,
  ResearchResult,
  ResearchSourceTestResult,
  ResearchSourceView,
  ToolSettings,
} from "../types";
import {
  makeLiveRunEvent,
  projectSectionPreviews,
  projectStoredRunEvents,
  sectionPreview,
  sourceCallEvent,
  type RunEvent,
  type SectionPreview,
} from "../workflow/runEvents";

export const MAX_RESEARCH_ITERATIONS = 5;

export interface RoleCandidate extends ConfirmedResearchRole {
  rationale?: string;
}

export interface FocusCandidate {
  id: string;
  text: string;
  rationale?: string;
}

interface CitationReference {
  number: number;
  source: CitationSource;
}

interface DecideCallSource {
  type: "call_source";
  source_id?: string;
  queries: string[];
}

interface DecideFinish {
  type: "finish";
  reason?: string;
}

type Decision = DecideCallSource | DecideFinish;

interface SectionRunResult {
  section: ReportSection;
  markdown: string;
  summary: string;
  sourceUrls: string[];
  citationSources: CitationSource[];
}

export interface CommentReference {
  number: number;
  url: string;
  scope: "selected" | "nearby" | "section" | "fresh";
}

export interface SemanticRewriteInput {
  selectedText: string;
  instruction: string;
  refreshResearch?: boolean;
}

export interface SemanticRewriteResult {
  proposalId?: string;
  rewrittenText: string;
  originalText?: string;
  targetKind: "section" | "title" | "introduction" | "conclusion";
  sectionId?: string;
  sectionTitle?: string;
  references?: CommentReference[];
}

export interface ManualReportSaveInput {
  reportMarkdown: string;
}

interface StartOptions {
  regenerationInstruction?: string;
  onJobCreated?: (job: ResearchJob) => Promise<void> | void;
}

export function useResearchJob(api: ResearchApi) {
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [lastCompletedJob, setLastCompletedJob] = useState<ResearchJob | null>(null);
  const [lastCompletedResult, setLastCompletedResult] = useState<ResearchResult | null>(null);
  const [historyJobs, setHistoryJobs] = useState<ResearchJob[]>([]);
  const [settings, setSettings] = useState<ToolSettings | null>(null);
  const [sources, setSources] = useState<ResearchSourceView[]>([]);
  const [phase, setPhase] = useState<ResearchPhase>("idle");
  const [error, setError] = useState<unknown>(null);
  const [roleCandidates, setRoleCandidates] = useState<RoleCandidate[]>([]);
  const [focusCandidates, setFocusCandidates] = useState<FocusCandidate[]>([]);
  const [outlineDraft, setOutlineDraft] = useState<ReportSection[]>([]);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [sectionPreviews, setSectionPreviews] = useState<SectionPreview[]>([]);
  const runIdRef = useRef(0);
  const rewriteDraftsRef = useRef(new Map<string, SemanticRewriteDraft>());

  const refreshSources = useCallback(async () => {
    const next = await api.listResearchSources();
    setSources(next);
    return next;
  }, [api]);

  const refreshSettings = useCallback(async () => {
    const [nextSettings, nextSources] = await Promise.all([api.getSettings(), api.listResearchSources()]);
    setSettings(nextSettings);
    setSources(nextSources);
    if (!hasConfiguredSource(nextSources)) setPhase("settings_required");
    return { settings: nextSettings, sources: nextSources };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      try {
        const [nextSettings, nextSources] = await Promise.all([api.getSettings(), api.listResearchSources()]);
        if (cancelled) return;
        setSettings(nextSettings);
        setSources(nextSources);
        const latest = await api.getResearchJob();
        const history = await api.listResearchJobs({ limit: 50 }).catch(() => []);
        if (cancelled) return;
        setError(null);
        setJob(latest);
        setResult(latest?.result || null);
        setHistoryJobs(history);
        setRoleCandidates(roleCandidatesFromJob(latest));
        setFocusCandidates(focusCandidatesFromJob(latest));
        setRunEvents(projectStoredRunEvents(latest));
        setSectionPreviews(projectSectionPreviews(latest));
        if (latest?.status === "completed" && latest.result) {
          setLastCompletedJob(latest);
          setLastCompletedResult(latest.result);
        }
        const ready = hasConfiguredSource(nextSources);
        if (!ready) setPhase("settings_required");
        else if (latest?.status === "completed" && latest.result) setPhase("completed");
        else setPhase("idle");
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setPhase("failed");
        }
      }
    }
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const refreshHistoryJobs = useCallback(async () => {
    const jobs = await api.listResearchJobs({ limit: 50 });
    setHistoryJobs(jobs);
    return jobs;
  }, [api]);

  const openResearchJob = useCallback(
    async (researchId: string) => {
      const selected = await api.getResearchJob(researchId);
      setError(null);
      setJob(selected);
      setResult(selected?.result || null);
      setRoleCandidates(roleCandidatesFromJob(selected));
      setFocusCandidates(focusCandidatesFromJob(selected));
      setOutlineDraft(selected?.confirmed_outline || []);
      setRunEvents(projectStoredRunEvents(selected));
      setSectionPreviews(projectSectionPreviews(selected));
      if (selected?.status === "completed" && selected.result) {
        setLastCompletedJob(selected);
        setLastCompletedResult(selected.result);
        setPhase("completed");
      } else if (selected?.status === "failed") {
        setPhase("failed");
      } else {
        setPhase(hasConfiguredSource(sources) ? "idle" : "settings_required");
      }
      void refreshHistoryJobs().catch(() => undefined);
      return selected;
    },
    [api, refreshHistoryJobs, sources],
  );

  const applySourceUpdate = useCallback(
    (next: ResearchSourceView) => {
      const updated = sources.map((source) => (source.id === next.id ? next : source));
      if (!updated.some((source) => source.id === next.id)) updated.push(next);
      setSources(updated);
      const ready = hasConfiguredSource(updated);
      if (!ready) setPhase("settings_required");
      return updated;
    },
    [sources],
  );

  const updateSourceCredential = useCallback(
    async (input: { id: string; credential?: string; clear?: boolean }) => applySourceUpdate(await api.updateResearchSourceCredential(input)),
    [api, applySourceUpdate],
  );

  const setSourceEnabled = useCallback(
    async (input: { id: string; enabled: boolean }) => applySourceUpdate(await api.setResearchSourceEnabled(input)),
    [api, applySourceUpdate],
  );

  const upsertSource = useCallback(
    async (input: { definition: Record<string, unknown>; credential?: string }) => applySourceUpdate(await api.upsertResearchSource(input)),
    [api, applySourceUpdate],
  );

  const deleteSource = useCallback(
    async (input: { id: string }) => {
      const deleted = await api.deleteResearchSource(input);
      const remaining = sources.filter((source) => source.id !== input.id);
      setSources(remaining);
      if (!hasConfiguredSource(remaining)) setPhase("settings_required");
      return deleted;
    },
    [api, sources],
  );

  const testSource = useCallback(
    async (input: { id: string; definition: Record<string, unknown>; query: string }): Promise<ResearchSourceTestResult> => api.testResearchSource(input),
    [api],
  );

  const resetForNewResearch = useCallback(() => {
    runIdRef.current += 1;
    setJob(null);
    setResult(null);
    setError(null);
    setRoleCandidates([]);
    setFocusCandidates([]);
    setOutlineDraft([]);
    setRunEvents([]);
    setSectionPreviews([]);
    setPhase(hasConfiguredSource(sources) ? "idle" : "settings_required");
  }, [sources]);

  const start = useCallback(
    async (query: string, options: StartOptions | string = {}) => {
      const regenerationInstruction = typeof options === "string" ? options : options.regenerationInstruction || "";
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      setPhase("generating_roles");
      setError(null);
      setResult(null);
      setFocusCandidates([]);
      setOutlineDraft([]);
      setRunEvents([]);
      setSectionPreviews([]);
      try {
        const current = await refreshSettings();
        void refreshHistoryJobs().catch(() => undefined);
        if (!hasConfiguredSource(current.sources)) {
          setPhase("settings_required");
          return;
        }
        const nextJob = await api.createResearchJob({ query });
        if (runId !== runIdRef.current) return;
        setJob(nextJob);
        if (typeof options !== "string" && options.onJobCreated) {
          await options.onJobCreated(nextJob);
          if (runId !== runIdRef.current) return;
          const refreshed = await api.getResearchJob(nextJob.research_id);
          if (runId !== runIdRef.current) return;
          if (refreshed) setJob(refreshed);
        }
        const activeJob = (await api.getResearchJob(nextJob.research_id).catch(() => null)) || nextJob;
        setJob(activeJob);
        const candidates = await generateRoleCandidates(api, query, regenerationInstruction);
        if (runId !== runIdRef.current) return;
        setRoleCandidates(candidates);
        setPhase("role_review");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, refreshSettings],
  );

  const regenerateRoles = useCallback(
    async (instruction = "") => {
      const query = job?.query || "";
      if (!query) return;
      setPhase("generating_roles");
      try {
        setRoleCandidates(await generateRoleCandidates(api, query, instruction));
        setPhase("role_review");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, job?.query],
  );

  const confirmRole = useCallback(
    async (role: ConfirmedResearchRole) => {
      if (!job?.research_id) throw new Error("Research job is missing research_id.");
      setPhase("generating_focuses");
      try {
        const saved = await api.saveConfirmedResearchRole(job.research_id, role);
        setJob({ ...job, ...saved, confirmed_role: role });
        const candidates = await generateFocusCandidates(api, promptQueryForJob(job), role);
        setFocusCandidates(candidates);
        setPhase("focus_review");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, job],
  );

  const regenerateFocuses = useCallback(
    async (instruction = "") => {
      const role = job?.confirmed_role;
      if (!job?.query || !role) return;
      setPhase("generating_focuses");
      try {
        setFocusCandidates(await generateFocusCandidates(api, promptQueryForJob(job), role, instruction));
        setPhase("focus_review");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, job?.confirmed_role, job?.query],
  );

  const confirmFocuses = useCallback(
    async (focuses: string[]) => {
      if (!job?.research_id || !job.confirmed_role) throw new Error("Research job is not ready for focus confirmation.");
      setPhase("generating_outline");
      try {
        const saved = await api.saveConfirmedResearchFocuses(job.research_id, focuses);
        setJob({ ...job, ...saved, confirmed_focuses: focuses });
        const outline = await generateOutlineDraft(api, promptQueryForJob(job), job.confirmed_role, focuses);
        const assigned = await assignAllowedSources(api, outline, readyEnabledSources(sources));
        setOutlineDraft(assigned);
        setPhase("outline_review");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, job, sources],
  );

  const regenerateOutline = useCallback(
    async (instruction = "") => {
      if (!job?.query || !job.confirmed_role || !job.confirmed_focuses?.length) return;
      setPhase("generating_outline");
      try {
        const outline = await generateOutlineDraft(api, promptQueryForJob(job), job.confirmed_role, job.confirmed_focuses, instruction);
        setOutlineDraft(await assignAllowedSources(api, outline, readyEnabledSources(sources), instruction));
        setPhase("outline_review");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, job?.confirmed_focuses, job?.confirmed_role, job?.query, sources],
  );

  const runConfirmedSections = useCallback(
    async (sections: ReportSection[], options: { resume?: boolean; baseJob?: ResearchJob | null } = {}) => {
      const initialJob = options.baseJob || job;
      if (!initialJob?.research_id) throw new Error("Research job is missing research_id.");
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      setPhase("running");
      try {
        let currentJob = options.resume ? initialJob : await api.saveConfirmedResearchOutline(initialJob.research_id, sections);
        const confirmedSections = currentJob.confirmed_outline?.length ? currentJob.confirmed_outline : sections;
        const role = currentJob.confirmed_role || initialJob.confirmed_role;
        const focuses = currentJob.confirmed_focuses || initialJob.confirmed_focuses || [];
        if (!role || !focuses.length || !confirmedSections.length) throw new Error("Research job is not ready to run.");
        setRunEvents(options.resume ? projectStoredRunEvents(currentJob) : []);
        setSectionPreviews(options.resume ? projectSectionPreviews(currentJob) : []);
        setOutlineDraft(confirmedSections);
        setJob(currentJob);
        const sectionResults: SectionRunResult[] = [];
        const citationRegistry: CitationSource[] = [];
        for (let index = 0; index < confirmedSections.length; index++) {
          const section = confirmedSections[index];
          const reusable = options.resume ? reusableSectionResult(section, currentJob.section_results?.[section.id]) : null;
          if (reusable) {
            registerCitationSources(citationRegistry, reusable.citationSources);
            sectionResults.push(reusable);
            continue;
          }
          appendRunEvent(setRunEvents, {
            kind: "section_started",
            sectionId: section.id,
            sectionTitle: section.title,
            title: section.title,
            detail: `${index + 1}/${confirmedSections.length}`,
          });
          currentJob = await updateJob(api, currentJob, {
            status: "running",
            stage: "section_research",
            active_section_index: index,
            progress: Math.min(90, 35 + Math.round((index / confirmedSections.length) * 50)),
          });
          setJob(currentJob);
          if (runId !== runIdRef.current) return;
          const sectionResult = await runSection({
            api,
            job: currentJob,
            section,
            reportOutline: confirmedSections,
            priorSectionResults: sectionResults,
            role,
            focuses,
            sources: readyEnabledSources(sources),
            citationRegistry,
            onEvent: (event) => appendRunEvent(setRunEvents, event),
          });
          sectionResults.push({ section, ...sectionResult });
          setSectionPreviews((previews) => upsertPreview(previews, sectionPreview(section, sectionResult)));
          const refreshedJob = await api.getResearchJob(initialJob.research_id);
          currentJob = refreshedJob ? mergeSectionResults(refreshedJob, currentJob.section_results) : currentJob;
          setJob(currentJob);
        }
        appendRunEvent(setRunEvents, {
          kind: "report_framing",
          title: "Report framing",
          detail: `${confirmedSections.length} section summaries`,
        });
        currentJob = await updateJob(api, currentJob, { stage: "report_framing", progress: 94 });
        setJob(currentJob);
        const framing = await generateReportFraming(api, currentJob.query || initialJob.query || "", focuses, confirmedSections, sectionResults);
        currentJob = await api.saveReportFraming({ research_id: initialJob.research_id, framing });
        const reportMarkdown = assembleReport(framing, sectionResults);
        const citationSources = citationRegistry.length ? [...citationRegistry] : citationSourcesFromUrls(sortedUnique(sectionResults.flatMap((section) => section.sourceUrls)));
        const sourceUrls = citationSources.filter(isUrlCitationSource).map((source) => source.url);
        appendRunEvent(setRunEvents, {
          kind: "final_assembly",
          title: "Final assembly",
          detail: `${sourceUrls.length} sources`,
          count: sourceUrls.length,
        });
        currentJob = await api.saveAssembledResearchResult({ research_id: initialJob.research_id, report_markdown: reportMarkdown, source_urls: sourceUrls, citation_sources: citationSources });
        const completedResult = currentJob.result || { research_id: initialJob.research_id, report_markdown: reportMarkdown, source_urls: sourceUrls, citation_sources: citationSources, status: "completed" };
        setJob(currentJob);
        setResult(completedResult);
        setLastCompletedJob(currentJob);
        setLastCompletedResult(completedResult);
        void refreshHistoryJobs().catch(() => undefined);
        setPhase("completed");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, job, sources],
  );

  const confirmOutlineAndRun = useCallback(
    async (sections: ReportSection[]) => {
      setRunEvents([]);
      setSectionPreviews([]);
      await runConfirmedSections(sections);
    },
    [runConfirmedSections],
  );

  const previewSemanticRewriteSelection = useCallback(
    async (input: SemanticRewriteInput): Promise<SemanticRewriteResult> => {
      const selectedText = input.selectedText.trim();
      const instruction = input.instruction.trim();
      if (!selectedText) throw new Error("Select report text to rewrite.");
      if (!instruction) throw new Error("Enter a rewrite instruction.");
      if (!job?.research_id) throw new Error("Research job is missing research_id.");
      const hydratedJob = await hydrateCompletedSectionResults(api, job);
      const target = findRewriteTarget(hydratedJob, selectedText);
      if (!target) throw new Error("The selected text was not found in the completed report.");
      const beforeCitations = extractCitations(target.selectedText);
      const researchContext = input.refreshResearch
        ? await refreshRewriteResearchContext(api, {
            job: hydratedJob,
            target,
            instruction,
            sources: readyEnabledSources(sources),
          })
        : null;
      const references = researchContext?.references || target.references;
      const rewrittenText = await rewriteTargetText(api, {
        query: hydratedJob.query || "",
        role: hydratedJob.confirmed_role,
        targetTitle: target.title,
        targetOutline: target.outline,
        selectedText: target.selectedText,
        beforeContext: target.beforeContext,
        afterContext: target.afterContext,
        references,
        freshContext: researchContext?.selectedContext,
        allowFreshResearch: Boolean(researchContext),
        instruction,
      });
      const afterCitations = extractCitations(rewrittenText);
      const addedCitations = afterCitations.filter((citation) => !beforeCitations.includes(citation));
      if (addedCitations.length && !researchContext) {
        throw new Error("Rewrite introduced new citations. Try a style-only instruction or reselect the passage.");
      }
      let finalRewrittenText = rewrittenText;
      let finalReferences = references;
      let finalSourceUrls = researchContext?.sourceUrls;
      let finalGlobalSourceUrls = researchContext?.globalSourceUrls;
      if (researchContext?.globalSourceUrls?.length) {
        const allowed = new Set(researchContext.globalSourceUrls.map((_, index) => String(index + 1)));
        const invalid = afterCitations.filter((citation) => !allowed.has(citation));
        if (invalid.length) throw new Error("Rewrite cited sources outside the selected research context.");
        const compacted = compactRewriteCitations({
          text: rewrittenText,
          baseGlobalSourceUrls: researchContext.baseGlobalSourceUrls,
          freshSourceUrls: researchContext.sourceUrls,
        });
        finalRewrittenText = compacted.text;
        finalSourceUrls = compacted.usedFreshSourceUrls;
        finalGlobalSourceUrls = compacted.globalSourceUrls;
        finalReferences = mergeCommentReferences(
          target.references,
          compacted.references.map((reference) => ({ ...reference, scope: "fresh" as const })),
        );
      }

      const proposalId = `rewrite-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      rewriteDraftsRef.current.set(proposalId, {
        proposalId,
        hydratedJob,
        target,
        rewrittenText: finalRewrittenText,
        references: finalReferences,
        sourceUrls: finalSourceUrls,
        globalSourceUrls: finalGlobalSourceUrls,
      });
      return target.kind === "section"
        ? {
            proposalId,
            rewrittenText: finalRewrittenText,
            originalText: target.selectedText,
            targetKind: "section",
            sectionId: target.section.id,
            sectionTitle: target.section.title,
            references: finalReferences,
          }
        : { proposalId, rewrittenText: finalRewrittenText, originalText: target.selectedText, targetKind: target.kind, references: finalReferences };
    },
    [api, job, sources],
  );

  const applySemanticRewriteProposal = useCallback(
    async (proposalId: string): Promise<SemanticRewriteResult> => {
      const draft = rewriteDraftsRef.current.get(proposalId);
      if (!draft) throw new Error("Rewrite proposal expired. Generate it again.");
      const { hydratedJob, target, rewrittenText } = draft;
      let nextJob: ResearchJob;
      if (target.kind === "section") {
        const updatedMarkdown = replaceSelectedText(target.markdown, target.selectedText, rewrittenText);
        const previousResult = target.sectionResult;
        const updatedSourceUrls = mergeSourceUrlsPreservingOrder(previousResult.source_urls || [], draft.sourceUrls || []);
        const savedJob = await api.saveSectionResult({
          research_id: hydratedJob.research_id,
          section_id: target.section.id,
          section_markdown: updatedMarkdown,
          section_summary: previousResult.section_summary || deriveSummary(updatedMarkdown),
          source_urls: updatedSourceUrls,
          status: "completed",
        });
        const updatedSectionResult = {
          ...previousResult,
          section_markdown: updatedMarkdown,
          section_summary: previousResult.section_summary || deriveSummary(updatedMarkdown),
          source_urls: updatedSourceUrls,
          status: "completed",
        };
        const savedJobWithContext = {
          ...hydratedJob,
          ...savedJob,
          confirmed_role: savedJob.confirmed_role || hydratedJob.confirmed_role,
          confirmed_focuses: savedJob.confirmed_focuses || hydratedJob.confirmed_focuses,
          confirmed_outline: savedJob.confirmed_outline || hydratedJob.confirmed_outline,
          report_framing: savedJob.report_framing || hydratedJob.report_framing,
          result: savedJob.result || hydratedJob.result,
        };
        nextJob = mergeSectionResults(savedJobWithContext, {
          ...(hydratedJob.section_results || {}),
          [target.section.id]: updatedSectionResult,
        });
      } else {
        const baseFraming = target.framing;
        const updatedFraming = {
          ...baseFraming,
          [target.kind]: replaceSelectedText(target.markdown, target.selectedText, rewrittenText),
        };
        const savedJob = await api.saveReportFraming({ research_id: hydratedJob.research_id, framing: updatedFraming });
        nextJob = mergeSectionResults(
          {
            ...hydratedJob,
            ...savedJob,
            confirmed_role: savedJob.confirmed_role || hydratedJob.confirmed_role,
            confirmed_focuses: savedJob.confirmed_focuses || hydratedJob.confirmed_focuses,
            confirmed_outline: savedJob.confirmed_outline || hydratedJob.confirmed_outline,
            report_framing: savedJob.report_framing || updatedFraming,
            result: savedJob.result || hydratedJob.result,
          },
          hydratedJob.section_results,
        );
      }
      const sectionResults = sectionRunResultsFromJob(nextJob);
      const framing = nextJob.report_framing || hydratedJob.report_framing || {
        title: nextJob.result?.report_markdown ? headingFromMarkdown(nextJob.result.report_markdown) : "Research Report",
        introduction: "",
        conclusion: "",
      };
      const reportMarkdown = assembleReport(framing, sectionResults);
      const sourceUrls = draft.globalSourceUrls?.length
        ? mergeSourceUrlsPreservingOrder(draft.globalSourceUrls, sectionResults.flatMap((section) => section.sourceUrls))
        : sortedUnique(sectionResults.flatMap((section) => section.sourceUrls));
      const assembledJob = await api.saveAssembledResearchResult({
        research_id: hydratedJob.research_id,
        report_markdown: reportMarkdown,
        source_urls: sourceUrls,
      });
      const completedResult = assembledJob.result || {
        research_id: hydratedJob.research_id,
        report_markdown: reportMarkdown,
        source_urls: sourceUrls,
        status: "completed",
      };
      const finalJob = mergeSectionResults({
        ...nextJob,
        ...assembledJob,
        confirmed_role: assembledJob.confirmed_role || nextJob.confirmed_role,
        confirmed_focuses: assembledJob.confirmed_focuses || nextJob.confirmed_focuses,
        confirmed_outline: assembledJob.confirmed_outline || nextJob.confirmed_outline,
        report_framing: assembledJob.report_framing || nextJob.report_framing,
      }, nextJob.section_results);
      setJob(finalJob);
      setResult(completedResult);
      setLastCompletedJob(finalJob);
      setLastCompletedResult(completedResult);
      setSectionPreviews(projectSectionPreviews(finalJob));
      void refreshHistoryJobs().catch(() => undefined);
      rewriteDraftsRef.current.delete(proposalId);
      return target.kind === "section"
        ? {
            proposalId,
            rewrittenText,
            originalText: target.selectedText,
            targetKind: "section",
            sectionId: target.section.id,
            sectionTitle: target.section.title,
            references: draft.references,
          }
        : { proposalId, rewrittenText, originalText: target.selectedText, targetKind: target.kind, references: draft.references };
    },
    [api, refreshHistoryJobs],
  );

  const discardSemanticRewriteProposal = useCallback((proposalId: string) => {
    rewriteDraftsRef.current.delete(proposalId);
  }, []);

  const saveManualReportMarkdown = useCallback(
    async (input: ManualReportSaveInput): Promise<ResearchResult> => {
      const reportMarkdown = input.reportMarkdown;
      if (!reportMarkdown.trim()) throw new Error("Report markdown cannot be empty.");
      const baseJob = job || lastCompletedJob;
      const researchId = baseJob?.research_id || result?.research_id || lastCompletedResult?.research_id;
      if (!researchId) throw new Error("Research job is missing research_id.");
      const hydratedJob = baseJob?.research_id ? await hydrateCompletedSectionResults(api, baseJob) : baseJob;
      let structuredJob = hydratedJob || baseJob || {};
      const manualParts = parseManualReportMarkdown(reportMarkdown, structuredJob);
      if (manualParts.framing) {
        const savedFramingJob = await api.saveReportFraming({ research_id: researchId, framing: manualParts.framing });
        structuredJob = mergeSectionResults(
          {
            ...structuredJob,
            ...savedFramingJob,
            confirmed_role: savedFramingJob.confirmed_role || structuredJob.confirmed_role,
            confirmed_focuses: savedFramingJob.confirmed_focuses || structuredJob.confirmed_focuses,
            confirmed_outline: savedFramingJob.confirmed_outline || structuredJob.confirmed_outline,
            report_framing: savedFramingJob.report_framing || manualParts.framing,
            result: savedFramingJob.result || structuredJob.result,
          },
          structuredJob.section_results,
        );
      }
      let sectionResults = structuredJob.section_results;
      for (const update of manualParts.sectionUpdates) {
        const previous = sectionResults?.[update.section.id];
        const savedSectionJob = await api.saveSectionResult({
          research_id: researchId,
          section_id: update.section.id,
          section_markdown: update.markdown,
          section_summary: previous?.section_summary || deriveSummary(update.markdown),
          source_urls: previous?.source_urls || [],
          status: "completed",
        });
        sectionResults = {
          ...(sectionResults || {}),
          [update.section.id]: {
            ...previous,
            section_id: update.section.id,
            status: "completed",
            section_markdown: update.markdown,
            section_summary: previous?.section_summary || deriveSummary(update.markdown),
            source_urls: previous?.source_urls || [],
          },
        };
        structuredJob = mergeSectionResults(
          {
            ...structuredJob,
            ...savedSectionJob,
            confirmed_role: savedSectionJob.confirmed_role || structuredJob.confirmed_role,
            confirmed_focuses: savedSectionJob.confirmed_focuses || structuredJob.confirmed_focuses,
            confirmed_outline: savedSectionJob.confirmed_outline || structuredJob.confirmed_outline,
            report_framing: savedSectionJob.report_framing || structuredJob.report_framing,
            result: savedSectionJob.result || structuredJob.result,
          },
          sectionResults,
        );
      }
      const sourceUrls =
        result?.source_urls ||
        lastCompletedResult?.source_urls ||
        structuredJob.result?.source_urls ||
        sortedUnique(sectionRunResultsFromJob(structuredJob).flatMap((section) => section.sourceUrls));
      const savedJob = await api.saveAssembledResearchResult({
        research_id: researchId,
        report_markdown: reportMarkdown,
        source_urls: sourceUrls,
      });
      const completedResult = savedJob.result || {
        research_id: researchId,
        report_markdown: reportMarkdown,
        source_urls: sourceUrls,
        status: "completed",
      };
      const finalJob = mergeSectionResults(
        {
          ...structuredJob,
          ...savedJob,
          result: completedResult,
          status: savedJob.status || structuredJob.status || "completed",
          stage: savedJob.stage || structuredJob.stage || "completed",
          progress: savedJob.progress ?? structuredJob.progress ?? 100,
          confirmed_role: savedJob.confirmed_role || structuredJob.confirmed_role,
          confirmed_focuses: savedJob.confirmed_focuses || structuredJob.confirmed_focuses,
          confirmed_outline: savedJob.confirmed_outline || structuredJob.confirmed_outline,
          report_framing: savedJob.report_framing || structuredJob.report_framing,
        },
        structuredJob.section_results,
      );
      setJob(finalJob);
      setResult(completedResult);
      setLastCompletedJob(finalJob);
      setLastCompletedResult(completedResult);
      setSectionPreviews(projectSectionPreviews(finalJob));
      void refreshHistoryJobs().catch(() => undefined);
      return completedResult;
    },
    [api, job, lastCompletedJob, lastCompletedResult, refreshHistoryJobs, result],
  );

  const semanticRewriteSelection = useCallback(
    async (input: SemanticRewriteInput): Promise<SemanticRewriteResult> => {
      const proposal = await previewSemanticRewriteSelection(input);
      if (!proposal.proposalId) return proposal;
      return applySemanticRewriteProposal(proposal.proposalId);
    },
    [applySemanticRewriteProposal, previewSemanticRewriteSelection],
  );

  const resumeResearchJob = useCallback(
    async (researchId?: string) => {
      const baseJob = researchId ? await api.getResearchJob(researchId) : job;
      if (!baseJob) throw new Error("Research job was not found.");
      const hydratedJob = await hydrateCompletedSectionResults(api, baseJob);
      const sections = hydratedJob.confirmed_outline?.length ? hydratedJob.confirmed_outline : outlineDraft;
      await runConfirmedSections(sections, { resume: true, baseJob: hydratedJob });
    },
    [api, job, outlineDraft, runConfirmedSections],
  );

  return {
    job,
    result,
    lastCompletedJob,
    lastCompletedResult,
    historyJobs,
    settings,
    sources,
    phase,
    error,
    roleCandidates,
    focusCandidates,
    outlineDraft,
    runEvents,
    sectionPreviews,
    setRoleCandidates,
    setFocusCandidates,
    setOutlineDraft,
    isBusy: phase === "starting" || phase === "generating_roles" || phase === "generating_focuses" || phase === "generating_outline" || phase === "running" || phase === "loading_result",
    canStart: hasConfiguredSource(sources),
    refreshSettings,
    refreshSources,
    refreshHistoryJobs,
    openResearchJob,
    updateSourceCredential,
    setSourceEnabled,
    upsertSource,
    deleteSource,
    testSource,
    start,
    regenerateRoles,
    confirmRole,
    regenerateFocuses,
    confirmFocuses,
    regenerateOutline,
    confirmOutlineAndRun,
    resumeResearchJob,
    previewSemanticRewriteSelection,
    applySemanticRewriteProposal,
    discardSemanticRewriteProposal,
    semanticRewriteSelection,
    saveManualReportMarkdown,
    resetForNewResearch,
  };
}

function hasConfiguredSource(sources: ResearchSourceView[]): boolean {
  return sources.some((source) => source.enabled && source.credential_status === "configured");
}

function readyEnabledSources(sources: ResearchSourceView[]): ResearchSourceView[] {
  return sources.filter((source) => source.enabled && source.credential_status === "configured");
}

function roleCandidatesFromJob(job: ResearchJob | null | undefined): RoleCandidate[] {
  const role = job?.confirmed_role;
  return role?.server && role.agent_role_prompt ? [{ ...role }] : [];
}

function focusCandidatesFromJob(job: ResearchJob | null | undefined): FocusCandidate[] {
  return (job?.confirmed_focuses || [])
    .map((text, index) => ({ id: `confirmed-focus-${index + 1}`, text: String(text || "").trim() }))
    .filter((candidate) => candidate.text);
}

function reusableSectionResult(section: ReportSection, result: NonNullable<ResearchJob["section_results"]>[string] | undefined): SectionRunResult | null {
  if (!result || result.status !== "completed") return null;
  const markdown = String(result.section_markdown || "").trim();
  if (!markdown) return null;
  const sourceUrls = Array.isArray(result.source_urls) ? result.source_urls.filter(Boolean) : [];
  return {
    section,
    markdown,
    summary: result.section_summary || deriveSummary(markdown),
    sourceUrls,
    citationSources: result.citation_sources?.length ? result.citation_sources : citationSourcesFromUrls(sourceUrls),
  };
}

async function hydrateCompletedSectionResults(api: ResearchApi, job: ResearchJob): Promise<ResearchJob> {
  const researchId = job.research_id;
  const sections = job.confirmed_outline || [];
  const existing = job.section_results || {};
  if (!researchId || !sections.length) return job;
  let sectionResults = existing;
  for (const section of sections) {
    const result = sectionResults[section.id];
    if (result?.status !== "completed" || result.section_markdown) continue;
    const hydrated = await api.getSectionResult(researchId, section.id);
    if (!hydrated?.section_markdown) continue;
    if (sectionResults === existing) sectionResults = { ...existing };
    sectionResults[section.id] = { ...result, ...hydrated };
  }
  return sectionResults === existing ? job : { ...job, section_results: sectionResults };
}

function mergeSectionResults(job: ResearchJob, sectionResults: ResearchJob["section_results"] | undefined): ResearchJob {
  if (!sectionResults || !Object.keys(sectionResults).length) return job;
  return {
    ...job,
    section_results: {
      ...(job.section_results || {}),
      ...sectionResults,
    },
  };
}

function sectionRunResultsFromJob(job: ResearchJob): SectionRunResult[] {
  const sections = job.confirmed_outline || [];
  return sections
    .map((section) => {
      const result = job.section_results?.[section.id];
      const markdown = String(result?.section_markdown || "").trim();
      if (!result || result.status !== "completed" || !markdown) return null;
      return {
        section,
        markdown,
        summary: result.section_summary || deriveSummary(markdown),
        sourceUrls: Array.isArray(result.source_urls) ? result.source_urls.filter(Boolean) : [],
        citationSources: result.citation_sources?.length ? result.citation_sources : citationSourcesFromUrls(Array.isArray(result.source_urls) ? result.source_urls.filter(Boolean) : []),
      };
    })
    .filter((item): item is SectionRunResult => Boolean(item));
}

interface ManualReportParts {
  framing: ReportFraming | null;
  sectionUpdates: Array<{ section: ReportSection; markdown: string }>;
}

function parseManualReportMarkdown(markdown: string, job: ResearchJob): ManualReportParts {
  const text = markdown.trim();
  const titleMatch = text.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || job.report_framing?.title || headingFromMarkdown(text) || "Research Report";
  const sectionBlocks = splitSecondLevelBlocks(text);
  const conclusionIndex = sectionBlocks.findIndex((block) => isConclusionHeading(block.title));
  const reportSections = conclusionIndex >= 0 ? sectionBlocks.slice(0, conclusionIndex) : sectionBlocks;
  const conclusion = conclusionIndex >= 0 ? stripHeading(sectionBlocks[conclusionIndex].markdown).trim() : job.report_framing?.conclusion || "";
  const firstSectionStart = reportSections[0]?.start ?? (conclusionIndex >= 0 ? sectionBlocks[conclusionIndex].start : text.length);
  const introduction = stripLeadingTitle(text.slice(0, firstSectionStart)).trim();
  const confirmedSections = job.confirmed_outline || [];
  const sectionUpdates = confirmedSections
    .map((section, index) => {
      const block = reportSections[index];
      if (!block?.markdown.trim()) return null;
      return { section, markdown: block.markdown.trim() };
    })
    .filter((item): item is { section: ReportSection; markdown: string } => Boolean(item));
  const hasFraming = Boolean(job.report_framing || titleMatch || introduction || conclusionIndex >= 0);
  return {
    framing: hasFraming
      ? {
          ...(job.report_framing || { title, introduction: "", conclusion: "" }),
          title,
          introduction,
          conclusion,
        }
      : null,
    sectionUpdates,
  };
}

function splitSecondLevelBlocks(markdown: string): Array<{ title: string; markdown: string; start: number; end: number }> {
  const matches = Array.from(markdown.matchAll(/^##\s+(.+)$/gm));
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    return {
      title: String(match[1] || "").trim(),
      markdown: markdown.slice(start, end).trim(),
      start,
      end,
    };
  });
}

function stripLeadingTitle(markdown: string): string {
  return markdown.replace(/^#\s+.+\n?/, "").trim();
}

function stripHeading(markdown: string): string {
  return markdown.replace(/^##\s+.+\n?/, "").trim();
}

function isConclusionHeading(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized === "conclusion" || normalized === "结论" || normalized === "总结";
}

function conclusionHeadingFor(framing: ReportFraming, results: Array<{ markdown: string }>): string {
  return isLikelyChinese(framing.title, framing.introduction, framing.conclusion, ...results.map((result) => result.markdown)) ? "结论" : "Conclusion";
}

function isLikelyChinese(...parts: string[]): boolean {
  return /[\u3400-\u9fff]/.test(parts.join("\n"));
}

type RewriteTarget =
  | {
      kind: "section";
      section: ReportSection;
      sectionResult: NonNullable<ResearchJob["section_results"]>[string];
      markdown: string;
      title: string;
      outline: string;
      selectedText: string;
      beforeContext: string;
      afterContext: string;
      references: CommentReference[];
    }
  | {
      kind: "title" | "introduction" | "conclusion";
      framing: ReportFraming;
      markdown: string;
      title: string;
      outline: string;
      selectedText: string;
      beforeContext: string;
      afterContext: string;
      references: CommentReference[];
    };

interface SemanticRewriteDraft {
  proposalId: string;
  hydratedJob: ResearchJob;
  target: RewriteTarget;
  rewrittenText: string;
  references: CommentReference[];
  sourceUrls?: string[];
  globalSourceUrls?: string[];
}

function findRewriteTarget(job: ResearchJob, selectedText: string): RewriteTarget | null {
  const normalizedSelection = normalizeSelectedText(selectedText);
  const framing = job.report_framing;
  if (framing) {
    const titleTarget = matchRewriteText(framing.title || "", selectedText, normalizedSelection);
    if (titleTarget) {
      return {
        kind: "title",
        framing,
        markdown: framing.title || "",
        title: "Report title",
        outline: "The main report title.",
        references: referencesForCommentTarget(job, titleTarget),
        ...titleTarget,
      };
    }
    const introductionTarget = matchRewriteText(framing.introduction || "", selectedText, normalizedSelection);
    if (introductionTarget) {
      return {
        kind: "introduction",
        framing,
        markdown: framing.introduction || "",
        title: "Introduction",
        outline: "Opening framing before the report sections.",
        references: referencesForCommentTarget(job, introductionTarget),
        ...introductionTarget,
      };
    }
  }
  for (const section of job.confirmed_outline || []) {
    const result = job.section_results?.[section.id];
    const sectionMarkdown = String(result?.section_markdown || "");
    if (!result || !sectionMarkdown.trim()) continue;
    const matched = matchRewriteText(sectionMarkdown, selectedText, normalizedSelection);
    if (!matched) continue;
    return {
      kind: "section",
      section,
      sectionResult: result,
      markdown: sectionMarkdown,
      title: section.title,
      outline: section.outline,
      references: referencesForCommentTarget(job, matched, result.source_urls || []),
      ...matched,
    };
  }
  if (framing) {
    const conclusionTarget = matchRewriteText(framing.conclusion || "", selectedText, normalizedSelection);
    if (conclusionTarget) {
      return {
        kind: "conclusion",
        framing,
        markdown: framing.conclusion || "",
        title: isLikelyChinese(framing.title, framing.introduction, framing.conclusion) ? "结论" : "Conclusion",
        outline: "Closing synthesis after the report sections.",
        references: referencesForCommentTarget(job, conclusionTarget),
        ...conclusionTarget,
      };
    }
  }
  return null;
}

function matchRewriteText(markdown: string, selectedText: string, normalizedSelection: string) {
  const exactIndex = markdown.indexOf(selectedText);
  const normalizedIndex = exactIndex >= 0 ? -1 : markdown.indexOf(normalizedSelection);
  const visibleRange = exactIndex >= 0 || normalizedIndex >= 0 ? null : findVisibleMarkdownRange(markdown, selectedText);
  const index = exactIndex >= 0 ? exactIndex : normalizedIndex >= 0 ? normalizedIndex : visibleRange?.start ?? -1;
  const end = exactIndex >= 0 ? exactIndex + selectedText.length : normalizedIndex >= 0 ? normalizedIndex + normalizedSelection.length : visibleRange?.end ?? -1;
  if (index < 0 || end < index) return null;
  const targetText = markdown.slice(index, end);
  const duplicate = exactIndex >= 0 || normalizedIndex >= 0
    ? markdown.indexOf(targetText, index + targetText.length) >= 0
    : visibleRange?.duplicate;
  if (duplicate) throw new Error("The selected text appears more than once in this report area. Select a longer passage.");
  return {
    selectedText: targetText,
    beforeContext: markdown.slice(Math.max(0, index - 900), index).trim(),
    afterContext: markdown.slice(end, end + 900).trim(),
  };
}

function findVisibleMarkdownRange(markdown: string, selectedText: string): { start: number; end: number; duplicate: boolean } | null {
  const markdownIndex = buildVisibleMarkdownIndex(markdown);
  const selectionIndex = buildVisibleMarkdownIndex(selectedText);
  const needle = selectionIndex.text.trim();
  if (!needle) return null;
  const start = markdownIndex.text.indexOf(needle);
  if (start < 0) return null;
  const duplicate = markdownIndex.text.indexOf(needle, start + needle.length) >= 0;
  const firstVisible = markdownIndex.map[start];
  const lastVisible = markdownIndex.map[start + needle.length - 1];
  if (firstVisible === undefined || lastVisible === undefined) return null;
  const expanded = expandMarkdownFormattingRange(markdown, firstVisible, lastVisible + 1);
  return { ...expanded, duplicate };
}

function buildVisibleMarkdownIndex(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let previousWasSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (shouldSkipMarkdownVisibleChar(text, index)) continue;
    if (/\s/.test(char)) {
      if (!previousWasSpace && out) {
        out += " ";
        map.push(index);
        previousWasSpace = true;
      }
      continue;
    }
    out += char;
    map.push(index);
    previousWasSpace = false;
  }
  return { text: out.trim(), map };
}

function shouldSkipMarkdownVisibleChar(text: string, index: number): boolean {
  const char = text[index];
  if (char === "\u200b" || char === "\ufeff") return true;
  if (char === "*" || char === "_" || char === "`") return true;
  const linePrefix = index === 0 || text[index - 1] === "\n";
  if (!linePrefix) return false;
  const rest = text.slice(index);
  return /^#{1,6}\s/.test(rest) || /^>\s/.test(rest) || /^[-+*]\s+/.test(rest) || /^\d+\.\s+/.test(rest);
}

function expandMarkdownFormattingRange(markdown: string, start: number, end: number): { start: number; end: number } {
  let nextStart = start;
  let nextEnd = end;
  if (markdown.slice(nextStart - 2, nextStart) === "**" && markdown.slice(nextStart, nextEnd).includes("**")) nextStart -= 2;
  if (markdown.slice(nextStart - 1, nextStart) === "*" && markdown.slice(nextStart, nextEnd).includes("*")) nextStart -= 1;
  if (markdown.slice(nextStart - 1, nextStart) === "`" && markdown.slice(nextStart, nextEnd).includes("`")) nextStart -= 1;
  return { start: Math.max(0, nextStart), end: nextEnd };
}

function referencesForCommentTarget(
  job: ResearchJob,
  target: { selectedText: string; beforeContext: string; afterContext: string },
  sectionSourceUrls: string[] = [],
): CommentReference[] {
  const references: CommentReference[] = [];
  const seen = new Set<string>();
  const globalUrls = job.result?.source_urls || job.source_urls || [];
  const add = (number: number, url: string, scope: CommentReference["scope"]) => {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) return;
    const key = `${number}:${normalizedUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ number, url: normalizedUrl, scope });
  };
  for (const raw of extractCitations(target.selectedText)) {
    const number = Number(raw);
    add(number, globalUrls[number - 1], "selected");
  }
  for (const raw of extractCitations(`${target.beforeContext}\n${target.afterContext}`)) {
    const number = Number(raw);
    add(number, globalUrls[number - 1], "nearby");
  }
  if (!references.length) {
    sectionSourceUrls.forEach((url, index) => {
      const globalIndex = globalUrls.indexOf(url);
      add(globalIndex >= 0 ? globalIndex + 1 : index + 1, url, "section");
    });
  }
  return references;
}

function rewriteResearchAnchorSection(job: ResearchJob, target: RewriteTarget): ReportSection | null {
  if (target.kind === "section") return target.section;
  const sections = job.confirmed_outline || [];
  if (!sections.length) return null;
  if (target.kind === "conclusion") return sections[sections.length - 1] || null;
  return sections[0] || null;
}

async function refreshRewriteResearchContext(
  api: ResearchApi,
  input: {
    job: ResearchJob;
    target: RewriteTarget;
    instruction: string;
    sources: ResearchSourceView[];
  },
): Promise<{ selectedContext: string; sourceUrls: string[]; baseGlobalSourceUrls: string[]; globalSourceUrls: string[]; references: CommentReference[] }> {
  const { job, target, instruction, sources } = input;
  const anchorSection = rewriteResearchAnchorSection(job, target);
  if (!anchorSection) throw new Error("Re-search rewrite needs at least one report section to anchor the evidence search.");
  const role = job.confirmed_role;
  if (!role) throw new Error("Research role is missing.");
  const allowedSources = sources.filter((source) => anchorSection.allowed_source_ids.includes(source.id));
  if (!allowedSources.length) throw new Error(`Section has no configured allowed source: ${anchorSection.title}`);
  const plan = await generateRewriteResearchPlan(api, {
    query: job.query || "",
    role,
    target,
    instruction,
  });
  const focusedSection: ReportSection = {
    ...anchorSection,
    title: plan.title || target.title,
    outline: plan.outline || `${target.outline}\n\nSelected passage:\n${target.selectedText}\n\nRewrite request:\n${instruction}`,
    max_iterations: Math.min(Math.max(plan.maxIterations || 1, 1), 2),
  };
  const history: IterationEntry[] = [];
  const seedQueries = plan.queries.length ? plan.queries : [target.selectedText];
  for (let iteration = 1; iteration <= focusedSection.max_iterations; iteration++) {
    const decision =
      iteration === 1
        ? { type: "call_source" as const, source_id: allowedSources[0].id, queries: seedQueries }
        : await decideNextAction({
            api,
            query: job.query || "",
            rolePrompt: role.agent_role_prompt,
            section: focusedSection,
            focuses: job.confirmed_focuses || [],
            iteration,
            maxIterations: focusedSection.max_iterations,
            enabledSources: allowedSources,
            history,
          });
    if (decision.type !== "call_source") break;
    const sourceId = allowedSources.some((source) => source.id === decision.source_id) ? String(decision.source_id) : allowedSources[0].id;
    const queries = uniqueQueries(decision.queries.length ? decision.queries : seedQueries);
    if (!queries.length) break;
    const call = await api.callSectionResearchSource({
      research_id: requiredResearchId(job),
      section_id: anchorSection.id,
      iteration: nextRewriteResearchIteration(job, anchorSection.id, iteration),
      source_id: sourceId,
      queries,
    });
    if (call.source_call) {
      history.push({
        iteration,
        source_id: call.source_call.source_id,
        source_name: call.source_call.source_name,
        queries: call.source_call.queries,
        results_count: call.source_call.results_count,
        source_calls: call.source_call.calls,
      });
    }
  }
  const contextQuery = [
    job.query || "",
    `Report area: ${target.title}`,
    focusedSection.outline,
    `Selected passage: ${target.selectedText}`,
    `Rewrite request: ${instruction}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const selected = await api.selectSectionContext({
    research_id: requiredResearchId(job),
    section_id: anchorSection.id,
    query: contextQuery,
    search_queries: sortedUnique(history.flatMap((entry) => entry.queries)),
  });
  const sourceUrls = selected.source_urls || [];
  const existingGlobalUrls = job.result?.source_urls || job.source_urls || [];
  const globalSourceUrls = mergeSourceUrlsPreservingOrder(existingGlobalUrls, sourceUrls);
  const references = mergeCommentReferences(
    target.references,
    sourceUrls.map((url) => ({ number: globalSourceUrls.indexOf(url) + 1, url, scope: "fresh" as const })),
  );
  return {
    selectedContext: selected.selected_context || "",
    sourceUrls,
    baseGlobalSourceUrls: existingGlobalUrls,
    globalSourceUrls,
    references,
  };
}

async function generateRewriteResearchPlan(
  api: ResearchApi,
  input: {
    query: string;
    role: ConfirmedResearchRole;
    target: RewriteTarget;
    instruction: string;
  },
): Promise<{ title: string; outline: string; queries: string[]; maxIterations: number }> {
  const text = await completeText(api, [
    { role: "system", content: { type: "text", text: input.role.agent_role_prompt } },
    {
      role: "user",
      content: {
        type: "text",
        text:
          'Draft one temporary research section for revising only the selected report passage. Return strict JSON only: {"title":"...","outline":"...","queries":["..."],"max_iterations":1}.\n' +
          "The plan must preserve the existing report structure and must focus on evidence needed for the user's rewrite comment.\n" +
          "Return 1 to 3 precise search queries. Use max_iterations between 1 and 2.\n\n" +
          `Original research task:\n${input.query}\n\n` +
          `Existing section:\n${input.target.title}\n${input.target.outline}\n\n` +
          `Neighbor context before:\n${input.target.beforeContext || "(none)"}\n\n` +
          `Selected passage:\n${input.target.selectedText}\n\n` +
          `Neighbor context after:\n${input.target.afterContext || "(none)"}\n\n` +
          `User rewrite instruction:\n${input.instruction}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  return {
    title: String(parsed?.title || input.target.title).trim(),
    outline: String(parsed?.outline || "").trim(),
    queries: uniqueQueries(Array.isArray(parsed?.queries) ? parsed.queries : []),
    maxIterations: Math.min(Math.max(Number(parsed?.max_iterations || 1), 1), 2),
  };
}

function nextRewriteResearchIteration(job: ResearchJob, sectionId: string, fallback: number): number {
  const existing = job.section_iterations?.[sectionId] || [];
  const max = existing.reduce((value, entry) => Math.max(value, Number(entry.iteration || 0)), 0);
  return max + fallback;
}

function mergeCommentReferences(base: CommentReference[], additions: CommentReference[]): CommentReference[] {
  const out: CommentReference[] = [];
  const seen = new Set<string>();
  for (const reference of [...base, ...additions]) {
    const url = String(reference.url || "").trim();
    if (!url || !reference.number) continue;
    const key = `${reference.number}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...reference, url });
  }
  return out;
}

function normalizeSelectedText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function replaceSelectedText(markdown: string, selectedText: string, rewrittenText: string): string {
  const index = markdown.indexOf(selectedText);
  if (index < 0) throw new Error("Target text changed. Select the passage again.");
  return `${markdown.slice(0, index)}${rewrittenText.trim()}${markdown.slice(index + selectedText.length)}`;
}

function extractCitations(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/\[(\d+)\]/g)).map((match) => match[1])));
}

function compactRewriteCitations(input: {
  text: string;
  baseGlobalSourceUrls: string[];
  freshSourceUrls: string[];
}): { text: string; usedFreshSourceUrls: string[]; globalSourceUrls: string[]; references: Array<{ number: number; url: string }> } {
  const baseGlobalSourceUrls = input.baseGlobalSourceUrls.map((url) => String(url || "").trim()).filter(Boolean);
  const fullSourceUrls = mergeSourceUrlsPreservingOrder(baseGlobalSourceUrls, input.freshSourceUrls);
  const usedFreshSourceUrls: string[] = [];
  const references = new Map<number, string>();
  const text = input.text.replace(/\[(\d+)\]/g, (match, rawNumber: string) => {
    const oldNumber = Number(rawNumber);
    const url = fullSourceUrls[oldNumber - 1];
    if (!url) return match;
    const existingIndex = baseGlobalSourceUrls.indexOf(url);
    if (existingIndex >= 0) {
      return `[${existingIndex + 1}]`;
    }
    let freshIndex = usedFreshSourceUrls.indexOf(url);
    if (freshIndex < 0) {
      usedFreshSourceUrls.push(url);
      freshIndex = usedFreshSourceUrls.length - 1;
    }
    const number = baseGlobalSourceUrls.length + freshIndex + 1;
    references.set(number, url);
    return `[${number}]`;
  });
  return {
    text,
    usedFreshSourceUrls,
    globalSourceUrls: mergeSourceUrlsPreservingOrder(baseGlobalSourceUrls, usedFreshSourceUrls),
    references: Array.from(references.entries()).map(([number, url]) => ({ number, url })).sort((a, b) => a.number - b.number),
  };
}

async function rewriteTargetText(
  api: ResearchApi,
  input: {
    query: string;
    role?: ConfirmedResearchRole | null;
    targetTitle: string;
    targetOutline: string;
    selectedText: string;
    beforeContext: string;
    afterContext: string;
    references?: CommentReference[];
    freshContext?: string;
    allowFreshResearch?: boolean;
    instruction: string;
  },
): Promise<string> {
  const system = [
    input.role?.agent_role_prompt || "You are a careful research report editor.",
    "Rewrite one local passage inside a research report.",
    input.allowFreshResearch
      ? "You may add new facts only when they are directly grounded in the fresh research context."
      : "Do not introduce new facts, numbers, companies, claims, sources, or citations.",
    "Use the relevant references provided by the user message as grounding context.",
    "Preserve existing citation markers exactly when the cited claim remains.",
    input.allowFreshResearch
      ? "If you use fresh research evidence, cite it with one of the provided reference numbers. Do not invent citation markers."
      : "Do not invent citation markers.",
    'Return strict JSON only: {"rewritten_text":"..."}',
  ].join("\n");
  const referenceBlock = input.references?.length
    ? input.references.map((reference) => `[${reference.number}] ${reference.url} (${reference.scope})`).join("\n")
    : "(none)";
  const text = await completeText(api, [
    { role: "system", content: { type: "text", text: system } },
    {
      role: "user",
      content: {
        type: "text",
        text:
          `Original research task:\n${input.query}\n\n` +
          `Report area:\n${input.targetTitle}\n${input.targetOutline}\n\n` +
          `Neighbor context before:\n${input.beforeContext || "(none)"}\n\n` +
          `Target passage:\n${input.selectedText}\n\n` +
          `Neighbor context after:\n${input.afterContext || "(none)"}\n\n` +
          `Relevant references:\n${referenceBlock}\n\n` +
          `Fresh research context:\n${input.freshContext || "(none)"}\n\n` +
          `User rewrite instruction:\n${input.instruction}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  const rewritten = String(parsed?.rewritten_text || "").trim();
  if (rewritten) return rewritten;
  const fallback = text.trim();
  if (!fallback) throw new Error("Anna returned an empty rewrite.");
  return fallback;
}

function headingFromMarkdown(markdown: string): string {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match?.[1]?.trim() || "Research Report";
}

async function updateJob(api: ResearchApi, job: ResearchJob, updates: Record<string, unknown>): Promise<ResearchJob> {
  const updated = await api.updateResearchJob(requiredResearchId(job), updates);
  return { ...job, ...updated };
}

function requiredResearchId(job: ResearchJob): string {
  if (!job.research_id) throw new Error("Research job is missing research_id.");
  return job.research_id;
}

function progressForIteration(iteration: number, maxIterations: number): number {
  return Math.min(85, 40 + Math.round((iteration / Math.max(1, maxIterations)) * 35));
}

function promptQueryForJob(job: ResearchJob | null | undefined, fallbackQuery = ""): string {
  const query = String(job?.query || fallbackQuery || "").trim();
  const context = job?.attachment_context;
  if (!context?.summary) return query;
  const fileSummaries = (context.files || [])
    .filter((file) => file.status === "ready" && isAttachmentFileRelevant(file) && (file.analysis?.summary || file.analysis?.key_points?.length))
    .slice(0, 8)
    .map((file) => {
      const analysis = file.analysis;
      const points = (analysis?.key_points || []).slice(0, 4).map((point) => `  - ${point}`).join("\n");
      return [`File: ${file.name}`, analysis?.summary ? `Summary: ${analysis.summary}` : "", points ? `Key points:\n${points}` : ""].filter(Boolean).join("\n");
    })
    .join("\n\n");
  if (!fileSummaries) return query;
  const attachmentBlock = [`Relevant uploaded file summary:`, `Uploaded-file evidence policy: ${ATTACHMENT_EVIDENCE_POLICY}`, fileSummaries].filter(Boolean).join("\n\n").slice(0, 5000);
  return [query, attachmentBlock].filter(Boolean).join("\n\n");
}

const ATTACHMENT_EVIDENCE_POLICY =
  "Use this analysis as supporting evidence only when the claim is directly grounded in visible content. Do not use it to verify external facts, dates, source credibility, or causal explanations unless those are explicitly visible in the attachment content.";

function isAttachmentFileRelevant(file: { analysis?: { relevance_score?: number | null } }): boolean {
  if (typeof file.analysis?.relevance_score === "number") return file.analysis.relevance_score >= 0.25;
  return false;
}

interface AttachmentSelectedItem {
  kind?: string;
  item_id?: string;
  file_id?: string;
  file_name?: string;
  path?: string;
  content_type?: string;
  index?: number;
  quote?: string;
}

async function selectAttachmentContextForSection(api: ResearchApi, job: ResearchJob, section: ReportSection): Promise<{ context: string; items: AttachmentSelectedItem[] }> {
  if (!job.attachment_context?.summary && !job.attachments?.length) return { context: "", items: [] };
  try {
    const response = await api.selectAttachmentContext({
      research_id: requiredResearchId(job),
      query: attachmentChunkQueryForSection(section),
      top_k: 4,
    });
    return { context: response.selected_context || "", items: response.selected_items || [] };
  } catch {
    return { context: "", items: [] };
  }
}

function attachmentChunkQueryForSection(section: ReportSection): string {
  const outline = String(section.outline || "").replace(/\s+/g, " ").trim();
  return [section.title, outline.slice(0, 160)].filter(Boolean).join("\n");
}

async function generateRoleCandidates(api: ResearchApi, query: string, instruction = ""): Promise<RoleCandidate[]> {
  const text = await completeText(api, [
    {
      role: "system",
      content: {
        type: "text",
        text:
          "Generate research role candidates for Anna Researcher. Return strict JSON only with this schema: " +
          '{"roles":[{"server":"<research role name>","agent_role_prompt":"<system prompt for this role>"}]}. ' +
          "The server field is the user-visible research role name, not a backend server. " +
          "Do not include rationale, markdown, prose, or extra keys.",
      },
    },
    {
      role: "user",
      content: {
        type: "text",
        text:
          "Generate exactly 3 possible research roles for this task. " +
          "Each agent_role_prompt must be specific, source-grounded, and suitable as the later system prompt for focus planning and report writing.\n" +
          (instruction ? `Regeneration requirement: ${instruction}\n` : "") +
          `Task:\n${query}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  const roles = Array.isArray(parsed?.roles) ? parsed.roles : [];
  const candidates = roles.map(normalizeRoleCandidate).filter(Boolean) as RoleCandidate[];
  return padRoles(candidates).slice(0, 3);
}

async function generateFocusCandidates(api: ResearchApi, query: string, role: ConfirmedResearchRole, instruction = ""): Promise<FocusCandidate[]> {
  const text = await completeText(api, [
    {
      role: "system",
      content: { type: "text", text: role.agent_role_prompt },
    },
    {
      role: "user",
      content: {
        type: "text",
        text:
          'Generate exactly 5 research focus candidates. Return strict JSON only: {"focuses":[{"text":"...","rationale":"..."}]}.\n' +
          (instruction ? `Regeneration requirement: ${instruction}\n` : "") +
          `Task:\n${query}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  const focuses = Array.isArray(parsed?.focuses) ? parsed.focuses : [];
  const candidates = focuses
    .map((item, index) => ({ id: `focus-${index + 1}`, text: String(item?.text || item || "").trim(), rationale: String(item?.rationale || "").trim() }))
    .filter((item) => item.text);
  return padFocuses(candidates).slice(0, 5);
}

async function generateOutlineDraft(api: ResearchApi, query: string, role: ConfirmedResearchRole, focuses: string[], instruction = ""): Promise<ReportSection[]> {
  const text = await completeText(api, [
    { role: "system", content: { type: "text", text: role.agent_role_prompt } },
    {
      role: "user",
      content: {
        type: "text",
        text:
          'Draft 4 to 6 report sections. Return strict JSON only: {"sections":[{"title":"...","outline":"...","max_iterations":5}]}.\n' +
          "Do not assign sources in this call.\n" +
          (instruction ? `Regeneration requirement: ${instruction}\n` : "") +
          `Task:\n${query}\n\nResearch focuses:\n${focuses.map((focus) => `- ${focus}`).join("\n")}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const normalized = sections.map(normalizeSectionDraft).filter(Boolean) as ReportSection[];
  return padSections(normalized).slice(0, 6);
}

async function assignAllowedSources(api: ResearchApi, sections: ReportSection[], sources: ResearchSourceView[], instruction = ""): Promise<ReportSection[]> {
  if (!sources.length) throw new Error("No enabled research source is configured.");
  const sourceBlock = sources.map((source) => `- ${source.id}: ${source.name} ${source.description || ""}`).join("\n");
  const text = await completeText(api, [
    {
      role: "user",
      content: {
        type: "text",
        text:
          'Assign allowed research sources for every section. Return strict JSON only: {"sections":[{"id":"section-1","allowed_source_ids":["source-id"]}]}.\n' +
          "Use only source ids from the available list. Every section needs at least one allowed source.\n" +
          (instruction ? `Regeneration requirement: ${instruction}\n` : "") +
          `Available sources:\n${sourceBlock}\n\nSections:\n${JSON.stringify(sections.map(({ id, title, outline }) => ({ id, title, outline })))}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  const assignments = new Map<string, string[]>();
  const valid = new Set(sources.map((source) => source.id));
  for (const item of Array.isArray(parsed?.sections) ? parsed.sections : []) {
    const ids = Array.isArray(item?.allowed_source_ids) ? item.allowed_source_ids.map(String).filter((id: string) => valid.has(id)) : [];
    if (item?.id && ids.length) assignments.set(String(item.id), sortedUnique(ids));
  }
  const fallback = sources[0].id;
  return sections.map((section) => ({ ...section, allowed_source_ids: assignments.get(section.id) || [fallback] }));
}

async function runSection(input: {
  api: ResearchApi;
  job: ResearchJob;
  section: ReportSection;
  reportOutline: ReportSection[];
  priorSectionResults: SectionRunResult[];
  role: ConfirmedResearchRole;
  focuses: string[];
  sources: ResearchSourceView[];
  citationRegistry: CitationSource[];
  onEvent?(event: Parameters<typeof makeLiveRunEvent>[0]): void;
}): Promise<{ markdown: string; summary: string; sourceUrls: string[]; citationSources: CitationSource[] }> {
  const allowedSources = input.sources.filter((source) => input.section.allowed_source_ids.includes(source.id));
  if (!allowedSources.length) throw new Error(`Section has no configured allowed source: ${input.section.title}`);
  const continuityContext = buildReportContinuityContext(input.reportOutline, input.priorSectionResults, input.section);
  const session = await input.api.createAgentSession();
  try {
    return await runSectionInSession({ ...input, allowedSources, continuityContext, session });
  } finally {
    await session.delete().catch(() => undefined);
  }
}

async function runSectionInSession(
  input: {
    api: ResearchApi;
    job: ResearchJob;
    section: ReportSection;
    reportOutline: ReportSection[];
    priorSectionResults: SectionRunResult[];
    role: ConfirmedResearchRole;
    focuses: string[];
    citationRegistry: CitationSource[];
    onEvent?(event: Parameters<typeof makeLiveRunEvent>[0]): void;
    allowedSources: ResearchSourceView[];
    continuityContext: string;
    session: AnnaAgentSession;
  },
): Promise<{ markdown: string; summary: string; sourceUrls: string[]; citationSources: CitationSource[] }> {
  const { api, job, section, role, focuses, citationRegistry, onEvent, allowedSources, continuityContext, session } = input;
  const history: IterationEntry[] = [];
  for (let iteration = 1; iteration <= section.max_iterations; iteration++) {
    await updateJob(api, job, { stage: "section_research", iteration, progress: progressForIteration(iteration, section.max_iterations) });
    onEvent?.({
      kind: "decision",
      sectionId: section.id,
      sectionTitle: section.title,
      title: "Deciding next research action",
      detail: `${iteration}/${section.max_iterations}`,
    });
    const decision = await decideNextAction({
      api,
      query: job.query || "",
      rolePrompt: role.agent_role_prompt,
      section,
      focuses,
      iteration,
      maxIterations: section.max_iterations,
      enabledSources: allowedSources,
      history,
      continuityContext,
      agentSession: session,
    });
    if (decision.type !== "call_source") break;
    const sourceId = allowedSources.some((source) => source.id === decision.source_id) ? String(decision.source_id) : allowedSources[0].id;
    const queries = uniqueQueries(decision.queries.length ? decision.queries : [section.title]);
    if (!queries.length) break;
    let stopAfterIteration = false;
    for (const query of queries) {
      const call = await api.callSectionResearchSource({
        research_id: requiredResearchId(job),
        section_id: section.id,
        iteration,
        source_id: sourceId,
        queries: [query],
      });
      if (call.source_call) {
        onEvent?.(sourceCallEvent(section, call.source_call));
        history.push({
          iteration,
          source_id: call.source_call.source_id,
          source_name: call.source_call.source_name,
          queries: call.source_call.queries,
          results_count: call.source_call.results_count,
          source_calls: call.source_call.calls,
        });
      }
      if (call.source_call?.error && iteration >= section.max_iterations) {
        stopAfterIteration = true;
        break;
      }
    }
    if (stopAfterIteration) break;
  }
  const selected = await api.selectSectionContext({ research_id: requiredResearchId(job), section_id: section.id });
  onEvent?.({
    kind: "context_selected",
    sectionId: section.id,
    sectionTitle: section.title,
    title: "Context selected",
    detail: `${(selected.source_urls || []).length} sources`,
    count: (selected.source_urls || []).length,
  });
  const sourceUrls = selected.source_urls || [];
  const webReferences = registerCitationReferences(citationRegistry, sourceUrls);
  const attachmentSelection = await selectAttachmentContextForSection(api, job, section);
  const attachmentReferences = registerAttachmentCitationReferences(citationRegistry, attachmentSelection.items);
  const citationReferences = [...webReferences, ...attachmentReferences];
  const writer = await writeSection(
    session,
    remapSelectedContextCitationLabels(selected.selected_context || "", webReferences),
    citationReferences,
    attachmentSelection.context,
    section.title,
  );
  const markdown = normalizeSectionCitations(writer.markdown, citationReferences);
  const sectionCitationSources = citationReferences.map((reference) => reference.source);
  await api.saveSectionResult({
    research_id: requiredResearchId(job),
    section_id: section.id,
    section_markdown: markdown,
    section_summary: writer.summary,
    source_urls: sourceUrls,
    citation_sources: sectionCitationSources,
    status: "completed",
  });
  onEvent?.({
    kind: "section_written",
    sectionId: section.id,
    sectionTitle: section.title,
    title: "Section written",
    detail: writer.summary,
  });
  return { ...writer, markdown, sourceUrls, citationSources: sectionCitationSources };
}

async function decideNextAction(input: {
  api: ResearchApi;
  query: string;
  rolePrompt: string;
  section: ReportSection;
  focuses: string[];
  iteration: number;
  maxIterations: number;
  enabledSources: ResearchSourceView[];
  history: IterationEntry[];
  continuityContext?: string;
  agentSession?: AnnaAgentSession;
}): Promise<Decision> {
  const { api, query, rolePrompt, section, focuses, iteration, maxIterations, enabledSources, history, continuityContext, agentSession } = input;
  const sourcesBlock = enabledSources.map((source) => `- ${source.id} (${source.name})`).join("\n");
  const decisionFormat =
    'Reply with strict JSON only: {"type":"call_source","source_id":"<allowed-id>","queries":["..."]} or {"type":"finish"}. ' +
    "Return at most 3 search queries, ordered from highest to lowest priority.";
  const messages: ResearchLlmMessages = iteration === 1
    ? [
        {
          role: "system",
          content: {
            type: "text",
            text:
              rolePrompt +
              "\n\nDecide the next research step for the active report section. " +
              "The frontend owns all research source execution. Do not call tools or search directly. " +
              decisionFormat,
          },
        },
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Task:\n${query}\n\n${continuityContext ? `${continuityContext}\n\n` : `Current section:\n${section.title}\n${section.outline}\n\n`}` +
              `Focuses:\n${focuses.map((focus) => `- ${focus}`).join("\n")}\n\n` +
              `Allowed sources:\n${sourcesBlock}\nIteration: ${iteration}/${maxIterations}`,
          },
        },
      ]
    : [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "The frontend completed the previous research calls. Decide whether the active section needs another search. " +
              "Use the role, task, outline, section boundary, focuses, and allowed sources already established in this session. " +
              "Do not call tools or search directly.\n\n" +
              `Latest external research update:\n${formatIterationResearchUpdate(history, iteration - 1)}\n\n` +
              `Iteration: ${iteration}/${maxIterations}\n${decisionFormat}`,
          },
        },
      ];
  const text = agentSession
    ? await runSectionAgent(agentSession, messages, `Anna Agent returned an empty research decision for ${section.title}.`)
    : await completeText(api, messages);
  const parsed = parseJsonObject(text);
  if (parsed?.type === "call_source") {
    const queries = Array.isArray(parsed.queries) ? parsed.queries.map(String).filter(Boolean) : [];
    return { type: "call_source", source_id: String(parsed.source_id || ""), queries };
  }
  if (iteration === 1) return { type: "call_source", source_id: enabledSources[0]?.id, queries: [section.title] };
  return { type: "finish" };
}

async function writeSection(
  agentSession: AnnaAgentSession,
  selectedContext: string,
  citationReferences: CitationReference[],
  attachmentContext: string,
  sectionTitle: string,
): Promise<{ markdown: string; summary: string }> {
  const citationGuide = citationReferences.length
    ? citationReferences.map((reference) => citationReferencePromptLine(reference)).join("\n")
    : "No selected web or uploaded-file sources for this section.";
  const messages: ResearchLlmMessages = [
    {
      role: "user",
      content: {
        type: "text",
        text:
          'Write the active report section established earlier in this session. Return strict JSON only: {"section_markdown":"...","section_summary":"..."}.\n' +
          "The frontend owns all research source execution. Do not call tools, search, or introduce evidence outside the supplied context.\n" +
          "Use only the provided context. The markdown should include the section heading.\n" +
          "When citing evidence, use ONLY the global citation numbers listed below, such as [3]. Use uploaded-file citation numbers when relying on attachment chunks. Do not invent new citation numbers and do not restart citations from [1] for this section.\n" +
          `Uploaded-file evidence policy: ${ATTACHMENT_EVIDENCE_POLICY}\n\n` +
          `Global citation map for this section:\n${citationGuide}\n\n` +
          `Web context:\n${selectedContext}\n\nAttachment chunk context:\n${attachmentContext || "(none)"}`,
      },
    },
  ];
  const text = await runSectionAgent(agentSession, messages, `Anna Agent returned an empty section for ${sectionTitle}.`);
  const parsed = parseJsonObject(text);
  const markdown = String(parsed?.section_markdown || "").trim();
  const summary = String(parsed?.section_summary || "").trim();
  if (markdown) return { markdown, summary: summary || deriveSummary(markdown) };
  const fallback = text.trim();
  if (!fallback) throw new Error(`Anna LLM returned an empty section for ${sectionTitle}.`);
  return { markdown: fallback, summary: deriveSummary(fallback) };
}

function formatIterationResearchUpdate(history: IterationEntry[], iteration: number): string {
  const entries = history.filter((entry) => entry.iteration === iteration);
  if (!entries.length) return "No results were returned for the previous iteration.";
  return JSON.stringify(
    entries.map((entry) => ({
      source_id: entry.source_id,
      source_name: entry.source_name,
      queries: entry.queries,
      results_count: entry.results_count,
      calls: entry.source_calls.map((call) => ({
        query: call.query,
        results_count: call.results_count,
        top_titles: call.top_titles,
        error: call.error,
      })),
    })),
    null,
    2,
  );
}

function buildReportContinuityContext(outline: ReportSection[], priorResults: SectionRunResult[], currentSection: ReportSection): string {
  const currentIndex = Math.max(0, outline.findIndex((section) => section.id === currentSection.id));
  const outlineBlock = outline
    .map((section, index) => {
      const position = index < currentIndex ? "PREVIOUS" : index === currentIndex ? "CURRENT" : "UPCOMING";
      return `${index + 1}. [${position}] ${section.title}\n   Scope: ${section.outline}`;
    })
    .join("\n");
  const existingReport = priorResults.length
    ? priorResults
        .map((result) => stripCitationMarkersForContinuity(result.markdown).trim())
        .filter(Boolean)
        .join("\n\n")
    : "(none yet; this is the first report section)";

  return [
    "Report continuity context:",
    "",
    "Complete report outline (respect the boundary between previous, current, and upcoming sections):",
    outlineBlock,
    "",
    "Existing report content written before this section:",
    existingReport,
    "",
    "Continuity rules:",
    "- Connect this section naturally to the existing report and keep terminology, timeframes, and conclusions consistent.",
    "- Avoid repeating detailed discussion already present in previous sections; use only a short bridge when needed.",
    "- Do not take over analysis reserved for upcoming sections.",
    "- Treat the existing report as continuity and de-duplication context only, not as evidence for new claims.",
    "- Do not copy citation numbers from the existing report. This section may cite only the current section citation map.",
  ].join("\n");
}

function stripCitationMarkersForContinuity(markdown: string): string {
  return String(markdown || "").replace(/\[\s*\d+(?:\s*[,，]\s*\d+)*\s*\]/g, "");
}

async function generateReportFraming(
  api: ResearchApi,
  query: string,
  focuses: string[],
  sections: ReportSection[],
  results: Array<{ section: ReportSection; summary: string }>,
): Promise<ReportFraming> {
  const text = await completeText(api, [
    {
      role: "user",
      content: {
        type: "text",
        text:
          'Generate report framing only. Return strict JSON only: {"title":"...","introduction":"...","conclusion":"..."}.\n' +
          "Do not rewrite section bodies.\n\n" +
          `Task:\n${query}\n\nFocuses:\n${focuses.map((focus) => `- ${focus}`).join("\n")}\n\n` +
          `Outline titles:\n${sections.map((section) => `- ${section.title}`).join("\n")}\n\n` +
          `Section summaries:\n${results.map((result) => `- ${result.section.title}: ${result.summary}`).join("\n")}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  return {
    title: String(parsed?.title || "Research Report").trim(),
    introduction: String(parsed?.introduction || `This report addresses ${query}.`).trim(),
    conclusion: String(parsed?.conclusion || "The sections above summarize the available evidence.").trim(),
  };
}

function assembleReport(framing: ReportFraming, results: Array<{ markdown: string }>): string {
  const conclusionHeading = conclusionHeadingFor(framing, results);
  return [`# ${framing.title || "Research Report"}`, framing.introduction, ...results.map((result) => result.markdown), `## ${conclusionHeading}`, framing.conclusion]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

function registerCitationReferences(registry: CitationSource[], urls: string[]): CitationReference[] {
  const references: CitationReference[] = [];
  for (const url of urls) {
    const normalized = String(url || "").trim();
    if (!normalized) continue;
    const source: CitationSource = { kind: "url", url: normalized };
    let index = registry.findIndex((item) => item.kind === "url" && item.url === normalized);
    if (index === -1) {
      registry.push(source);
      index = registry.length - 1;
    }
    references.push({ number: index + 1, source: registry[index] });
  }
  return references;
}

function registerCitationSources(registry: CitationSource[], sources: CitationSource[]): void {
  for (const source of sources) {
    if (source.kind === "url") {
      registerCitationReferences(registry, [source.url]);
    } else {
      registerAttachmentCitationReferences(registry, [
        {
          file_id: source.file_id,
          file_name: source.file_name,
          path: source.path,
          content_type: source.content_type,
          item_id: source.chunk_id,
          index: source.index,
          quote: source.quote,
        },
      ]);
    }
  }
}

function registerAttachmentCitationReferences(registry: CitationSource[], items: AttachmentSelectedItem[]): CitationReference[] {
  const references: CitationReference[] = [];
  for (const item of items) {
    const fileId = String(item.file_id || "").trim();
    const fileName = String(item.file_name || fileId || "Uploaded file").trim();
    const itemId = String(item.item_id || "").trim();
    if (!fileId && !itemId) continue;
    const source: CitationSource = {
      kind: "attachment",
      file_id: fileId || fileName,
      file_name: fileName,
      path: String(item.path || "").trim() || undefined,
      content_type: String(item.content_type || "").trim() || undefined,
      chunk_id: itemId || undefined,
      index: Number.isFinite(Number(item.index)) ? Number(item.index) : undefined,
      quote: String(item.quote || "").trim(),
    };
    let index = registry.findIndex((item) => item.kind === "attachment" && item.file_id === source.file_id && item.chunk_id === source.chunk_id);
    if (index === -1) {
      registry.push(source);
      index = registry.length - 1;
    }
    references.push({ number: index + 1, source: registry[index] });
  }
  return references;
}

function citationReferencePromptLine(reference: CitationReference): string {
  const source = reference.source;
  if (source.kind === "url") return `[${reference.number}] ${source.url}`;
  const label = attachmentChunkLabelForPrompt(source);
  return `[${reference.number}] Uploaded file: ${source.file_name}${label ? ` · ${label}` : ""}`;
}

function attachmentChunkLabelForPrompt(source: Extract<CitationSource, { kind: "attachment" }>): string {
  const chunkId = String(source.chunk_id || "");
  const match = /:(?:0*)(\d+)$/.exec(chunkId);
  if (match) return `chunk ${Number(match[1])}`;
  if (chunkId.endsWith(":image-summary")) return "";
  return chunkId ? "chunk" : "";
}

function citationSourcesFromUrls(urls: string[]): CitationSource[] {
  return urls.map((url) => ({ kind: "url", url: String(url || "").trim() })).filter((source) => source.url);
}

function isUrlCitationSource(source: CitationSource): source is Extract<CitationSource, { kind: "url" }> {
  return source.kind === "url";
}

export function normalizeSectionCitations(markdown: string, references: CitationReference[]): string {
  const normalized = markdown
    .replace(/\[\s*(\d+(?:\s*[,，]\s*\d+)+)\s*\]/g, (_match, group: string) =>
      group
        .split(/[,，]/)
        .map((number) => `[${Number(number.trim())}]`)
        .join(""),
    )
    .replace(/\[(\d+)\](?:\s*\[\1\])+/g, "[$1]");
  const allowed = new Set(references.map((reference) => reference.number));
  const invalid = Array.from(normalized.matchAll(/\[(\d+)\]/g), (match) => Number(match[1])).filter((number) => !allowed.has(number));
  if (invalid.length) {
    throw new Error(
      `Section contains citation numbers outside its current section citation map: ${Array.from(new Set(invalid)).join(", ")}.`,
    );
  }
  return normalized;
}

export function remapSelectedContextCitationLabels(context: string, references: CitationReference[]): string {
  return String(context || "").replace(/^(\[来源:[^\]\r\n]+\]\s*)\[(\d+)\](?=\s)/gm, (match, prefix: string, localNumber: string) => {
    const reference = references[Number(localNumber) - 1];
    return reference ? `${prefix}[${reference.number}]` : match;
  });
}

async function completeText(api: ResearchApi, messages: Parameters<ResearchApi["complete"]>[0]["messages"]): Promise<string> {
  const response = await api.complete({ messages });
  const content = response.content;
  return typeof content === "string" ? content : content?.text || "";
}

type ResearchLlmMessages = Parameters<ResearchApi["complete"]>[0]["messages"];

async function runSectionAgent(session: AnnaAgentSession, messages: ResearchLlmMessages, emptyMessage: string): Promise<string> {
  const prompt = [
    "You are working inside a frontend-controlled research section session.",
    "Do not call tools. Return only the response format requested below.",
    ...messages.map((message) => `${message.role === "system" ? "Standing role and instructions" : "Current task"}:\n${message.content.text}`),
  ].join("\n\n");
  return collectAgentText(session.run({ content: prompt }), emptyMessage);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    const match = /\{[\s\S]*\}/.exec(text || "");
    if (!match) return null;
    try {
      const data = JSON.parse(match[0]);
      return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

function normalizeRoleCandidate(item: unknown): RoleCandidate | null {
  const data = item as Record<string, unknown>;
  const server = String(data?.server || "").trim();
  const prompt = String(data?.agent_role_prompt || "").trim();
  if (!server || !prompt) return null;
  return { server, agent_role_prompt: prompt, rationale: String(data?.rationale || "").trim() };
}

function normalizeSectionDraft(item: unknown, index: number): ReportSection | null {
  const data = item as Record<string, unknown>;
  const title = String(data?.title || "").trim();
  const outline = String(data?.outline || data?.content || "").trim();
  if (!title || !outline) return null;
  const max = Math.max(1, Math.min(10, Number(data?.max_iterations || 5)));
  return { id: `section-${index + 1}`, title, outline, allowed_source_ids: [], max_iterations: max };
}

function padRoles(roles: RoleCandidate[]): RoleCandidate[] {
  const out = [...roles];
  while (out.length < 3) {
    out.push({
      server: `Research Role ${out.length + 1}`,
      agent_role_prompt: "You are an objective research assistant who writes structured, source-grounded reports.",
      rationale: "Fallback role generated because Anna LLM output was incomplete.",
    });
  }
  return out;
}

function padFocuses(focuses: FocusCandidate[]): FocusCandidate[] {
  const out = [...focuses];
  while (out.length < 5) out.push({ id: `focus-${out.length + 1}`, text: `Research focus ${out.length + 1}` });
  return out;
}

function padSections(sections: ReportSection[]): ReportSection[] {
  const out = [...sections];
  while (out.length < 4) {
    out.push({
      id: `section-${out.length + 1}`,
      title: `Section ${out.length + 1}`,
      outline: "Cover the most relevant evidence for this part of the research task.",
      allowed_source_ids: [],
      max_iterations: 5,
    });
  }
  return out.map((section, index) => ({ ...section, id: `section-${index + 1}` }));
}

function uniqueQueries(queries: unknown): string[] {
  if (!Array.isArray(queries)) return [];
  const cleanedQueries = queries.map((query) => String(query || "").trim()).filter(Boolean);
  return Array.from(new Set(cleanedQueries)).slice(0, 3);
}

function sortedUnique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean))).sort();
}

function mergeSourceUrlsPreservingOrder(primary: string[], additions: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [...primary, ...additions]) {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function deriveSummary(markdown: string): string {
  return markdown.replace(/[#*_>`\[\]()]/g, "").split(/\s+/).filter(Boolean).slice(0, 60).join(" ");
}

function appendRunEvent(setRunEvents: ReactSetState<RunEvent[]>, event: Parameters<typeof makeLiveRunEvent>[0]): void {
  setRunEvents((events) => [...events, makeLiveRunEvent(event)]);
}

function upsertPreview(previews: SectionPreview[], next: SectionPreview): SectionPreview[] {
  const rest = previews.filter((preview) => preview.id !== next.id);
  return [...rest, next];
}

type ReactSetState<T> = (value: T | ((previous: T) => T)) => void;

export type UseResearchJobReturn = ReturnType<typeof useResearchJob>;
