import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatResearchQuery, hasCompletedResearchResult, makeIntroStepLabel, makeStepLabel } from "../../src/App";
import { useState } from "react";
import { DraftGenerationPage } from "../../src/components/DraftGenerationPage";
import { FocusReviewPage } from "../../src/components/FocusReviewPage";
import { RegenerationControl } from "../../src/components/RegenerationControl";
import { ReportDisplayPage } from "../../src/components/ReportDisplayPage";
import { ReportView } from "../../src/components/ReportView";
import { ResearchLibraryPage } from "../../src/components/ResearchLibraryPage";
import { appendSourcesToMarkdown } from "../../src/export/exportFiles";
import { ResearchForm } from "../../src/components/ResearchForm";
import {
  ResearchSourceDetailPage,
  ResearchSourceListPage,
  ResearchSourceNewPage,
} from "../../src/components/ResearchSourcePanel";
import { ResearchTimeline } from "../../src/components/ResearchTimeline";
import { TaskPickerPage } from "../../src/components/TaskPickerPage";
import { createTranslator, localeStorageKey } from "../../src/i18n/messages";
import { useLocale } from "../../src/i18n/useLocale";
import type { ResearchSourceView } from "../../src/types";
import { summarizePlan } from "../../src/workflow/planSummary";

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

