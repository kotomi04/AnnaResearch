import { useEffect, useMemo, useState } from "react";
import { AnnaResearchApi, createStandaloneApi, type ResearchApi } from "./api/researchApi";
import { LanguageToggle } from "./components/LanguageToggle";
import { ReportView } from "./components/ReportView";
import { ResearchForm } from "./components/ResearchForm";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusPanel } from "./components/StatusPanel";
import { useResearchJob } from "./hooks/useResearchJob";
import { useLocale } from "./i18n/useLocale";
import { localizedError, localizedJobMessage } from "./i18n/status";
import type { AnnaRuntimeGlobal, ConnectionState } from "./types";

declare global {
  interface Window {
    AnnaAppRuntime?: AnnaRuntimeGlobal;
  }
}

export function App() {
  const { locale, setLocale, t } = useLocale();
  const [api, setApi] = useState<ResearchApi>(() => createStandaloneApi());
  const [connection, setConnection] = useState<ConnectionState>("standalone");
  const [validationMessage, setValidationMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function connect() {
      try {
        if (!window.AnnaAppRuntime) throw new Error("AnnaAppRuntime SDK not loaded");
        const anna = await window.AnnaAppRuntime.connect();
        if (!cancelled) {
          setApi(new AnnaResearchApi(anna));
          setConnection("connected");
        }
      } catch (err) {
        console.warn("[anna-researcher] standalone mode:", err instanceof Error ? err.message : err);
        if (!cancelled) {
          setApi(createStandaloneApi());
          setConnection("standalone");
        }
      }
    }
    void connect();
    return () => {
      cancelled = true;
    };
  }, []);

  const research = useResearchJob(api);
  const jobMessage = localizedJobMessage(research.job, t);
  const asyncErrorMessage = research.error ? localizedError(research.error, t) : "";
  const message = validationMessage || asyncErrorMessage || jobMessage.message;
  const isMessageError = Boolean(validationMessage || asyncErrorMessage || jobMessage.isError);

  const connectionLabel = connection === "connected" ? t("connected") : t("standalone");
  const sourceResult = useMemo(() => research.result, [research.result]);

  function start(query: string, domains: string[]) {
    setValidationMessage("");
    void research.start(query, domains);
  }

  function saveTavilyKey(key: string) {
    setValidationMessage("");
    void research.updateSettings({ tavily_api_key: key });
  }

  function clearTavilyKey() {
    setValidationMessage("");
    void research.updateSettings({ clear_tavily_api_key: true });
  }

  return (
    <main className="workbench" lang={locale}>
      <header className="topbar">
        <div>
          <h1>{t("appTitle")}</h1>
          <p>{t("appSubtitle")}</p>
        </div>
        <div className="topbar-actions">
          <LanguageToggle locale={locale} setLocale={setLocale} t={t} />
          <span id="conn-status" className="status-pill" data-connected={connection === "connected" ? "true" : "false"}>
            {connectionLabel}
          </span>
        </div>
      </header>

      <SettingsPanel settings={research.settings} isBusy={research.isBusy} t={t} onSave={saveTavilyKey} onClear={clearTavilyKey} />

      <ResearchForm
        isBusy={research.isBusy}
        canStart={research.canStart}
        t={t}
        onStart={start}
        onValidationError={setValidationMessage}
      />

      <StatusPanel job={research.job} message={message} isError={isMessageError} t={t} />
      <ReportView result={sourceResult} t={t} />
    </main>
  );
}
