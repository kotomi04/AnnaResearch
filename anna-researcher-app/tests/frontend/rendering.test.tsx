import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportView } from "../../src/components/ReportView";
import { ResearchForm } from "../../src/components/ResearchForm";
import { SettingsPanel } from "../../src/components/SettingsPanel";
import { createTranslator, localeStorageKey } from "../../src/i18n/messages";
import { useLocale } from "../../src/i18n/useLocale";

function LocaleProbe() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <button type="button" onClick={() => setLocale("en")}>
        en
      </button>
      <span>{t("queryLabel")}</span>
    </div>
  );
}

describe("locale preference UI behavior", () => {
  it("persists language switching in localStorage", async () => {
    window.localStorage.clear();
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("zh-CN");
    render(<LocaleProbe />);

    expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "en" }));
    await waitFor(() => expect(screen.getByTestId("locale").textContent).toBe("en"));
    expect(window.localStorage.getItem(localeStorageKey)).toBe("en");
  });
});

describe("ResearchForm", () => {
  it("validates query input and parses domains", () => {
    const t = createTranslator("en");
    const onStart = vi.fn();
    const onValidationError = vi.fn();
    render(<ResearchForm isBusy={false} canStart={true} t={t} onStart={onStart} onValidationError={onValidationError} />);

    fireEvent.click(screen.getByRole("button", { name: "Start Research" }));
    expect(onValidationError).toHaveBeenCalledWith("Enter a research query.");

    fireEvent.change(screen.getByLabelText("Research query"), { target: { value: "Anna App" } });
    fireEvent.click(screen.getByText("Domain filter"));
    fireEvent.change(screen.getByPlaceholderText("example.com, docs.example.com"), { target: { value: "example.com, docs.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Research" }));
    expect(onStart).toHaveBeenCalledWith("Anna App", ["example.com", "docs.example.com"]);
  });
});

describe("SettingsPanel", () => {
  it("saves and clears Tavily settings", () => {
    const t = createTranslator("en");
    const onSave = vi.fn();
    const onClear = vi.fn();
    render(<SettingsPanel settings={{ tavily: { configured: true, masked: "tvly...test" } }} isBusy={false} t={t} onSave={onSave} onClear={onClear} />);

    fireEvent.change(screen.getByLabelText("Tavily API Key"), { target: { value: "tvly-new-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));
    expect(onSave).toHaveBeenCalledWith("tvly-new-key");
    fireEvent.click(screen.getByRole("button", { name: "Clear Key" }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe("ReportView", () => {
  it("renders markdown and sources without raw html injection", () => {
    const t = createTranslator("en");
    const markdown = "# Title\n\n- item\n\n<script>window.bad = true</script>";
    render(<ReportView result={{ report_markdown: markdown, source_urls: ["https://example.com"] }} t={t} />);

    expect(screen.getByRole("heading", { name: "Title", level: 1 })).toBeTruthy();
    expect(screen.getByText("item")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByRole("link", { name: "https://example.com" }).getAttribute("rel")).toBe("noreferrer noopener");
  });
});
