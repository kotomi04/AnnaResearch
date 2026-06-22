import { describe, expect, it } from "vitest";
import { createTranslator, detectInitialLocale, formatMessage, messages } from "../../src/i18n/messages";
import { localizedError, localizedJobMessage, localizedSourceCount, localizedStageMessage, localizedStatusLabel } from "../../src/i18n/status";

describe("typed app shell messages", () => {
  it("keeps Chinese and English message keys in parity", () => {
    expect(Object.keys(messages["zh-CN"]).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it("detects browser locale with stored preference override", () => {
    expect(detectInitialLocale("zh-CN")).toBe("zh-CN");
    expect(detectInitialLocale("en-US")).toBe("en");
    expect(detectInitialLocale("zh-CN", "en")).toBe("en");
    expect(detectInitialLocale("en-US", "zh-CN")).toBe("zh-CN");
  });

  it("interpolates message params", () => {
    expect(formatMessage("Searching {current}/{total}.", { current: 1, total: 3 })).toBe("Searching 1/3.");
  });
});

describe("localized status mapping", () => {
  it("maps stable status and stage values", () => {
    const t = createTranslator("en");
    expect(localizedStatusLabel("running", t)).toBe("Running");
    expect(localizedStageMessage({ stage: "search_next_query", iteration: 2, max_iterations: 4 }, t)).toBe("Calling research source 2/4.");
  });

  it("maps known errors and preserves raw details", () => {
    const t = createTranslator("en");
    expect(localizedError({ code: "missing_tavily_credential", message: "TAVILY_API_KEY missing" }, t)).toContain("Missing research source credential");
    expect(localizedError({ code: "missing_tavily_credential", message: "TAVILY_API_KEY missing" }, t)).toContain("Technical details");
    expect(localizedError({ code: "sampling_error", message: "sampling/createMessage timed out after 45.0s" }, t)).toContain("Anna Sampling failed");
    expect(localizedError({ code: "tool_failed", message: "executa timed out" }, t)).toContain("Research tool invocation failed");
  });

  it("falls back for unknown values", () => {
    const t = createTranslator("en");
    expect(localizedStatusLabel("paused", t)).toContain("Unknown status");
    expect(localizedStageMessage({ stage: "custom_stage" }, t)).toContain("Unknown stage");
    expect(localizedError({ message: "raw backend message" }, t)).toBe("raw backend message");
  });

  it("localizes job message and source count", () => {
    const t = createTranslator("zh-CN");
    expect(localizedJobMessage({ status: "completed", stage: "completed" }, t).message).toBe("");
    expect(localizedSourceCount(3, t)).toBe("3 个来源");
  });
});
