import { useState } from "react";
import type { MessageKey } from "../i18n/messages";

interface Props {
  label: string;
  value: string;
  t(key: MessageKey): string;
  disabled?: boolean;
  onChange(value: string): void;
  onRegenerate(): void;
}

export function RegenerationControl({ label, value, t, disabled, onChange, onRegenerate }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="regen-menu">
      {!open ? (
        <button type="button" className="secondary small-button" onClick={() => setOpen(true)} disabled={disabled}>
          {label}
        </button>
      ) : (
        <div className="regen-inline">
          <input
            value={value}
            placeholder={t("regenInstructionPlaceholder")}
            onChange={(event) => onChange(event.target.value)}
          />
          <button type="button" className="secondary small-button" onClick={onRegenerate} disabled={disabled}>
            {t("regenerateButton")}
          </button>
          <button type="button" className="secondary small-button" onClick={() => setOpen(false)}>
            {t("cancelButton")}
          </button>
        </div>
      )}
    </div>
  );
}
