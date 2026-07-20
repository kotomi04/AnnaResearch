import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { TOOL_ID, type AnnaRuntimeApi } from "../../src/types";

const runtimeMock = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<AnnaRuntimeApi>>(),
}));

vi.mock("/static/anna-apps/_sdk/latest/index.js", () => ({
  AnnaAppRuntime: runtimeMock,
}));

describe("App Anna runtime integration", () => {
  beforeEach(() => {
    runtimeMock.connect.mockReset();
    window.localStorage.clear();
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads research sources through the ESM Anna runtime SDK", async () => {
    const calls: unknown[] = [];
    runtimeMock.connect.mockResolvedValue(makeAnnaRuntime(calls));

    render(<App />);

    await waitFor(() => expect(runtimeMock.connect).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("open-source-panel"));

    expect(await screen.findByText("Tavily")).toBeTruthy();
    expect(calls).toContainEqual({ tool_id: TOOL_ID, method: "app_list_research_sources", args: {} });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a runtime connection error on the research source page", async () => {
    runtimeMock.connect.mockRejectedValue(new Error("host handshake failed"));

    render(<App />);

    fireEvent.click(screen.getByTestId("open-source-panel"));

    expect((await screen.findByRole("alert")).textContent).toBe("Anna runtime is not connected.");
  });

  it("returns from the library to the page that opened it", async () => {
    const calls: unknown[] = [];
    runtimeMock.connect.mockResolvedValue(makeAnnaRuntime(calls));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Create new" }));
    expect(await screen.findByRole("heading", { name: "What are you researching?" })).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Library" })[0]);
    expect(await screen.findByRole("heading", { name: "Research Library" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "What are you researching?" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Choose task" })).toBeNull();
  });

  it("continues the most recently updated history job instead of the latest pointer", async () => {
    const calls: unknown[] = [];
    runtimeMock.connect.mockResolvedValue(makeAnnaRuntime(calls, {
      currentJob: {
        research_id: "research_stale",
        query: "Research topic: Stale current task",
        status: "created",
        updated_at: "2026-07-01T00:00:00Z",
      },
      historyJobs: [
        {
          research_id: "research_recent",
          query: "Research topic: Recently edited task",
          status: "created",
          updated_at: "2026-07-06T00:00:00Z",
        },
        {
          research_id: "research_stale",
          query: "Research topic: Stale current task",
          status: "created",
          updated_at: "2026-07-01T00:00:00Z",
        },
      ],
    }));

    render(<App />);

    expect(await screen.findByText("Recently edited task")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Open latest" }));

    await waitFor(() =>
      expect(calls).toContainEqual({ tool_id: TOOL_ID, method: "app_get_research_job_payload", args: { research_id: "research_recent" } }),
    );
  });
});

function makeAnnaRuntime(
  calls: unknown[],
  options: { currentJob?: Record<string, unknown> | null; historyJobs?: Record<string, unknown>[] } = {},
): AnnaRuntimeApi {
  return {
    tools: {
      async invoke(request) {
        calls.push(request);
        if (request.method === "app_get_settings") {
          return { success: true, data: { settings: { tavily: { configured: true, masked: "***test" } } } };
        }
        if (request.method === "app_list_research_sources") {
          return {
            success: true,
            data: {
              sources: [
                {
                  id: "tavily",
                  name: "Tavily",
                  kind: "builtin",
                  enabled: true,
                  max_parallel: 3,
                  credential_status: "configured",
                  credential: "tvly-test",
                },
              ],
            },
          };
        }
        if (request.method === "app_get_research_job") {
          if (request.args.research_id) {
            const selected = (options.historyJobs || []).find((job) => job.research_id === request.args.research_id) || null;
            return { success: true, data: { job: selected } };
          }
          return { success: true, data: { job: options.currentJob ?? null } };
        }
        if (request.method === "app_list_research_jobs") {
          return { success: true, data: { jobs: options.historyJobs || [] } };
        }
        return { success: true, data: {} };
      },
    },
    llm: {
      async complete() {
        return { content: { type: "text", text: "{}" } };
      },
    },
  };
}
