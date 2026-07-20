import { useCallback, useEffect, useRef, useState } from "react";
import { collectAgentText } from "../api/agentSession";
import type { ResearchApi } from "../api/researchApi";
import type {
  AnnaAgentSession,
  CitationSource,
  ConfirmedResearchRole,
  ReportFraming,
  ReportSection,
  ResearchJob,
  ResearchPhase,
  ResearchResult,
  ResearchSourceTestResult,
  ResearchSourceView,
  SearchResult,
  SourceCurationMode,
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

interface CitationReference {
  number: number;
  source: CitationSource;
}

interface SectionSerpQuery {
  query: string;
  researchGoal: string;
}

interface SectionQueryPlan {
  source_id?: string;
  queries: SectionSerpQuery[];
}

interface SectionResearchLearning {
  learnings: string[];
  followUpQuestions: string[];
}

interface SectionRunResult {
  section: ReportSection;
  markdown: string;
  summary: string;
  subsectionHeaders: string[];
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
  const [outlineDraft, setOutlineDraft] = useState<ReportSection[]>([]);
  const [sourceCurationMode, setSourceCurationMode] = useState<SourceCurationMode>("off");
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
        let latest = await api.getResearchJob();
        if (latest?.status === "completed" && latest.research_id) latest = await api.getResearchJobPayload(latest.research_id);
        const history = await api.listResearchJobs({ limit: 50 }).catch(() => []);
        if (cancelled) return;
        setError(null);
        setJob(latest);
        setResult(latest?.result || null);
        setHistoryJobs(history);
        setRoleCandidates(roleCandidatesFromJob(latest));
        setSourceCurationMode(sourceCurationModeFromJob(latest));
        setRunEvents(projectStoredRunEvents(latest));
        setSectionPreviews(projectSectionPreviews(latest));
        if (latest?.status === "completed" && latest.result) {
          setLastCompletedJob(latest);
          setLastCompletedResult(latest.result);
        }
        const ready = hasConfiguredSource(nextSources);
        if (!ready) setPhase("settings_required");
        else if (latest?.status === "completed" && latest.result) setPhase("completed");
        else if (latest?.status === "failed") setPhase("failed");
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
      const selected = await api.getResearchJobPayload(researchId);
      setError(null);
      setJob(selected);
      setResult(selected?.result || null);
      setRoleCandidates(roleCandidatesFromJob(selected));
      setOutlineDraft(selected?.confirmed_outline || []);
      setSourceCurationMode(sourceCurationModeFromJob(selected));
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
    setOutlineDraft([]);
    setSourceCurationMode("off");
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
      setOutlineDraft([]);
      setSourceCurationMode("off");
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
      setPhase("generating_outline");
      try {
        const saved = await api.saveConfirmedResearchRole(job.research_id, role);
        const activeJob = { ...job, ...saved, confirmed_role: role };
        setJob(activeJob);
        const readySources = readyEnabledSources(sources);
        const outline = await observeJobProgress(
          api,
          activeJob.research_id,
          api.generateOutlineDraft({
          research_id: activeJob.research_id,
          source_ids: readySources.map((source) => source.id),
          }),
          (snapshot) => setJob((current) => ({ ...(current || activeJob), ...snapshot })),
        );
        const assigned = await assignAllowedSources(api, outline, readySources);
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
      if (!job?.query || !job.confirmed_role) return;
      setPhase("generating_outline");
      try {
        const readySources = readyEnabledSources(sources);
        const outline = await observeJobProgress(
          api,
          job.research_id,
          api.generateOutlineDraft({
          research_id: job.research_id,
          source_ids: readySources.map((source) => source.id),
          instruction,
          reuse_discovery: true,
          }),
          (snapshot) => setJob((current) => ({ ...(current || job), ...snapshot })),
        );
        setOutlineDraft(await assignAllowedSources(api, outline, readySources, instruction));
        setPhase("outline_review");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, job, sources],
  );

  const runConfirmedSections = useCallback(
    async (sections: ReportSection[], options: { resume?: boolean; baseJob?: ResearchJob | null } = {}) => {
      const initialJob = options.baseJob || job;
      if (!initialJob?.research_id) throw new Error("Research job is missing research_id.");
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      setError(null);
      setPhase("running");
      try {
        let configuredJob = initialJob;
        if (!options.resume) {
          configuredJob = await api.updateResearchJob(initialJob.research_id, {
            research_options: {
              ...(initialJob.research_options || {}),
              source_curation_mode: sourceCurationMode,
              source_curation_version: "upstream-v1",
            },
          });
        }
        const activeCurationMode = options.resume ? sourceCurationModeFromJob(configuredJob) : sourceCurationMode;
        let currentJob = options.resume ? configuredJob : await api.saveConfirmedResearchOutline(initialJob.research_id, sections);
        const confirmedSections = currentJob.confirmed_outline?.length ? currentJob.confirmed_outline : sections;
        const role = currentJob.confirmed_role || initialJob.confirmed_role;
        if (!role || !confirmedSections.length) throw new Error("Research job is not ready to run.");
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
            sources: readyEnabledSources(sources),
            citationRegistry,
            sourceCurationMode: activeCurationMode,
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
        const framing = await generateReportFraming(api, currentJob.query || initialJob.query || "", confirmedSections, sectionResults);
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
    [api, job, sourceCurationMode, sources],
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
          subsection_headers: previousResult.subsection_headers || [],
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
          subsection_headers: previous?.subsection_headers || [],
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
            subsection_headers: previous?.subsection_headers || [],
            source_urls: previous?.source_urls || [],
          },
        };
        structuredJob = mergeSectionResults(
          {
            ...structuredJob,
            ...savedSectionJob,
            confirmed_role: savedSectionJob.confirmed_role || structuredJob.confirmed_role,
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
      setError(null);
      try {
        const baseJob = researchId ? await api.getResearchJobPayload(researchId) : job;
        if (!baseJob) throw new Error("Research job was not found.");
        const hydratedJob = await hydrateCompletedSectionResults(api, baseJob);
        const sections = hydratedJob.confirmed_outline?.length ? hydratedJob.confirmed_outline : outlineDraft;
        await runConfirmedSections(sections, { resume: true, baseJob: hydratedJob });
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
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
    outlineDraft,
    sourceCurationMode,
    runEvents,
    sectionPreviews,
    setRoleCandidates,
    setOutlineDraft,
    setSourceCurationMode,
    isBusy: phase === "starting" || phase === "generating_roles" || phase === "generating_outline" || phase === "running" || phase === "loading_result",
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

function reusableSectionResult(section: ReportSection, result: NonNullable<ResearchJob["section_results"]>[string] | undefined): SectionRunResult | null {
  if (!result || result.status !== "completed") return null;
  const markdown = String(result.section_markdown || "").trim();
  if (!markdown) return null;
  const sourceUrls = Array.isArray(result.source_urls) ? result.source_urls.filter(Boolean) : [];
  return {
    section,
    markdown,
    summary: result.section_summary || deriveSummary(markdown),
    subsectionHeaders: result.subsection_headers || [],
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
        subsectionHeaders: result.subsection_headers || [],
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
    selectedContext: stripInternalChunkMarkers(selected.selected_context || ""),
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

const ATTACHMENT_EVIDENCE_POLICY =
  "Use this analysis as supporting evidence only when the claim is directly grounded in visible content. Do not use it to verify external facts, dates, source credibility, or causal explanations unless those are explicitly visible in the attachment content.";

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

const MAX_ATTACHMENT_SEARCH_BASELINE_CHARS = 4_000;

export function buildAttachmentSearchBaseline(
  job: ResearchJob,
  selection: { context: string; items: AttachmentSelectedItem[] },
): string {
  if (!selection.items.length) return "";
  const files = new Map((job.attachment_context?.files || []).map((file) => [file.id, file]));
  const grouped = new Map<string, AttachmentSelectedItem[]>();
  for (const item of selection.items) {
    const key = String(item.file_id || item.file_name || item.item_id || "attachment");
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  const blocks: string[] = [];
  for (const [key, items] of grouped) {
    const file = files.get(String(items[0]?.file_id || ""));
    const analysis = file?.analysis;
    const lines = [`File: ${file?.name || items[0]?.file_name || key}`];
    if (analysis?.summary) lines.push(`Summary: ${analysis.summary}`);
    const points = (analysis?.key_points || []).slice(0, 4).filter(Boolean);
    if (points.length) lines.push(`Key points:\n${points.map((point) => `  - ${point}`).join("\n")}`);
    if (analysis?.relevance) lines.push(`Research relevance: ${analysis.relevance}`);

    const payload = analysis?.payload && typeof analysis.payload === "object" && !Array.isArray(analysis.payload)
      ? analysis.payload as Record<string, unknown>
      : null;
    if (analysis?.type === "image" && payload) {
      const visibleText = Array.isArray(payload.visible_text)
        ? payload.visible_text
            .map((value) => value && typeof value === "object" ? String((value as Record<string, unknown>).text || "").trim() : "")
            .filter(Boolean)
            .slice(0, 6)
        : [];
      const observations = Array.isArray(payload.key_observations)
        ? payload.key_observations
            .map((value) => value && typeof value === "object" ? String((value as Record<string, unknown>).observation || "").trim() : "")
            .filter(Boolean)
            .slice(0, 4)
        : [];
      const uncertainties = Array.isArray(payload.uncertainties)
        ? payload.uncertainties.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 3)
        : [];
      if (visibleText.length) lines.push(`Visible text:\n${visibleText.map((value) => `  - ${value}`).join("\n")}`);
      if (observations.length) lines.push(`Visible observations:\n${observations.map((value) => `  - ${value}`).join("\n")}`);
      if (uncertainties.length) lines.push(`Uncertainties:\n${uncertainties.map((value) => `  - ${value}`).join("\n")}`);
    }

    const excerpts = items
      .filter((item) => item.kind !== "image_analysis")
      .map((item) => String(item.quote || "").trim())
      .filter(Boolean)
      .slice(0, 4);
    if (excerpts.length) lines.push(`Selected excerpts:\n${excerpts.map((value) => `  - ${value}`).join("\n")}`);
    if (lines.length > 1) blocks.push(lines.join("\n"));
  }
  if (!blocks.length) return "";
  return [
    `Uploaded-file evidence policy: ${ATTACHMENT_EVIDENCE_POLICY}`,
    "Use this baseline to identify what is already supported and what still needs external research.",
    ...blocks,
  ].join("\n\n").slice(0, MAX_ATTACHMENT_SEARCH_BASELINE_CHARS);
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
          "Write each user-visible server name and agent_role_prompt in the same language as the task. Do not default to English when the task is written in another language. " +
          "Each agent_role_prompt must be specific, source-grounded, and suitable as the later system prompt for outline planning and report writing.\n" +
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

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
  sources: ResearchSourceView[];
  citationRegistry: CitationSource[];
  sourceCurationMode: SourceCurationMode;
  onEvent?(event: Parameters<typeof makeLiveRunEvent>[0]): void;
}): Promise<{ markdown: string; summary: string; subsectionHeaders: string[]; sourceUrls: string[]; citationSources: CitationSource[] }> {
  const allowedSources = input.sources.filter((source) => input.section.allowed_source_ids.includes(source.id));
  if (!allowedSources.length) throw new Error(`Section has no configured allowed source: ${input.section.title}`);
  const continuityContext = buildReportContinuityContext(input.reportOutline, input.priorSectionResults, input.section);
  const session = await input.api.createAgentSession();
  let researchSessionDeleted = false;
  const closeResearchSession = async () => {
    if (researchSessionDeleted) return;
    researchSessionDeleted = true;
    await session.delete().catch(() => undefined);
  };
  try {
    return await runSectionInSession({ ...input, allowedSources, continuityContext, session, closeResearchSession });
  } finally {
    await closeResearchSession();
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
    citationRegistry: CitationSource[];
    sourceCurationMode: SourceCurationMode;
    onEvent?(event: Parameters<typeof makeLiveRunEvent>[0]): void;
    allowedSources: ResearchSourceView[];
    continuityContext: string;
    session: AnnaAgentSession;
    closeResearchSession: () => Promise<void>;
  },
): Promise<{ markdown: string; summary: string; subsectionHeaders: string[]; sourceUrls: string[]; citationSources: CitationSource[] }> {
  const { api, job, section, role, citationRegistry, onEvent, allowedSources, continuityContext, session } = input;
  const learnings: string[] = [];
  let followUpQuestions: string[] = [];
  let previousResearchGoals: string[] = [];
  let breadth = 3;
  let selected: Awaited<ReturnType<ResearchApi["selectSectionContext"]>> | null = null;
  const executedQueries: string[] = [];
  const attachmentSelection = await selectAttachmentContextForSection(api, job, section);
  const attachmentContext = sanitizeEvidenceContextUrls(attachmentSelection.context);
  const attachmentBaseline = sanitizeEvidenceContextUrls(buildAttachmentSearchBaseline(job, attachmentSelection));
  for (let iteration = 1; iteration <= section.max_iterations; iteration++) {
    await updateJob(api, job, { stage: "section_research", iteration, progress: progressForIteration(iteration, section.max_iterations) });
    onEvent?.({
      kind: "decision",
      sectionId: section.id,
      sectionTitle: section.title,
      title: "Generating deep-research queries",
      detail: `Depth ${iteration}/${section.max_iterations} · breadth ${breadth}`,
    });
    const plan = await generateSectionSerpQueries({
      query: job.query || "",
      rolePrompt: role.agent_role_prompt,
      section,
      iteration,
      maxIterations: section.max_iterations,
      numQueries: breadth,
      enabledSources: allowedSources,
      facets: sectionFacets(job, section),
      learnings,
      followUpQuestions,
      previousResearchGoals,
      executedQueries,
      attachmentBaseline,
      agentSession: session,
    });
    const sourceId = allowedSources.some((source) => source.id === plan.source_id) ? String(plan.source_id) : allowedSources[0].id;
    const executedQueryKeys = new Set(executedQueries.map((query) => query.toLocaleLowerCase()));
    const queries = uniqueQueries(plan.queries.map((item) => item.query))
      .filter((query) => !executedQueryKeys.has(query.toLocaleLowerCase()))
      .slice(0, breadth);
    if (!queries.length) throw new Error(`Anna Agent did not generate research queries for ${section.title}.`);
    previousResearchGoals = plan.queries
      .filter((item) => queries.includes(item.query))
      .map((item) => item.researchGoal);
    executedQueries.push(...queries);
    const call = await api.callSectionResearchSource({
      research_id: requiredResearchId(job),
      section_id: section.id,
      iteration,
      source_id: sourceId,
      queries,
      research_decision: {
        type: "call_source",
        knowledge_gap: previousResearchGoals.join(" ").slice(0, 1000),
        rationale: `deep-research depth ${iteration}/${section.max_iterations}; breadth ${breadth}`,
        target_facet_ids: sectionFacets(job, section).map((facet) => facet.id),
      },
    });
    if (call.source_call) {
      onEvent?.(sourceCallEvent(section, call.source_call));
    }
    selected = await api.selectSectionContext({
      research_id: requiredResearchId(job),
      section_id: section.id,
      iteration,
      query: `${job.query || ""}\n\nSection: ${section.title}\n${section.outline}`,
      search_queries: queries,
    });
    const nextBreadth = Math.max(1, Math.ceil(breadth / 2));
    const learningBatch = await processSectionSerpResults({
      agentSession: session,
      section,
      queryPlan: plan.queries.filter((item) => queries.includes(item.query)),
      selectedContext: sanitizeEvidenceContextUrls(stripInternalChunkMarkers(selected.selected_context || ""), false),
      numLearnings: 3,
      numFollowUpQuestions: nextBreadth,
    });
    mergeUniqueText(learnings, learningBatch.learnings);
    followUpQuestions = learningBatch.followUpQuestions;
    breadth = nextBreadth;
  }
  if (!selected) throw new Error(`No research evidence was selected for ${section.title}.`);
  if (section.max_iterations > 1) {
    selected = await api.selectSectionContext({
      research_id: requiredResearchId(job),
      section_id: section.id,
      query: `${job.query || ""}\n\nSection: ${section.title}\n${section.outline}`,
      search_queries: uniqueQueriesUnlimited(executedQueries),
    });
  }
  const curation = input.sourceCurationMode === "llm" && (selected.selected_sources || []).length > 0
    ? await curateSelectedSources(api, job, section, selected.selected_sources || [])
    : null;
  const selectedSources = curation?.sources || selected.selected_sources || [];
  const selectedContext = sanitizeEvidenceContextUrls(stripInternalChunkMarkers(
    curation ? buildCuratedSelectedContext(selectedSources) : selected.selected_context || "",
  ));
  const selectedSourceUrls = curation ? selectedSources.map((source) => source.url).filter(Boolean) : selected.source_urls || [];
  if (curation) {
    await api.updateResearchJob(requiredResearchId(job), {
      section_source_curations: {
        ...(job.section_source_curations || {}),
        [section.id]: curation.audit,
      },
    }).catch(() => undefined);
  }
  onEvent?.({
    kind: "context_selected",
    sectionId: section.id,
    sectionTitle: section.title,
    title: "Context selected",
    detail: curation
      ? `${selectedSourceUrls.length}/${(selected.selected_sources || []).length} sources${curation.audit.status === "failed_open" ? " · fallback" : ""}`
      : `${selectedSourceUrls.length} sources`,
    count: selectedSourceUrls.length,
  });
  const sourceUrls = selectedSourceUrls;
  await input.closeResearchSession();
  const writerSession = await api.createAgentSession();
  try {
    onEvent?.({
      kind: "decision",
      sectionId: section.id,
      sectionTitle: section.title,
      title: "Planning subsection structure",
      detail: "Up to 5 evidence-grounded headers",
    });
    const subsectionHeaders = await generateSubsectionHeaders({
      agentSession: writerSession,
      query: job.query || "",
      section,
      continuityContext,
      selectedContext,
      attachmentContext,
    });
    const webReferences = registerCitationReferences(citationRegistry, sourceUrls);
    const attachmentReferences = registerAttachmentCitationReferences(citationRegistry, attachmentSelection.items);
    const citationReferences = [...webReferences, ...attachmentReferences];
    const relevantPriorContents = selectRelevantPriorWrittenContents(
      input.priorSectionResults,
      section,
      subsectionHeaders,
    );
    const writer = await writeSection(
      writerSession,
      stripSelectedContextCitationLabels(selectedContext),
      citationReferences,
      attachmentContext,
      job.query || "",
      section,
      subsectionHeaders,
      continuityContext,
      relevantPriorContents,
    );
    const markdown = convertSectionUrlCitations(writer.markdown, citationReferences);
    const sectionCitationSources = citationReferences.map((reference) => reference.source);
    await api.saveSectionResult({
      research_id: requiredResearchId(job),
      section_id: section.id,
      section_markdown: markdown,
      section_summary: writer.summary,
      subsection_headers: subsectionHeaders,
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
    return { ...writer, markdown, subsectionHeaders, sourceUrls, citationSources: sectionCitationSources };
  } finally {
    await writerSession.delete().catch(() => undefined);
  }
}

async function generateSectionSerpQueries(input: {
  query: string;
  rolePrompt: string;
  section: ReportSection;
  iteration: number;
  maxIterations: number;
  numQueries: number;
  enabledSources: ResearchSourceView[];
  facets?: Array<{ id: string; task: string }>;
  learnings: string[];
  followUpQuestions: string[];
  previousResearchGoals: string[];
  executedQueries: string[];
  attachmentBaseline: string;
  agentSession: AnnaAgentSession;
}): Promise<SectionQueryPlan> {
  const { query, rolePrompt, section, iteration, maxIterations, numQueries, enabledSources, facets = [], agentSession } = input;
  const sourcesBlock = enabledSources
    .map((source) => `- ${source.id} (${source.name}): ${source.description || "No capability description provided."}`)
    .join("\n");
  const facetsBlock = facets.length
    ? facets.map((facet) => `- ${facet.id}: ${facet.task}`).join("\n")
    : "(use the current section task and boundary)";
  const learningsBlock = input.learnings.length ? input.learnings.map((learning) => `- ${learning}`).join("\n") : "(none yet)";
  const followUpBlock = input.followUpQuestions.length ? input.followUpQuestions.map((question) => `- ${question}`).join("\n") : "(none yet)";
  const goalsBlock = input.previousResearchGoals.length ? input.previousResearchGoals.map((goal) => `- ${goal}`).join("\n") : "(none yet)";
  const executedQueriesBlock = input.executedQueries.length ? input.executedQueries.map((executedQuery) => `- ${executedQuery}`).join("\n") : "(none yet)";
  const attachmentBaselineBlock = input.attachmentBaseline
    ? iteration === 1
      ? input.attachmentBaseline
      : "(provided at depth 1 in this session; continue using it as the existing attachment evidence baseline)"
    : "(none)";
  const temporalSearchRules =
    `Current date: ${localDateString(new Date())}.\n` +
    'Interpret "recent" and "latest" relative to this date. Prioritize the current year and the most recent available months for recent-event research. ' +
    "Do not add an older year unless the task explicitly requests that historical period or it is needed for a clearly stated comparison.";
  const prompt = [
    rolePrompt,
    "",
    "Generate SERP queries for the next depth of one report section.",
    `Return at most ${numQueries} queries, but return fewer when the research direction is already clear.`,
    "Every query must be unique and materially different from the others.",
    "Use previous learnings to make later-depth queries more specific. Do not repeat an earlier query.",
    "Use uploaded attachment evidence to avoid redundant searches and prioritize missing context, independent corroboration, source provenance, current developments, and conflicting evidence.",
    "Do not put attachment text or file names into a query unless they are themselves part of the requested research subject.",
    "Treat attachment evidence as supporting evidence, not as externally verified facts.",
    "The frontend owns all research source execution. Do not call tools or search directly.",
    `Return exactly one JSON object: {"source_id":"<allowed-id>","queries":[{"query":"...","research_goal":"..."}]}.`,
    "For each research_goal, first state what the query must establish, then explain how its results should advance deeper research and identify likely next directions.",
    "Do not include markdown, prose, code fences, or extra keys.",
    "",
    temporalSearchRules,
    "",
    `Research task:\n${query}`,
    "",
    `Section subtopic task:\n${section.title}\n${section.outline}`,
    "",
    `Research facets:\n${facetsBlock}`,
    "",
    `Uploaded attachment evidence baseline:\n${attachmentBaselineBlock}`,
    "",
    `Allowed sources:\n${sourcesBlock}`,
    "",
    `Depth: ${iteration}/${maxIterations}`,
    `Previous research goals:\n${goalsBlock}`,
    `Already executed queries (do not repeat):\n${executedQueriesBlock}`,
    `Learnings from previous research:\n${learningsBlock}`,
    `Follow-up research directions:\n${followUpBlock}`,
  ].join("\n");
  const messages: ResearchLlmMessages = [
    {
      role: "user",
      content: {
        type: "text",
        text: prompt,
      },
    },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptMessages = attempt === 0 ? messages : [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: `Your previous query plan was invalid. Return exactly {"source_id":"<allowed-id>","queries":[{"query":"...","research_goal":"..."}]}, with 1 to ${numQueries} unique queries and no prose or code fences.`,
      },
    }];
    const text = await runSectionAgent(agentSession, attemptMessages, `Anna Agent returned an empty query plan for ${section.title}.`);
    const plan = parseSectionQueryPlan(text, numQueries, enabledSources);
    if (plan) return plan;
  }
  throw new Error(`Anna Agent did not return valid SERP queries for ${section.title}.`);
}

async function processSectionSerpResults(input: {
  agentSession: AnnaAgentSession;
  section: ReportSection;
  queryPlan: SectionSerpQuery[];
  selectedContext: string;
  numLearnings: number;
  numFollowUpQuestions: number;
}): Promise<SectionResearchLearning> {
  const planBlock = input.queryPlan
    .map((item) => `<query>\n${item.query}\n</query>\n<research_goal>\n${item.researchGoal}\n</research_goal>`)
    .join("\n\n");
  const prompt = [
    "Process the selected contents from the latest SERP searches for this report section.",
    `Return at most ${input.numLearnings} learnings and at most ${input.numFollowUpQuestions} follow-up research questions. Return fewer when the evidence is limited or clear.`,
    "Each learning must be unique, concise, information-dense, and directly grounded in the supplied contents.",
    "Preserve exact entities, metrics, numbers, and dates when they are visibly supported by the contents.",
    "Follow-up questions must advance the research beyond what is already known and must not merely rephrase an executed query.",
    "If the supplied contents contain no usable evidence, return empty arrays rather than inventing information.",
    `Return exactly one JSON object: {"learnings":["..."],"follow_up_questions":["..."]}.`,
    "Do not include markdown, prose, code fences, or extra keys.",
    "",
    `Section:\n${input.section.title}\n${input.section.outline}`,
    "",
    `Executed query plans:\n${planBlock}`,
    "",
    `<contents>\n${input.selectedContext || "(no usable evidence)"}\n</contents>`,
  ].join("\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: ResearchLlmMessages = [{
      role: "user",
      content: {
        type: "text",
        text: attempt === 0
          ? prompt
          : `Your previous learning response was invalid. Return exactly {"learnings":["..."],"follow_up_questions":["..."]}, with no more than ${input.numLearnings} learnings and ${input.numFollowUpQuestions} follow-up questions.`,
      },
    }];
    const text = await runSectionAgent(input.agentSession, messages, `Anna Agent returned empty SERP learnings for ${input.section.title}.`);
    const learning = parseSectionResearchLearning(text, input.numLearnings, input.numFollowUpQuestions);
    if (learning) return learning;
  }
  throw new Error(`Anna Agent did not return valid SERP learnings for ${input.section.title}.`);
}

function parseSectionQueryPlan(text: string, maxQueries: number, enabledSources: ResearchSourceView[]): SectionQueryPlan | null {
  const parsed = parseJsonObject(text);
  const values = Array.isArray(parsed?.queries) ? parsed.queries : [];
  if (!values.length || values.length > maxQueries) return null;
  const queries = values.map((value) => {
    const item = value as Record<string, unknown>;
    return {
      query: String(item?.query || "").trim(),
      researchGoal: String(item?.research_goal || "").trim(),
    };
  });
  if (queries.some((item) => !item.query || !item.researchGoal)) return null;
  if (new Set(queries.map((item) => item.query.toLocaleLowerCase())).size !== queries.length) return null;
  const requestedSource = String(parsed?.source_id || "").trim();
  const sourceId = enabledSources.some((source) => source.id === requestedSource) ? requestedSource : enabledSources[0]?.id;
  if (!sourceId) return null;
  return { source_id: sourceId, queries };
}

function parseSectionResearchLearning(text: string, maxLearnings: number, maxFollowUps: number): SectionResearchLearning | null {
  const parsed = parseJsonObject(text);
  if (!Array.isArray(parsed?.learnings) || !Array.isArray(parsed?.follow_up_questions)) return null;
  const learnings = uniqueTextValues(parsed.learnings, maxLearnings);
  const followUpQuestions = uniqueTextValues(parsed.follow_up_questions, maxFollowUps);
  if (learnings.length !== parsed.learnings.length || followUpQuestions.length !== parsed.follow_up_questions.length) return null;
  return { learnings, followUpQuestions };
}

async function generateSubsectionHeaders(input: {
  agentSession: AnnaAgentSession;
  query: string;
  section: ReportSection;
  continuityContext: string;
  selectedContext: string;
  attachmentContext: string;
}): Promise<string[]> {
  const prompt = [
    "Plan the subsection structure for the active report section after formal research is complete.",
    'Return exactly one valid JSON object: {"subsection_headers":["..."]}. Do not include markdown, code fences, prose, or extra keys.',
    "",
    `Current date: ${localDateString(new Date())}`,
    "",
    `Research task:\n${input.query}`,
    "",
    `Current subtopic:\nTitle: ${input.section.title}\nTask and boundary: ${input.section.outline}`,
    "",
    input.continuityContext,
    "",
    "Rules:",
    "- Return at least 1 and at most 5 subsection headers, ordered for a coherent section.",
    "- Each header must be a distinct analysis dimension supported by the selected evidence.",
    "- Return plain header text without Markdown markers, bullets, numbering, or citations.",
    "- Do not include introduction, conclusion, summary, references, or sources sections.",
    "- Do not repeat analysis or subsection headers already used in previous sections.",
    "- Do not cover analysis reserved for upcoming sections.",
    "- Treat figures found in retrieved evidence as claims to verify, not established conclusions.",
    "- Numbers may appear only when supplied by the user or needed to define a timeframe or research scope.",
    "- Do not write section content or make unsupported factual claims in a header.",
    "",
    `Selected web evidence:\n${input.selectedContext || "(none)"}`,
    "",
    `Selected attachment evidence:\n${input.attachmentContext || "(none)"}`,
  ].join("\n");

  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: ResearchLlmMessages = [{
      role: "user",
      content: {
        type: "text",
        text: attempt === 0
          ? prompt
          : 'Your previous subsection header response was invalid. Return exactly {"subsection_headers":["..."]} with 1 to 5 unique plain-text headers and no other text.',
      },
    }];
    let text = "";
    try {
      text = await runSectionAgent(
        input.agentSession,
        messages,
        `Anna Agent returned an empty subsection header plan for ${input.section.title}.`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("empty subsection header plan")) continue;
      throw error;
    }
    const headers = parseSubsectionHeaders(text);
    if (headers) return headers;
  }
  throw new Error(`Anna Agent did not return valid subsection headers for ${input.section.title}.`);
}

function parseSubsectionHeaders(text: string): string[] | null {
  const parsed = parseJsonObject(text);
  if (!Array.isArray(parsed?.subsection_headers)) return null;
  const headers = parsed.subsection_headers.map((value) => String(value || "").trim());
  if (headers.length < 1 || headers.length > 5 || headers.some((header) => !isValidSubsectionHeader(header))) return null;
  const unique = new Set(headers.map((header) => header.toLocaleLowerCase()));
  return unique.size === headers.length ? headers : null;
}

function isValidSubsectionHeader(header: string): boolean {
  if (!header || header.length > 200) return false;
  if (/^(?:#{1,6}|[-*+]\s|\d+[.)、]\s*)/.test(header)) return false;
  return !/^(?:introduction|conclusion|summary|references?|sources?|引言|结论|总结|参考文献|来源)$/i.test(header);
}

async function writeSection(
  agentSession: AnnaAgentSession,
  selectedContext: string,
  citationReferences: CitationReference[],
  attachmentContext: string,
  researchTask: string,
  section: ReportSection,
  subsectionHeaders: string[],
  continuityContext: string,
  relevantPriorContents: string,
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
          'Write one subtopic report for the larger research report. Return strict JSON only: {"section_markdown":"...","section_summary":"..."}.\n' +
          "The frontend owns all research source execution. Do not call tools or search.\n" +
          "Write only this section's main body: no report introduction, conclusion, references list, or table of contents.\n" +
          "Write the active section title as one H2 heading and match the language of the research task.\n" +
          "Use every required subsection header exactly once, in the listed order, as H3 headings. Do not rename, omit, reorder, or add other H3 headings.\n" +
          "Make the analysis specific, evidence-led, and non-repetitive. Synthesize agreements, conflicts, uncertainty, dates, and quantitative details when the supplied evidence supports them.\n" +
          "Use the prior-report material only to preserve terminology, maintain the argument's progression, and avoid repetition. It is not evidence for new claims. Use at most a brief transition from the previous section.\n" +
          "Do not cover analysis reserved for later sections. Claims in this section must be grounded in the current web or attachment evidence.\n" +
          "When citing evidence, use only Markdown URL citations in this exact upstream-style form: ([in-text citation](SOURCE_URL)). Copy SOURCE_URL exactly from the allowed source identifier list below.\n" +
          "Never write numeric citations such as [1], never invent or shorten a URL, and never use a URL that is not in the allowed list. Uploaded-file evidence has an anna-attachment:// identifier and uses the same Markdown citation form.\n" +
          "Place citations immediately after the sentence or paragraph they support. Do not cite headings, transitions, or claims drawn only from continuity material.\n" +
          `Uploaded-file evidence policy: ${ATTACHMENT_EVIDENCE_POLICY}\n\n` +
          `Main research task:\n${researchTask}\n\n` +
          `Current subtopic:\nTitle: ${section.title}\nTask and boundary: ${section.outline}\n\n` +
          `${continuityContext}\n\n` +
          `Relevant prior written passages selected for overlap control:\n${relevantPriorContents}\n\n` +
          `Required subsection headers:\n${subsectionHeaders.map((header, index) => `${index + 1}. ${header}`).join("\n")}\n\n` +
          `Allowed source identifiers for this section:\n${citationGuide}\n\n` +
          `Web context:\n${selectedContext}\n\nAttachment chunk context:\n${attachmentContext || "(none)"}`,
      },
    },
  ];
  const text = await runSectionAgent(agentSession, messages, `Anna Agent returned an empty section for ${section.title}.`);
  const parsed = parseJsonObject(text);
  const markdown = String(parsed?.section_markdown || "").trim();
  const summary = String(parsed?.section_summary || "").trim();
  if (markdown) {
    return { markdown, summary: summary || deriveSummary(markdown) };
  }
  const fallback = text.trim();
  if (!fallback) throw new Error(`Anna LLM returned an empty section for ${section.title}.`);
  return { markdown: fallback, summary: deriveSummary(fallback) };
}

function sectionFacets(job: ResearchJob, section: ReportSection): Array<{ id: string; task: string }> {
  const sectionFacetIds = new Set(section.facet_ids || []);
  return (job.outline_discovery?.facets || []).filter((facet) => sectionFacetIds.has(facet.id));
}

async function observeJobProgress<T>(
  api: ResearchApi,
  researchId: string,
  task: Promise<T>,
  onSnapshot: (job: ResearchJob) => void,
): Promise<T> {
  let polling = false;
  let active = true;
  const timer = window.setInterval(() => {
    if (polling) return;
    polling = true;
    void api.getResearchJob(researchId)
      .then((snapshot) => {
        if (active && snapshot) onSnapshot(snapshot);
      })
      .catch(() => undefined)
      .finally(() => {
        polling = false;
      });
  }, 600);
  try {
    return await task;
  } finally {
    active = false;
    window.clearInterval(timer);
  }
}

function buildReportContinuityContext(outline: ReportSection[], priorResults: SectionRunResult[], currentSection: ReportSection): string {
  const currentIndex = Math.max(0, outline.findIndex((section) => section.id === currentSection.id));
  const outlineBlock = outline
    .map((section, index) => {
      const position = index < currentIndex ? "PREVIOUS" : index === currentIndex ? "CURRENT" : "UPCOMING";
      return `${index + 1}. [${position}] ${section.title}\n   Scope: ${section.outline}`;
    })
    .join("\n");
  const completedSectionSummaries = priorResults.length
    ? priorResults
        .map((result) => {
          const summary = stripCitationMarkersForContinuity(result.summary || deriveSummary(result.markdown)).trim();
          return `- ${result.section.title}: ${summary}`;
        })
        .join("\n")
    : "(none yet; this is the first report section)";
  const existingSubsectionHeaders = priorResults.length
    ? priorResults
        .flatMap((result) => result.subsectionHeaders.map((header) => `- ${result.section.title}: ${header}`))
        .join("\n") || "(none recorded)"
    : "(none yet; this is the first report section)";

  return [
    "Report continuity context:",
    "",
    "Complete report outline (respect the boundary between previous, current, and upcoming sections):",
    outlineBlock,
    "",
    "Completed section summaries (continuity only, not evidence):",
    completedSectionSummaries,
    "",
    "Subsection headers already used by previous sections:",
    existingSubsectionHeaders,
    "",
    "Continuity rules:",
    "- Connect this section naturally to the existing report and keep terminology, timeframes, and conclusions consistent.",
    "- Avoid repeating detailed discussion already present in previous sections; use only a short bridge when needed.",
    "- Do not take over analysis reserved for upcoming sections.",
    "- Treat the existing report as continuity and de-duplication context only, not as evidence for new claims.",
    "- Do not copy citation numbers from the existing report. This section may cite only the current section citation map.",
  ].join("\n");
}

const MAX_RELEVANT_PRIOR_PASSAGES = 6;
const MAX_RELEVANT_PRIOR_CHARS = 4_000;

function selectRelevantPriorWrittenContents(
  priorResults: SectionRunResult[],
  currentSection: ReportSection,
  subsectionHeaders: string[],
): string {
  if (!priorResults.length) return "(none; this is the first report section)";
  const queryTokens = continuityTokens([currentSection.title, currentSection.outline, ...subsectionHeaders].join(" "));
  const candidates = priorResults.flatMap((result, sectionIndex) =>
    splitPriorWrittenPassages(result.markdown).map((passage, passageIndex) => ({
      passage,
      sectionTitle: result.section.title,
      sectionIndex,
      passageIndex,
      score: overlapScore(queryTokens, continuityTokens(passage)),
    })),
  );
  const selected = candidates
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      right.sectionIndex - left.sectionIndex ||
      left.passageIndex - right.passageIndex,
    )
    .slice(0, MAX_RELEVANT_PRIOR_PASSAGES)
    .sort((left, right) => left.sectionIndex - right.sectionIndex || left.passageIndex - right.passageIndex);
  if (!selected.length) return "(none selected; rely on completed section summaries for continuity)";

  const parts: string[] = [];
  let remaining = MAX_RELEVANT_PRIOR_CHARS;
  for (const candidate of selected) {
    const label = `[Previous section: ${candidate.sectionTitle}]\n`;
    const available = remaining - label.length;
    if (available <= 0) break;
    const passage = candidate.passage.slice(0, available).trim();
    if (!passage) continue;
    parts.push(`${label}${passage}`);
    remaining -= label.length + passage.length;
  }
  return parts.join("\n\n") || "(none selected; rely on completed section summaries for continuity)";
}

function splitPriorWrittenPassages(markdown: string): string[] {
  return stripCitationMarkersForContinuity(markdown)
    .split(/\n\s*\n+/)
    .map((passage) => passage.replace(/^#{1,6}\s+/gm, "").trim())
    .filter((passage) => passage.length >= 40);
}

function continuityTokens(value: string): Set<string> {
  const normalized = String(value || "").toLocaleLowerCase();
  const tokens = new Set(normalized.match(/[a-z0-9][a-z0-9._%+-]{1,}|[\u3400-\u9fff]{2,}/g) || []);
  for (const sequence of normalized.match(/[\u3400-\u9fff]{3,}/g) || []) {
    for (let index = 0; index < sequence.length - 1; index++) tokens.add(sequence.slice(index, index + 2));
  }
  return tokens;
}

function overlapScore(queryTokens: Set<string>, passageTokens: Set<string>): number {
  let score = 0;
  for (const token of queryTokens) {
    if (passageTokens.has(token)) score += token.length > 3 ? 2 : 1;
  }
  return score;
}

function stripCitationMarkersForContinuity(markdown: string): string {
  return String(markdown || "").replace(/\[\s*\d+(?:\s*[,，]\s*\d+)*\s*\]/g, "");
}

async function generateReportFraming(
  api: ResearchApi,
  query: string,
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
          `Task:\n${query}\n\n` +
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
  if (source.kind === "url") return `- ${source.url}`;
  const label = attachmentChunkLabelForPrompt(source);
  return `- ${citationSourceIdentifier(source)} · Uploaded file: ${source.file_name}${label ? ` · ${label}` : ""}`;
}

function citationSourceIdentifier(source: CitationSource): string {
  if (source.kind === "url") return source.url;
  const file = encodeURIComponent(source.file_id || source.file_name || "file");
  const chunk = encodeURIComponent(source.chunk_id || String(source.index || "document"));
  return `anna-attachment://${file}/${chunk}`;
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

interface SourceCurationDecision {
  candidateId: string;
  decision: "include" | "exclude";
  reason: string;
}

interface SourceCurationAudit {
  mode: "llm";
  version: "upstream-v1";
  status: "completed" | "failed_open";
  candidate_count: number;
  included_count: number;
  excluded_count: number;
  decisions: SourceCurationDecision[];
  error?: string;
  curated_at: string;
}

export async function curateSelectedSources(
  api: ResearchApi,
  job: ResearchJob,
  section: ReportSection,
  candidates: SearchResult[],
): Promise<{ sources: SearchResult[]; audit: SourceCurationAudit }> {
  const now = new Date();
  const curatedAt = now.toISOString();
  const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (candidates.length <= 1) {
    return {
      sources: candidates,
      audit: {
        mode: "llm",
        version: "upstream-v1",
        status: "completed",
        candidate_count: candidates.length,
        included_count: candidates.length,
        excluded_count: 0,
        decisions: candidates.map((_source, index) => ({ candidateId: `source-${index + 1}`, decision: "include", reason: "Only available candidate." })),
        curated_at: curatedAt,
      },
    };
  }

  const sourceBlock = candidates
    .map((source, index) => {
      const content = String(source.content || "").trim().slice(0, 2200);
      return [
        `Candidate ID: source-${index + 1}`,
        `Source: ${source.url}`,
        `Title: ${source.title || "(untitled)"}`,
        `Content: ${content || "(no usable content)"}`,
      ].join("\n");
    })
    .join("\n\n");

  try {
    const text = await completeText(api, [
      {
        role: "system",
        content: {
          type: "text",
          text: "You are an expert research source curator. Evaluate only the supplied candidates and return strict JSON.",
        },
      },
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Current date: ${currentDate}. Judge whether information is recent, outdated, or future-dated relative to this date.\n\n` +
            `Research task:\n${job.query || ""}\n\nReport section:\n${section.title}\n${section.outline}\n\n` +
            "Evaluate and curate the retrieved source excerpts for this section. Prioritize relevant, credible, current, objective sources with statistics, dates, concrete data, or unique insights. Favor authoritative and primary sources where appropriate, but retain other useful perspectives unless they are clearly irrelevant, unusable, severely outdated for the task, duplicative without added value, or obviously untrustworthy. Err on the side of inclusion. Do not rewrite or summarize source content. Do not invent facts or candidate IDs.\n\n" +
            'Return exactly one JSON object: {"sources":[{"candidate_id":"source-1","decision":"include|exclude","reason":"short explanation"}]}. ' +
            "Return every candidate exactly once and in the original order.\n\n" +
            `Candidates:\n${sourceBlock}`,
        },
      },
    ]);
    const parsed = parseJsonObject(text);
    const values = Array.isArray(parsed?.sources) ? parsed.sources : [];
    if (values.length !== candidates.length) throw new Error("Source curator returned an incomplete candidate list.");
    const decisions: SourceCurationDecision[] = values.map((value, index) => {
      const item = value as Record<string, unknown>;
      const candidateId = String(item?.candidate_id || "");
      const expectedId = `source-${index + 1}`;
      const decision = String(item?.decision || "").toLowerCase();
      if (candidateId !== expectedId || (decision !== "include" && decision !== "exclude")) {
        throw new Error("Source curator returned an invalid candidate decision.");
      }
      return {
        candidateId,
        decision,
        reason: String(item?.reason || "").trim().slice(0, 500),
      } as SourceCurationDecision;
    });
    const included = candidates.filter((_source, index) => decisions[index].decision === "include");
    if (!included.length) throw new Error("Source curator excluded every candidate.");
    return {
      sources: included,
      audit: {
        mode: "llm",
        version: "upstream-v1",
        status: "completed",
        candidate_count: candidates.length,
        included_count: included.length,
        excluded_count: candidates.length - included.length,
        decisions,
        curated_at: curatedAt,
      },
    };
  } catch (error) {
    return {
      sources: candidates,
      audit: {
        mode: "llm",
        version: "upstream-v1",
        status: "failed_open",
        candidate_count: candidates.length,
        included_count: candidates.length,
        excluded_count: 0,
        decisions: [],
        error: error instanceof Error ? error.message.slice(0, 500) : "Source curation failed.",
        curated_at: curatedAt,
      },
    };
  }
}

function buildCuratedSelectedContext(sources: SearchResult[]): string {
  return sources
    .map((source, index) => {
      const sourceLabel = source.source_name || source.source_id || "Unknown source";
      return `[来源: ${sourceLabel}] [${index + 1}] ${source.title || source.url || "(untitled)"}\nURL: ${source.url || "(none)"}\nQuery: ${source.query || ""}\nContent: ${stripInternalChunkMarkers(source.content || "")}`;
    })
    .join("\n\n");
}

function sourceCurationModeFromJob(job: ResearchJob | null | undefined): SourceCurationMode {
  return job?.research_options?.source_curation_mode === "llm" ? "llm" : "off";
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
    throw new Error(`Section contains citation numbers outside its current section citation map: ${Array.from(new Set(invalid)).join(", ")}.`);
  }
  return normalized;
}

export function convertSectionUrlCitations(markdown: string, references: CitationReference[]): string {
  let converted = String(markdown || "");
  const identifierNumbers = new Map(
    references.map((reference) => [citationSourceIdentifier(reference.source), reference.number]),
  );
  for (const reference of references) {
    const identifier = citationSourceIdentifier(reference.source);
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const link = new RegExp(`\\[([^\\]\\r\\n]+)\\]\\(\\s*${escaped}\\s*\\)`, "g");
    converted = converted.replace(link, `[${reference.number}]`);
  }
  converted = converted.replace(
    /\[([^\]\r\n]+)\]\(\s*((?:https?:\/\/|anna-attachment:\/\/)[^\s)]+)\s*\)/g,
    (match, _label: string, rawIdentifier: string) => {
      const normalizedIdentifier = rawIdentifier.replace(/\]+$/, "");
      const number = identifierNumbers.get(normalizedIdentifier);
      return number && normalizedIdentifier !== rawIdentifier ? `[${number}]` : match;
    },
  );
  converted = converted.replace(/\(\s*(\[\d+\](?:\s*\[\d+\])*)\s*\)/g, "$1");
  const unknownIdentifiers = Array.from(
    converted.matchAll(/\[[^\]\r\n]+\]\(\s*((?:https?:\/\/|anna-attachment:\/\/)[^\s)]+)\s*\)/g),
    (match) => match[1],
  );
  if (unknownIdentifiers.length) {
    throw new Error(`Section contains citation URLs outside its allowed source identifier list: ${Array.from(new Set(unknownIdentifiers)).join(", ")}.`);
  }
  return normalizeSectionCitations(converted, references);
}

export function remapSelectedContextCitationLabels(context: string, references: CitationReference[]): string {
  return String(context || "").replace(/^(\[来源:[^\]\r\n]+\]\s*)\[(\d+)\](?=\s)/gm, (match, prefix: string, localNumber: string) => {
    const reference = references[Number(localNumber) - 1];
    return reference ? `${prefix}[${reference.number}]` : match;
  });
}

function stripSelectedContextCitationLabels(context: string): string {
  return String(context || "").replace(/^(\[来源:[^\]\r\n]+\]\s*)\[\d+\](?=\s)/gm, "$1");
}

export function stripInternalChunkMarkers(context: string): string {
  return String(context || "").replace(/\[(?:Chunk|Chunks)\s+\d+(?:\s*-\s*\d+)?\][ \t]*(?:\r?\n)?/gi, "");
}

export function sanitizeEvidenceContextUrls(context: string, preserveCanonicalUrlLines = true): string {
  return String(context || "")
    .replace(/^(\[来源:[^\]\r\n]+\])\s*\[\d+\]\s*/gm, "$1 ")
    .split(/\r?\n/)
    .map((line) => {
      if (preserveCanonicalUrlLines && /^URL:\s*/i.test(line)) return line;
      return line
        .replace(/\[([^\]\r\n]*)\]\(\s*https?:\/\/[^\s)]+\s*\)/gi, "$1")
        .replace(/<https?:\/\/[^>\s]+>/gi, "[embedded URL omitted]")
        .replace(/https?:\/\/[^\s<>"']+/gi, "[embedded URL omitted]");
    })
    .join("\n");
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

function uniqueQueries(queries: unknown): string[] {
  if (!Array.isArray(queries)) return [];
  const cleanedQueries = queries.map((query) => String(query || "").trim()).filter(Boolean);
  return Array.from(new Set(cleanedQueries)).slice(0, 3);
}

function uniqueQueriesUnlimited(queries: unknown): string[] {
  if (!Array.isArray(queries)) return [];
  return Array.from(new Set(queries.map((query) => String(query || "").trim()).filter(Boolean)));
}

function uniqueTextValues(values: unknown[], limit: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function mergeUniqueText(target: string[], additions: string[]): void {
  const seen = new Set(target.map((item) => item.toLocaleLowerCase()));
  for (const item of additions) {
    const key = item.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(item);
  }
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
