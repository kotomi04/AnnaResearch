import type { MessageKey } from "../i18n/messages";
import type { PlanSummary } from "../workflow/planSummary";

interface Props {
  summary: PlanSummary;
  t(key: MessageKey, params?: Record<string, string | number | undefined>): string;
  compact?: boolean;
}

export function PlanSummaryStrip({ summary, t, compact }: Props) {
  const hasRole = Boolean(summary.roleName);
  const hasSections = summary.sectionCount > 0;
  if (!hasRole && !hasSections) return null;
  return (
    <section className="plan-summary" data-compact={compact ? "true" : "false"}>
      {hasRole ? (
        <details>
          <summary>{t("summaryRole", { role: summary.roleName })}</summary>
          <p>{summary.rolePrompt}</p>
        </details>
      ) : null}
      {hasSections ? (
        <p className="summary-stat">
          {t("summarySections", { count: summary.sectionCount, iterations: summary.totalIterations })}
        </p>
      ) : null}
    </section>
  );
}
