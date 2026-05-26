import { useState } from "react";
import type { MessageKey } from "../i18n/messages";
import type { ToolSettings } from "../types";

interface Props {
  settings: ToolSettings | null;
  isBusy: boolean;
  t(key: MessageKey): string;
  onSave(key: string): void;
  onClear(): void;
}

export function SettingsPanel({ settings, isBusy, t, onSave, onClear }: Props) {
  const [key, setKey] = useState("");
  const configured = Boolean(settings?.tavily.configured);

  function save() {
    const value = key.trim();
    if (value) {
      onSave(value);
      setKey("");
    }
  }

  return (
    <section className="settings-band" aria-label={t("settingsAria")}>
      <div className="settings-heading">
        <div>
          <h2>{t("settingsTitle")}</h2>
          <p>{configured ? t("settingsConfigured") : t("settingsMissing")}</p>
        </div>
        {configured ? <span className="status-pill">{settings?.tavily.masked}</span> : null}
      </div>
      <label htmlFor="tavily-key-input">{t("tavilyKeyLabel")}</label>
      <input
        id="tavily-key-input"
        type="password"
        placeholder={t("tavilyKeyPlaceholder")}
        autoComplete="off"
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <div className="actions">
        <button type="button" onClick={save} disabled={isBusy || !key.trim()}>
          {t("saveSettingsButton")}
        </button>
        <button className="secondary" type="button" onClick={onClear} disabled={isBusy || !configured}>
          {t("clearSettingsButton")}
        </button>
      </div>
    </section>
  );
}

