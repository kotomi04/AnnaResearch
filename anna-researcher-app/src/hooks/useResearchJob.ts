import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchApi } from "../api/researchApi";
import type { ResearchJob, ResearchPhase, ResearchResult, SearchResult, ToolSettings } from "../types";

export function useResearchJob(api: ResearchApi) {
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [settings, setSettings] = useState<ToolSettings | null>(null);
  const [phase, setPhase] = useState<ResearchPhase>("idle");
  const [error, setError] = useState<unknown>(null);
  const runIdRef = useRef(0);

  const refreshSettings = useCallback(async () => {
    const next = await api.getSettings();
    setSettings(next);
    if (!next.tavily.configured) setPhase("settings_required");
    return next;
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      try {
        const nextSettings = await api.getSettings();
        if (cancelled) return;
        setSettings(nextSettings);
        const latest = await api.getResearchJob();
        if (cancelled) return;
        if (latest) {
          setJob(latest);
          if (latest.result) {
            setResult(latest.result);
            setPhase(latest.status === "completed" ? "completed" : "idle");
          } else {
            setPhase(nextSettings.tavily.configured ? "idle" : "settings_required");
          }
        } else {
          setPhase(nextSettings.tavily.configured ? "idle" : "settings_required");
        }
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

  const updateSettings = useCallback(
    async (input: { tavily_api_key?: string; clear_tavily_api_key?: boolean }) => {
      const next = await api.updateSettings(input);
      setSettings(next);
      setPhase(next.tavily.configured ? "idle" : "settings_required");
      return next;
    },
    [api],
  );

  const start = useCallback(
    async (query: string, queryDomains: string[]) => {
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      setPhase("starting");
      setError(null);
      setResult(null);
      try {
        const currentSettings = settings ?? (await refreshSettings());
        if (!currentSettings.tavily.configured) {
          setPhase("settings_required");
          return;
        }
        let current = await api.createResearchJob({ query, query_domains: queryDomains });
        if (runId !== runIdRef.current) return;
        setJob(current);

        current = await updateJob(api, current, { status: "running", stage: "select_role", progress: 10 });
        setJob(current);
        const role = await selectRole(api, query);
        current = await updateJob(api, current, { agent_name: role.agent_name, agent_role_prompt: role.agent_role_prompt, stage: "plan_queries", progress: 25 });
        setJob(current);

        const plannedQueries = await planQueries(api, query, role.agent_role_prompt);
        current = await updateJob(api, current, { search_queries: plannedQueries, stage: "search_next_query", progress: 55 });
        setJob(current);

        const searched = await api.searchWeb({ research_id: requiredResearchId(current), search_queries: plannedQueries, query_domains: queryDomains });
        current = searched.job ?? current;
        setJob({ ...current, stage: "select_context", progress: 75 });

        const selected = await api.selectContext({ research_id: requiredResearchId(current) });
        current = selected.job ?? current;
        setJob({ ...current, stage: "write_report", progress: 90 });

        const report = await writeReport(api, query, role.agent_role_prompt, selected.selected_context || current.selected_context || "");
        const saved = await api.saveResearchResult({
          research_id: requiredResearchId(current),
          report_markdown: report,
          source_urls: selected.source_urls || current.source_urls || [],
          selected_sources: selected.selected_sources || current.selected_sources || [],
        });
        current = saved.job ?? current;
        setJob(current);
        setResult(saved.result || current.result || null);
        setPhase("completed");
      } catch (err) {
        setError(err);
        setPhase("failed");
      }
    },
    [api, refreshSettings, settings],
  );

  return {
    job,
    result,
    settings,
    phase,
    error,
    isBusy: phase === "starting" || phase === "running" || phase === "loading_result",
    canStart: Boolean(settings?.tavily.configured),
    refreshSettings,
    updateSettings,
    start,
  };
}

async function updateJob(api: ResearchApi, job: ResearchJob, updates: Record<string, unknown>): Promise<ResearchJob> {
  return api.updateResearchJob(requiredResearchId(job), updates);
}

function requiredResearchId(job: ResearchJob): string {
  if (!job.research_id) throw new Error("Research job is missing research_id.");
  return job.research_id;
}

async function selectRole(api: ResearchApi, query: string): Promise<{ agent_name: string; agent_role_prompt: string }> {
  const text = await completeText(api, [
    {
      role: "user",
      content: {
        type: "text",
        text: `Choose a research agent role for this task. Return JSON with keys "server" and "agent_role_prompt" only.\n\nTask: ${query}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  return {
    agent_name: String(parsed?.server || "Default Research Assistant"),
    agent_role_prompt: String(parsed?.agent_role_prompt || "You are an objective research assistant who writes structured, source-grounded reports."),
  };
}

async function planQueries(api: ResearchApi, query: string, rolePrompt: string): Promise<string[]> {
  const text = await completeText(api, [
    {
      role: "user",
      content: {
        type: "text",
        text: `Generate up to 3 focused web search queries for this research task. Return JSON as {"queries": [...]} and do not include commentary.\n\nTask: ${query}\nRole: ${rolePrompt}`,
      },
    },
  ]);
  const parsed = parseJsonObject(text);
  const planned = Array.isArray(parsed?.queries) ? parsed.queries : [];
  return normalizeQueries(query, planned);
}

async function writeReport(api: ResearchApi, query: string, rolePrompt: string, selectedContext: string): Promise<string> {
  const text = await completeText(api, [
    { role: "system", content: { type: "text", text: rolePrompt || "You are an objective research assistant." } },
    {
      role: "user",
      content: {
        type: "text",
        text: `Write a concise markdown research_report for: ${query}\n\nUse only the provided context. Include clear headings and cite sources by URL when useful.\n\nContext:\n${selectedContext}`,
      },
    },
  ]);
  const report = text.trim();
  if (!report) throw new Error("Anna LLM returned an empty report.");
  return report;
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

function normalizeQueries(original: string, planned: unknown[], limit = 3): string[] {
  const queries = [original.trim()].filter(Boolean);
  for (const item of planned) {
    const text = String(item || "").trim();
    if (text && !queries.includes(text)) queries.push(text.slice(0, 180));
    if (queries.length >= limit) break;
  }
  return queries.length ? queries : [original];
}

