import type { MessageKey } from "../i18n/messages";
import type { PlanSummary } from "../workflow/planSummary";

interface Props {
  summary: PlanSummary;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
  compact?: boolean;
}

export function PlanSummaryStrip({ summary, t, compact }: Props) {
  const hasRole = Boolean(summary.roleName);
  const hasFocuses = summary.focuses.length > 0;
  const hasSections = summary.sectionCount > 0;
  if (!hasRole && !hasFocuses && !hasSections) return null;
  return (
    <section className="plan-summary" data-compact={compact ? "true" : "false"}>
      {hasRole ? (
        <details>
          <summary>{t("summaryRole", { role: summary.roleName })}</summary>
          <p>{summary.rolePrompt}</p>
        </details>
      ) : null}
      {hasFocuses ? (
        <div className="summary-chip-row" aria-label={t("summaryFocuses")}>
          {summary.focuses.map((focus) => <span key={focus}>{focus}</span>)}
        </div>
      ) : null}
      {hasSections ? (
        <p className="summary-stat">
          {t("summarySections", { count: summary.sectionCount, iterations: summary.totalIterations })}
        </p>
      ) : null}
    </section>
  );
}