function ControlledResearchForm(props: Omit<Parameters<typeof ResearchForm>[0], "briefName" | "researchNeed" | "onBriefNameChange" | "onResearchNeedChange">) {
  const [briefName, setBriefName] = useState("");
  const [researchNeed, setResearchNeed] = useState("");
  return (
    <ResearchForm
      {...props}
      briefName={briefName}
      researchNeed={researchNeed}
      onBriefNameChange={setBriefName}
      onResearchNeedChange={setResearchNeed}
    />
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
  it("validates research need input and forwards the trimmed fields", () => {
    const t = createTranslator("en");
    const onStart = vi.fn();
    const onValidationError = vi.fn();
    render(
      <ControlledResearchForm
        isBusy={false}
        canStart={true}
        t={t}
        stepLabel="Step 1/5"
        validationMessage=""
        canShowLastResult={false}
        onOpenLibrary={vi.fn()}
        onShowLastResult={vi.fn()}
        onStart={onStart}
        onValidationError={onValidationError}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Research" }));
    expect(onValidationError).toHaveBeenCalledWith("Enter a research need.");

    fireEvent.change(screen.getByLabelText("Brief Name"), { target: { value: "  Anna App  " } });
    fireEvent.change(screen.getByLabelText("Research Need"), { target: { value: "  Prepare a customer brief.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Start Research" }));
    expect(onStart).toHaveBeenCalledWith({ briefName: "Anna App", researchNeed: "Prepare a customer brief." });
    expect(screen.getByText("Research uses configured sources and user-provided context.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "View Last Result" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables the last-result action only when a completed result is available", () => {
    const t = createTranslator("en");
    const onShowLastResult = vi.fn();
    render(
      <ControlledResearchForm
        isBusy={false}
        canStart={true}
        t={t}
        stepLabel="Step 1/5"
        validationMessage=""
        canShowLastResult={true}
        onOpenLibrary={vi.fn()}
        onShowLastResult={onShowLastResult}
        onStart={vi.fn()}
        onValidationError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View Last Result" }));
    expect(onShowLastResult).toHaveBeenCalledTimes(1);
  });

  it("keeps start disabled and shows the source configuration hint when no source is ready", () => {
    const t = createTranslator("en");
    render(
      <ControlledResearchForm
        isBusy={false}
        canStart={false}
        t={t}
        stepLabel="Step 1/5"
        validationMessage="Enter a research need."
        canShowLastResult={false}
        onOpenLibrary={vi.fn()}
        onShowLastResult={vi.fn()}
        onStart={vi.fn()}
        onValidationError={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Start Research" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Configure at least one research source credential to begin.")).toBeTruthy();
    expect(screen.getByText("Enter a research need.")).toBeTruthy();
  });
});

describe("FocusReviewPage", () => {
  it("renders the continue action with the selected focus count", () => {
    const t = createTranslator("en");
    render(
      <FocusReviewPage
        candidates={[
          { id: "focus-1", text: "Market risk", rationale: "Check demand." },
          { id: "focus-2", text: "Product depth", rationale: "Check roadmap." },
        ]}
        selectedIds={["focus-1"]}
        instruction=""
        summary={summarizePlan({
          role: { server: "Analyst", agent_role_prompt: "Use sources." },
          focuses: [],
          sections: [],
        })}
        isBusy={false}
        t={t}
        onSelectedIdsChange={vi.fn()}
        onCandidateChange={vi.fn()}
        onInstructionChange={vi.fn()}
        onRegenerate={vi.fn()}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm focuses and continue" })).toBeTruthy();
  });
});

describe("Draft planning UI", () => {
  it("renders an explicit loading page while waiting for a draft", () => {
    const t = createTranslator("en");
    render(
      <DraftGenerationPage
        stepLabel="Role"
        title="Generating Research Roles"
        message="Anna is generating comparable research roles from your need."
        t={t}
      />,
    );

    expect(screen.getByRole("heading", { name: "Generating Research Roles" })).toBeTruthy();
    expect(screen.getByLabelText("Generating draft")).toBeTruthy();
  });

  it("opens regeneration requirements in a dialog before replacing a draft", () => {
    const t = createTranslator("en");
    const onChange = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <RegenerationControl
        label="Regenerate roles"
        value=""
        t={t}
        onChange={onChange}
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Regenerate roles" }));
    expect(screen.getByRole("dialog", { name: "Regenerate roles" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Regeneration requirements"), { target: { value: "Make them more technical" } });
    expect(onChange).toHaveBeenCalledWith("Make them more technical");
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});

describe("research query composition", () => {
  it("combines optional brief name with required research need per locale", () => {
    expect(formatResearchQuery({ briefName: "Sweetgreen", researchNeed: "Prepare the call." }, "en")).toBe(
      "Research topic: Sweetgreen\n\nResearch need:\nPrepare the call.",
    );
    expect(formatResearchQuery({ briefName: "", researchNeed: "准备会议。" }, "zh-CN")).toBe(
      "研究主题：未提供\n\n研究具体内容：\n准备会议。",
    );
  });

  it("derives the visible step label from job progress", () => {
    expect(makeStepLabel({ phase: "idle" })).toBe("Step 1/5");
    expect(makeStepLabel({ phase: "running", iteration: 2, maxIterations: 5 })).toBe("Step 2/5");
    expect(makeStepLabel({ phase: "completed", iteration: 3, maxIterations: 5 })).toBe("Step 5/5");
    expect(makeStepLabel({ phase: "failed", iteration: 3, maxIterations: 5 })).toBe("Step 3/5");
  });

  it("keeps the intro step label at the first step even when latest research is completed", () => {
    expect(makeIntroStepLabel(5)).toBe("Step 1/5");
  });

  it("only enables last-result access for completed research results", () => {
    expect(hasCompletedResearchResult({ status: "completed", result: { report_markdown: "# Done" } }, null)).toBe(true);
    expect(hasCompletedResearchResult({ status: "completed" }, { report_markdown: "# Done" })).toBe(true);
    expect(hasCompletedResearchResult({ status: "running", result: { report_markdown: "# Draft" } }, null)).toBe(false);
    expect(hasCompletedResearchResult({ status: "completed", result: null }, null)).toBe(false);
  });
});

describe("Research Source pages", () => {
  function makeSource(overrides: Partial<ResearchSourceView> = {}): ResearchSourceView {
    return {
      id: "tavily",
      name: "Tavily",
      kind: "builtin",
      enabled: true,
      max_parallel: 3,
      credential_status: "configured",
      credential: "tvly-secret-test",
      definition: {
        id: "tavily",
        name: "Tavily",
        request: { method: "POST", url: "https://api.tavily.com/search" },
        result: {
          items_path: "results[]",
          url: { mode: "path", value: "url" },
          title: { mode: "path", value: "title" },
          content: { mode: "paths", value: ["content"] },
        },
      },
      ...overrides,
    };
  }

  const mockTestSource = () =>
    vi.fn().mockResolvedValue({
      source_id: "tavily",
      source_name: "Tavily",
      query: "test",
      duration_ms: 1,
      pages: [],
      extracted: [],
      error: null,
    });

  it("renders a source list page and opens a selected source", () => {
    const t = createTranslator("en");
    const onOpenSource = vi.fn();
    render(
      <ResearchSourceListPage
        sources={[makeSource()]}
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onAdd={vi.fn()}
        onOpenSource={onOpenSource}
      />,
    );
    expect(screen.getByRole("heading", { name: "Research Sources" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tavily/i }));
    expect(onOpenSource).toHaveBeenCalledWith("tavily");
  });

  it("saves a credential from the detail page", async () => {
    const t = createTranslator("en");
    const onSaveCredential = vi.fn().mockResolvedValue(undefined);
    render(
      <ResearchSourceDetailPage
        source={makeSource({ credential_status: "missing", credential: "" })}
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onSaveCredential={onSaveCredential}
        onToggleEnabled={vi.fn().mockResolvedValue(undefined)}
        onSaveDefinition={vi.fn().mockResolvedValue(undefined)}
        onDeleteSource={vi.fn().mockResolvedValue(undefined)}
        onTestSource={mockTestSource()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add credential" }));
    fireEvent.change(screen.getByLabelText("Credential (Token)"), { target: { value: "tvly-new-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSaveCredential).toHaveBeenCalledWith({ id: "tavily", credential: "tvly-new-key" }),
    );
  });

  it("clears an existing credential from the detail page", async () => {
    const t = createTranslator("en");
    const onSaveCredential = vi.fn().mockResolvedValue(undefined);
    render(
      <ResearchSourceDetailPage
        source={makeSource()}
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onSaveCredential={onSaveCredential}
        onToggleEnabled={vi.fn().mockResolvedValue(undefined)}
        onSaveDefinition={vi.fn().mockResolvedValue(undefined)}
        onDeleteSource={vi.fn().mockResolvedValue(undefined)}
        onTestSource={mockTestSource()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete credential" }));
    await waitFor(() => expect(onSaveCredential).toHaveBeenCalledWith({ id: "tavily", clear: true }));
  });

  it("toggles enabled state and shows the toggle as checked when enabled", async () => {
    const t = createTranslator("en");
    const onToggleEnabled = vi.fn().mockResolvedValue(undefined);
    render(
      <ResearchSourceDetailPage
        source={makeSource({ enabled: true })}
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onSaveCredential={vi.fn().mockResolvedValue(undefined)}
        onToggleEnabled={onToggleEnabled}
        onSaveDefinition={vi.fn().mockResolvedValue(undefined)}
        onDeleteSource={vi.fn().mockResolvedValue(undefined)}
        onTestSource={mockTestSource()}
      />,
    );

    const toggle = screen.getByRole("checkbox", { name: /Tavily Enabled/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(onToggleEnabled).toHaveBeenCalledWith({ id: "tavily", enabled: false }));
  });

  it("reveals credentials and runs a source test from the detail page", async () => {
    const t = createTranslator("en");
    const onTestSource = vi.fn().mockResolvedValue({
      source_id: "tavily",
      source_name: "Tavily",
      query: "anna",
      duration_ms: 7,
      extracted: [{ url: "https://example.com/a", title: "A", content: "Evidence" }],
      pages: [
        {
          page: 1,
          request: { method: "POST", url: "https://api.tavily.com/search", body: { api_key: "tvly-secret-test", query: "anna" } },
          response: { status: 200, json: { results: [{ title: "A" }] }, text: "{\"results\":[{\"title\":\"A\"}]}" },
          extracted: [{ url: "https://example.com/a", title: "A", content: "Evidence" }],
        },
      ],
      error: null,
    });
    render(
      <ResearchSourceDetailPage
        source={makeSource()}
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onSaveCredential={vi.fn().mockResolvedValue(undefined)}
        onToggleEnabled={vi.fn().mockResolvedValue(undefined)}
        onSaveDefinition={vi.fn().mockResolvedValue(undefined)}
        onDeleteSource={vi.fn().mockResolvedValue(undefined)}
        onTestSource={onTestSource}
      />,
    );

    expect(screen.getByText("***test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show full credential" }));
    expect(screen.getByText("tvly-secret-test")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByRole("dialog", { name: "Test Research Source" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Test query"), { target: { value: "anna" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    await waitFor(() =>
      expect(onTestSource).toHaveBeenCalledWith({
        id: "tavily",
        definition: expect.objectContaining({ id: "tavily" }),
        query: "anna",
      }),
    );
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Test Result" })).toBeTruthy());
    expect(screen.getByText(/Extracted url \/ title \/ content/)).toBeTruthy();
    expect(screen.getAllByText(/tvly-secret-test/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/https:\/\/example\.com\/a/).length).toBeGreaterThan(0);
  });

  it("submits a custom source definition through the new source page", async () => {
    const t = createTranslator("en");
    const onAddSource = vi.fn().mockResolvedValue(undefined);
    render(
      <ResearchSourceNewPage
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onAddSource={onAddSource}
      />,
    );

    fireEvent.change(screen.getByLabelText("Source definition (JSON)"), {
      target: {
        value:
          '{"id":"custom","name":"Custom","request":{"method":"GET","url":"https://api.example/?token={token}&q={query}"},"result":{"items_path":"results[]","url":{"mode":"path","value":"url"},"title":{"mode":"path","value":"title"},"content":{"mode":"paths","value":["snippet"]}}}',
      },
    });
    fireEvent.change(screen.getByLabelText("Credential (optional)"), { target: { value: "secret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(onAddSource).toHaveBeenCalledWith({
        definition: expect.objectContaining({ id: "custom", name: "Custom" }),
        credential: "secret-token",
      }),
    );
  });

  it("shows the source JSON spec from the new source page and closes it with Escape", async () => {
    const t = createTranslator("en");
    render(
      <ResearchSourceNewPage
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onAddSource={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Source JSON spec" }));

    expect(screen.getByRole("dialog", { name: "Source JSON Definition Spec" })).toBeTruthy();
    expect(screen.getByText("Complete Example")).toBeTruthy();
    expect(screen.getByText(/"name": "Company Search"/)).toBeTruthy();
    expect(screen.queryByText(/企业信息搜索/)).toBeNull();
    expect(screen.getAllByText(/"result":/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\{token\}/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Do not put real API keys/)).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Source JSON Definition Spec" })).toBeNull());
  });

  it("rejects invalid JSON for new source", async () => {
    const t = createTranslator("en");
    const onAddSource = vi.fn().mockResolvedValue(undefined);
    render(
      <ResearchSourceNewPage
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onAddSource={onAddSource}
      />,
    );

    fireEvent.change(screen.getByLabelText("Source definition (JSON)"), { target: { value: "not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByText("Could not parse JSON.")).toBeTruthy());
    expect(onAddSource).not.toHaveBeenCalled();
  });

  it("shows the source JSON spec from detail pages and closes it from the backdrop", async () => {
    const t = createTranslator("en");
    render(
      <ResearchSourceDetailPage
        source={makeSource()}
        isBusy={true}
        t={t}
        onBack={vi.fn()}
        onSaveCredential={vi.fn().mockResolvedValue(undefined)}
        onToggleEnabled={vi.fn().mockResolvedValue(undefined)}
        onSaveDefinition={vi.fn().mockResolvedValue(undefined)}
        onDeleteSource={vi.fn().mockResolvedValue(undefined)}
        onTestSource={mockTestSource()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Source JSON spec" }));

    expect(screen.getByRole("dialog", { name: "Source JSON Definition Spec" })).toBeTruthy();
    expect(screen.getByText("Result Mapping")).toBeTruthy();
    expect(screen.getByText(/url is used for deduplication/)).toBeTruthy();
    expect(screen.getByText(/result.items_path points to an array/)).toBeTruthy();
    expect(screen.getByText(/path abc.url reads item\.abc\.url/)).toBeTruthy();
    expect(screen.getByText(/result.next_cursor is not relative to each item/)).toBeTruthy();
    expect(screen.getByText(/"value": "names\[0\]\.text"/)).toBeTruthy();
    expect(screen.getByText("Template Placeholders")).toBeTruthy();
    expect(screen.getByText(/Only item\.\* and context\.\* are supported/)).toBeTruthy();
    expect(screen.getAllByText(/{{item\.company_name}}/).length).toBeGreaterThan(0);
    expect(screen.getByText(/result templates cannot read token/)).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("presentation"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Source JSON Definition Spec" })).toBeNull());
  });

  it("saves editable user source definitions and deletes user-defined sources after confirmation", async () => {
    const t = createTranslator("en");
    const onSaveDefinition = vi.fn().mockResolvedValue({ definition: { id: "custom", name: "Updated" } });
    const onDeleteSource = vi.fn().mockResolvedValue(undefined);
    render(
      <ResearchSourceDetailPage
        source={makeSource({ id: "custom", name: "Custom", kind: "user" })}
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onSaveCredential={vi.fn().mockResolvedValue(undefined)}
        onToggleEnabled={vi.fn().mockResolvedValue(undefined)}
        onSaveDefinition={onSaveDefinition}
        onDeleteSource={onDeleteSource}
        onTestSource={mockTestSource()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Source definition (JSON)"), {
      target: { value: '{"id":"custom","name":"Updated"}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save definition" }));
    await waitFor(() => expect(onSaveDefinition).toHaveBeenCalledWith({ definition: { id: "custom", name: "Updated" } }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await waitFor(() => expect(onDeleteSource).toHaveBeenCalledWith({ id: "custom" }));
  });

  it("does not render a delete button for builtin sources", () => {
    const t = createTranslator("en");
    render(
      <ResearchSourceDetailPage
        source={makeSource()}
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onSaveCredential={vi.fn().mockResolvedValue(undefined)}
        onToggleEnabled={vi.fn().mockResolvedValue(undefined)}
        onSaveDefinition={vi.fn().mockResolvedValue(undefined)}
        onDeleteSource={vi.fn().mockResolvedValue(undefined)}
        onTestSource={mockTestSource()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect((screen.getByLabelText("Source definition (JSON)") as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it("disables source edits while research is busy", () => {
    const t = createTranslator("en");
    render(
      <ResearchSourceDetailPage
        source={makeSource({ id: "custom", name: "Custom", kind: "user" })}
        isBusy={true}
        t={t}
        onBack={vi.fn()}
        onSaveCredential={vi.fn().mockResolvedValue(undefined)}
        onToggleEnabled={vi.fn().mockResolvedValue(undefined)}
        onSaveDefinition={vi.fn().mockResolvedValue(undefined)}
        onDeleteSource={vi.fn().mockResolvedValue(undefined)}
        onTestSource={mockTestSource()}
      />,
    );

    expect((screen.getByRole("checkbox", { name: /Custom Enabled/i }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Replace credential" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save definition" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ResearchTimeline", () => {
  it("shows an empty hint when no iterations exist", () => {
    const t = createTranslator("en");
    render(<ResearchTimeline iterations={[]} t={t} />);
    expect(screen.getByText("No iterations have started yet.")).toBeTruthy();
  });

  it("renders each iteration's source, queries, results count, and surfaces errors", () => {
    const t = createTranslator("en");
    render(
      <ResearchTimeline
        iterations={[
          {
            iteration: 1,
            source_id: "tavily",
            source_name: "Tavily",
            queries: ["anna app"],
            results_count: 3,
            source_calls: [
              {
                source_id: "tavily",
                source_name: "Tavily",
                query: "anna app",
                results_count: 3,
                top_titles: ["Anna intro"],
                duration_ms: 12,
                error: null,
              },
            ],
          },
          {
            iteration: 2,
            source_id: "tavily",
            source_name: "Tavily",
            queries: ["anna deep dive"],
            results_count: 0,
            source_calls: [
              {
                source_id: "tavily",
                source_name: "Tavily",
                query: "anna deep dive",
                results_count: 0,
                top_titles: [],
                duration_ms: 0,
                error: "rate_limited",
              },
            ],
          },
        ]}
        t={t}
      />,
    );

    expect(screen.getByText("Iteration 1 · Tavily")).toBeTruthy();
    expect(screen.getByText("3 results")).toBeTruthy();
    expect(screen.getByText("Iteration 2 · Tavily")).toBeTruthy();
    expect(screen.getByText(/Too many requests/i)).toBeTruthy();
  });
});

describe("ReportView", () => {
  it("renders markdown and sources without raw html injection", () => {
    const t = createTranslator("en");
    const markdown = "# Title\n\n- item\n\n<script>window.bad = true</script>";
    render(<ReportView result={{ report_markdown: markdown, source_urls: ["https://example.com", "https://second.example"] }} t={t} />);

    expect(screen.getByRole("heading", { name: "Title", level: 1 })).toBeTruthy();
    expect(screen.getByText("item")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByRole("link", { name: "https://example.com" }).getAttribute("rel")).toBe("noreferrer noopener");
    expect(screen.getByText("[1]")).toBeTruthy();
    expect(screen.getByText("[2]")).toBeTruthy();
  });
});

describe("ReportDisplayPage", () => {
  it("exports the final report through the host save picker", async () => {
    const t = createTranslator("en");
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const createWritable = vi.fn(async () => ({ write, close }));
    const showSaveFilePicker = vi.fn(async () => ({ createWritable }));
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: showSaveFilePicker,
    });

    render(
      <ReportDisplayPage
        result={{ research_id: "Research 123", report_markdown: "# Done", source_urls: ["https://example.com/a", "https://example.com/b"] }}
        events={[]}
        previews={[]}
        t={t}
        onNewResearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("menu", { name: "Choose export format" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "MD document" }));

    await waitFor(() => expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "research-123.md" })));
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    expect(appendSourcesToMarkdown("# Done", ["https://example.com/a", "https://example.com/b"], "Sources")).toBe(
      "# Done\n\n## Sources\n\n[1] https://example.com/a\n[2] https://example.com/b\n",
    );
    expect(close).toHaveBeenCalled();
    expect(screen.getByText("MD saved.")).toBeTruthy();

    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

});

describe("ResearchLibraryPage", () => {
  it("renders stored research tasks and opens the selected task", () => {
    const t = createTranslator("en");
    const onOpen = vi.fn();
    render(
      <ResearchLibraryPage
        jobs={[
          {
            research_id: "research_abc",
            query: "Research topic: Market scan",
            status: "completed",
            source_count: 3,
            updated_at: "2026-06-18T08:00:00Z",
          },
        ]}
        currentJob={null}
        isBusy={false}
        t={t}
        onBack={vi.fn()}
        onCreate={vi.fn()}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByRole("heading", { name: "Research Library" })).toBeTruthy();
    expect(screen.getByText("Market scan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("research_abc");
  });
});

describe("TaskPickerPage", () => {
  it("renders first-page task choices and opens a recent task", () => {
    const t = createTranslator("en");
    const onOpenTask = vi.fn();
    render(
      <TaskPickerPage
        jobs={[
          {
            research_id: "research_recent",
            query: "Research topic: Recent market brief",
            status: "completed",
            source_count: 4,
          },
        ]}
        latestJob={{
          research_id: "research_recent",
          query: "Research topic: Recent market brief",
          status: "completed",
          source_count: 4,
        }}
        canContinue={true}
        isBusy={false}
        message=""
        t={t}
        onCreate={vi.fn()}
        onContinue={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenTask={onOpenTask}
      />,
    );

    expect(screen.getByRole("heading", { name: "Choose task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create new/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open project/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Recent market brief/ }));
    expect(onOpenTask).toHaveBeenCalledWith("research_recent");
  });
});
