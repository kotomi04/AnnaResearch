import { useState } from "react";
import type { MessageKey } from "../i18n/messages";
import { parseDomains } from "../utils/domains";

interface Props {
  isBusy: boolean;
  canStart: boolean;
  t(key: MessageKey): string;
  onStart(query: string, domains: string[]): void;
  onValidationError(message: string): void;
}

export function ResearchForm({ isBusy, canStart, t, onStart, onValidationError }: Props) {
  const [query, setQuery] = useState("");
  const [domains, setDomains] = useState("");

  function submit() {
    const trimmed = query.trim();
    if (!trimmed) {
      onValidationError(t("enterQueryError"));
      return;
    }
    onStart(trimmed, parseDomains(domains));
  }

  return (
    <section className="input-band" aria-label={t("researchInputAria")}>
      <label htmlFor="query-input">{t("queryLabel")}</label>
      <textarea id="query-input" rows={4} placeholder={t("queryPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} />
      <details>
        <summary>{t("domainSummary")}</summary>
        <input
          id="domains-input"
          type="text"
          placeholder={t("domainPlaceholder")}
          autoComplete="off"
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
        />
      </details>
      <div className="actions">
        <button type="button" onClick={submit} disabled={isBusy || !canStart}>
          {isBusy ? t("startButtonBusy") : t("startButton")}
        </button>
      </div>
    </section>
  );
}
