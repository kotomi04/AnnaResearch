import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchApi } from "../api/researchApi";
import type {
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
  url: string;
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

export function useResearchJob(api: ResearchApi) {
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [lastCompletedJob, setLastCompletedJob] = useState<ResearchJob | null>(null);
  const [lastCompletedResult, setLastCompletedResult] = useState<ResearchResult | null>(null);
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
        if (cancelled) return;
        setError(null);
        setJob(latest);
        setResult(latest?.result || null);
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
    async (query: string, regenerationInstruction = "") => {
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
        if (!hasConfiguredSource(current.sources)) {
          setPhase("settings_required");
          return;
        }
        const nextJob = await api.createResearchJob({ query });
        if (runId !== runIdRef.current) return;
        setJob(nextJob);
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
        const candidates = await generateFocusCandidates(api, job.query || "", role);
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
        setFocusCandidates(await generateFocusCandidates(api, job.query, role, instruction));
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
        const outline = await generateOutlineDraft(api, job.query || "", job.confirmed_role, focuses);
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
        const outline = await generateOutlineDraft(api, job.query, job.confirmed_role, job.confirmed_focuses, instruction);
        setOutlineDraft(await assignAllowedSources(api, outline, readyEnabledSources(sources), instruction));
        setPhase("outline_review");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, job?.confirmed_focuses, job?.confirmed_role, job?.query, sources],
  );

  const confirmOutlineAndRun = useCallback(
    async (sections: ReportSection[]) => {
      if (!job?.research_id || !job.confirmed_role || !job.confirmed_focuses) throw new Error("Research job is not ready for outline confirmation.");
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      setPhase("running");
      setRunEvents([]);
      setSectionPreviews([]);
      try {
        let currentJob = await api.saveConfirmedResearchOutline(job.research_id, sections);
        setJob(currentJob);
        const sectionResults: Array<{ section: ReportSection; markdown: string; summary: string; sourceUrls: string[] }> = [];
        const citationRegistry: string[] = [];
        for (let index = 0; index < sections.length; index++) {
          const section = sections[index];
          appendRunEvent(setRunEvents, {
            kind: "section_started",
            sectionId: section.id,
            sectionTitle: section.title,
            title: section.title,
            detail: `${index + 1}/${sections.length}`,
          });
          currentJob = await updateJob(api, currentJob, {
            status: "running",
            stage: "section_research",
            active_section_index: index,
            progress: Math.min(90, 35 + Math.round((index / sections.length) * 50)),
          });
          setJob(currentJob);
          if (runId !== runIdRef.current) return;
          const sectionResult = await runSection({
            api,
            job: currentJob,
            section,
            role: job.confirmed_role,
            focuses: job.confirmed_focuses,
            sources: readyEnabledSources(sources),
            citationRegistry,
            onEvent: (event) => appendRunEvent(setRunEvents, event),
          });
          sectionResults.push({ section, ...sectionResult });
          setSectionPreviews((previews) => upsertPreview(previews, sectionPreview(section, sectionResult)));
          currentJob = (await api.getResearchJob(job.research_id)) || currentJob;
          setJob(currentJob);
        }
        appendRunEvent(setRunEvents, {
          kind: "report_framing",
          title: "Report framing",
          detail: `${sections.length} section summaries`,
        });
        currentJob = await updateJob(api, currentJob, { stage: "report_framing", progress: 94 });
        setJob(currentJob);
        const framing = await generateReportFraming(api, job.query || "", job.confirmed_focuses, sections, sectionResults);
        currentJob = await api.saveReportFraming({ research_id: job.research_id, framing });
        const reportMarkdown = assembleReport(framing, sectionResults);
        const sourceUrls = citationRegistry.length ? [...citationRegistry] : sortedUnique(sectionResults.flatMap((section) => section.sourceUrls));
        appendRunEvent(setRunEvents, {
          kind: "final_assembly",
          title: "Final assembly",
          detail: `${sourceUrls.length} sources`,
          count: sourceUrls.length,
        });
        currentJob = await api.saveAssembledResearchResult({ research_id: job.research_id, report_markdown: reportMarkdown, source_urls: sourceUrls });
        const completedResult = currentJob.result || { research_id: job.research_id, report_markdown: reportMarkdown, source_urls: sourceUrls, status: "completed" };
        setJob(currentJob);
        setResult(completedResult);
        setLastCompletedJob(currentJob);
        setLastCompletedResult(completedResult);
        setPhase("completed");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, job, sources],
  );

  return {
    job,
    result,
    lastCompletedJob,
    lastCompletedResult,
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
    resetForNewResearch,
  };
}

function hasConfiguredSource(sources: ResearchSourceView[]): boolean {
  return sources.some((source) => source.enabled && source.credential_status === "configured");
}

function readyEnabledSources(sources: ResearchSourceView[]): ResearchSourceView[] {
  return sources.filter((source) => source.enabled && source.credential_status === "configured");
}

async function updateJob(api: ResearchApi, job: ResearchJob, updates: Record<string, unknown>): Promise<ResearchJob> {
  return api.updateResearchJob(requiredResearchId(job), updates);
}

function requiredResearchId(job: ResearchJob): string {
  if (!job.research_id) throw new Error("Research job is missing research_id.");
  return job.research_id;
}

function progressForIteration(iteration: number, maxIterations: number): number {
  return Math.min(85, 40 + Math.round((iteration / Math.max(1, maxIterations)) * 35));
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
  role: ConfirmedResearchRole;
  focuses: string[];
  sources: ResearchSourceView[];
  citationRegistry: string[];
  onEvent?(event: Parameters<typeof makeLiveRunEvent>[0]): void;
}): Promise<{ markdown: string; summary: string; sourceUrls: string[] }> {
  const { api, job, section, role, focuses, sources, citationRegistry, onEvent } = input;
  const allowedSources = sources.filter((source) => section.allowed_source_ids.includes(source.id));
  if (!allowedSources.length) throw new Error(`Section has no configured allowed source: ${section.title}`);
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
    });
    if (decision.type !== "call_source") break;
    const sourceId = allowedSources.some((source) => source.id === decision.source_id) ? String(decision.source_id) : allowedSources[0].id;
    const queries = uniqueQueries(decision.queries.length ? decision.queries : [section.title]);
    if (!queries.length) break;
    const call = await api.callSectionResearchSource({
      research_id: requiredResearchId(job),
      section_id: section.id,
      iteration,
      source_id: sourceId,
      queries,
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
    if (call.source_call?.error && iteration >= section.max_iterations) break;
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
  const citationReferences = registerCitationReferences(citationRegistry, sourceUrls);
  const writer = await writeSection(api, job.query || "", role, focuses, section, selected.selected_context || "", citationReferences);
  const markdown = remapLocalCitations(writer.markdown, citationReferences);
  await api.saveSectionResult({
    research_id: requiredResearchId(job),
    section_id: section.id,
    section_markdown: markdown,
    section_summary: writer.summary,
    source_urls: sourceUrls,
    status: "completed",
  });
  onEvent?.({
    kind: "section_written",
    sectionId: section.id,
    sectionTitle: section.title,
    title: "Section written",
    detail: writer.summary,
  });
  return { ...writer, markdown, sourceUrls };
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
}): Promise<Decision> {
  const { api, query, rolePrompt, section, focuses, iteration, maxIterations, enabledSources, history } = input;
  const sourcesBlock = enabledSources.map((source) => `- ${source.id} (${source.name})`).join("\n");
  const historyBlock = history.length ? history.map((entry) => `- iteration ${entry.iteration}: ${entry.queries.join(", ")} (${entry.results_count} results)`).join("\n") : "(no prior iterations)";
  const text = await completeText(api, [
    {
      role: "system",
      content: {
        type: "text",
        text:
          rolePrompt +
          "\n\nDecide the next research step for one report section. Reply with strict JSON only. " +
          'Return {"type":"call_source","source_id":"<allowed-id>","queries":["..."]} or {"type":"finish"}.',
      },
    },
    {
      role: "user",
      content: {
        type: "text",
        text:
          `Task:\n${query}\n\nSection: ${section.title}\n${section.outline}\n\nFocuses:\n${focuses.map((focus) => `- ${focus}`).join("\n")}\n\n` +
          `Allowed sources:\n${sourcesBlock}\nIteration: ${iteration}/${maxIterations}\nPrior iterations:\n${historyBlock}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  if (parsed?.type === "call_source") {
    const queries = Array.isArray(parsed.queries) ? parsed.queries.map(String).filter(Boolean) : [];
    return { type: "call_source", source_id: String(parsed.source_id || ""), queries };
  }
  if (iteration === 1) return { type: "call_source", source_id: enabledSources[0]?.id, queries: [section.title] };
  return { type: "finish" };
}

async function writeSection(
  api: ResearchApi,
  query: string,
  role: ConfirmedResearchRole,
  focuses: string[],
  section: ReportSection,
  selectedContext: string,
  citationReferences: CitationReference[],
): Promise<{ markdown: string; summary: string }> {
  const citationGuide = citationReferences.length
    ? citationReferences.map((reference) => `[${reference.number}] ${reference.url}`).join("\n")
    : "No selected source URLs for this section.";
  const text = await completeText(api, [
    { role: "system", content: { type: "text", text: role.agent_role_prompt } },
    {
      role: "user",
      content: {
        type: "text",
        text:
          'Write one report section. Return strict JSON only: {"section_markdown":"...","section_summary":"..."}.\n' +
          "Use only the provided context. The markdown should include the section heading.\n" +
          "When citing evidence, use ONLY the global citation numbers listed below, such as [3]. Do not invent new citation numbers and do not restart citations from [1] for this section.\n\n" +
          `Global citation map for this section:\n${citationGuide}\n\n` +
          `Task:\n${query}\n\nFocuses:\n${focuses.map((focus) => `- ${focus}`).join("\n")}\n\nSection: ${section.title}\n${section.outline}\n\nContext:\n${selectedContext}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  const markdown = String(parsed?.section_markdown || "").trim();
  const summary = String(parsed?.section_summary || "").trim();
  if (markdown) return { markdown, summary: summary || deriveSummary(markdown) };
  const fallback = text.trim();
  if (!fallback) throw new Error(`Anna LLM returned an empty section for ${section.title}.`);
  return { markdown: fallback, summary: deriveSummary(fallback) };
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
  return [`# ${framing.title || "Research Report"}`, framing.introduction, ...results.map((result) => result.markdown), "## Conclusion", framing.conclusion]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

function registerCitationReferences(registry: string[], urls: string[]): CitationReference[] {
  const references: CitationReference[] = [];
  for (const url of urls) {
    const normalized = String(url || "").trim();
    if (!normalized) continue;
    let index = registry.indexOf(normalized);
    if (index === -1) {
      registry.push(normalized);
      index = registry.length - 1;
    }
    references.push({ number: index + 1, url: normalized });
  }
  return references;
}

function remapLocalCitations(markdown: string, references: CitationReference[]): string {
  if (!references.length) return markdown;
  return markdown.replace(/\[(\d+)\]/g, (match, rawNumber: string) => {
    const localIndex = Number(rawNumber) - 1;
    const reference = references[localIndex];
    return reference ? `[${reference.number}]` : match;
  });
}

async function completeText(api: ResearchApi, messages: Parameters<ResearchApi["complete"]>[0]["messages"]): Promise<string> {
  const response = await api.complete({ messages });
  const content = response.content;
  return typeof content === "string" ? content : content?.text || "";
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
  return sortedUnique(queries.map((query) => String(query || "").trim()).filter(Boolean)).slice(0, 3);
}

function sortedUnique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean))).sort();
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
