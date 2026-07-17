import type { MessageKey } from "../i18n/messages";
import type { ResearchJob } from "../types";

interface Props {
  stepLabel: string;
  title: string;
  message: string;
  kind?: "role" | "outline";
  job?: ResearchJob | null;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
}

interface ActivityStep {
  id: string;
  title: string;
  detail: string;
}

export function DraftGenerationPage({ stepLabel, title, message, kind = "role", job, t }: Props) {
  const status = job?.outline_discovery?.status || "";
  const steps = kind === "outline" ? outlineSteps(t) : roleSteps(t);
  const activeIndex = kind === "outline" ? outlineStatusIndex(status) : 1;
  const facets = job?.outline_discovery?.facets || [];

  return (
    <section className="page active guided-step-page draft-generation-page" aria-label={title} aria-busy="true">
      <header className="draft-activity-hero">
        <div className="activity-pulse" aria-hidden="true"><span /></div>
        <div>
          <p className="step-pill">{stepLabel}</p>
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
        <span className="activity-live-label">{t("activityLiveLabel")}</span>
      </header>

      <div className="draft-activity-layout">
        <section className="activity-stage-card" aria-label={t("draftLoadingAria")}>
          <div className="activity-card-heading">
            <div>
              <span>{t("activityCurrentWork")}</span>
              <h3>{steps[Math.min(activeIndex, steps.length - 1)].title}</h3>
            </div>
            <span className="activity-step-count">{activeIndex + 1}/{steps.length}</span>
          </div>
          <p>{steps[Math.min(activeIndex, steps.length - 1)].detail}</p>
          <ol className="activity-stage-list">
            {steps.map((step, index) => {
              const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "queued";
              return (
                <li key={step.id} data-state={state}>
                  <span className="activity-stage-marker">{state === "done" ? "✓" : index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.detail}</p>
                  </div>
                  <span className="activity-stage-state">{t(state === "done" ? "activityDone" : state === "active" ? "activityInProgress" : "activityQueued")}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="activity-context-card">
          <span>{t(kind === "outline" ? "outlineActivityContext" : "roleActivityContext")}</span>
          <h3>{researchTitle(job?.query, t)}</h3>
          {kind === "outline" ? (
            <>
              <div className="activity-metric-grid">
                <div><strong>{job?.outline_discovery?.facet_count || facets.length || "—"}</strong><span>{t("activityFacets")}</span></div>
                <div><strong>{job?.outline_discovery?.query_count || "—"}</strong><span>{t("activityQueries")}</span></div>
                <div><strong>{job?.outline_discovery?.result_count || "—"}</strong><span>{t("activityResults")}</span></div>
              </div>
              {facets.length ? (
                <div className="activity-facet-list">
                  <strong>{t("activityFacetLedger")}</strong>
                  {facets.map((facet) => <p key={facet.id}><span>{facet.id}</span>{facet.task}</p>)}
                </div>
              ) : <p className="activity-context-note">{t("activityFacetPending")}</p>}
            </>
          ) : <p className="activity-context-note">{t("roleActivityNote")}</p>}
        </aside>
      </div>
    </section>
  );
}

function outlineSteps(t: Props["t"]): ActivityStep[] {
  return [
    { id: "facets", title: t("outlineActivityFacets"), detail: t("outlineActivityFacetsDetail") },
    { id: "seed", title: t("outlineActivitySeed"), detail: t("outlineActivitySeedDetail") },
    { id: "queries", title: t("outlineActivityQueries"), detail: t("outlineActivityQueriesDetail") },
    { id: "research", title: t("outlineActivityResearch"), detail: t("outlineActivityResearchDetail") },
    { id: "draft", title: t("outlineActivityDraft"), detail: t("outlineActivityDraftDetail") },
  ];
}

function roleSteps(t: Props["t"]): ActivityStep[] {
  return [
    { id: "brief", title: t("roleActivityBrief"), detail: t("roleActivityBriefDetail") },
    { id: "roles", title: t("roleActivityCandidates"), detail: t("roleActivityCandidatesDetail") },
    { id: "review", title: t("roleActivityPrepare"), detail: t("roleActivityPrepareDetail") },
  ];
}

function outlineStatusIndex(status: string): number {
  if (["completed"].includes(status)) return 4;
  if (["searched"].includes(status)) return 4;
  if (["planned"].includes(status)) return 3;
  if (["seed_selected"].includes(status)) return 2;
  if (["seed_searched"].includes(status)) return 1;
  return 0;
}

function researchTitle(query: string | undefined, t: Props["t"]): string {
  const clean = String(query || "").trim();
  if (!clean) return t("activityResearchTask");
  const briefMatch = clean.match(/^(?:研究简报名称|Research brief name):\s*(.+)$/m);
  return briefMatch?.[1]?.trim() || clean.split("\n")[0].slice(0, 120);
}
