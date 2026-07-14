import { describe, expect, it } from "vitest";
import { collectAgentText } from "../../src/api/agentSession";
import type { AnnaAgentRunFrame } from "../../src/types";

describe("collectAgentText", () => {
  it("prefers a final response over streamed deltas without duplicating text", async () => {
    const text = await collectAgentText(
      frames(
        { event: "delta", text: "partial " },
        { event: "token", text: "draft" },
        { event: "final", text: "final answer" },
        { event: "complete" },
      ),
    );

    expect(text).toBe("final answer");
  });

  it("supports choice deltas and message content frames", async () => {
    const deltaText = await collectAgentText(frames({ choices: [{ delta: { content: "choice delta" } }] }, { event: "complete" }));
    const messageText = await collectAgentText(
      frames({ event: "message", message: { content: [{ text: "message answer" }] } }, { event: "complete" }),
    );

    expect(deltaText).toBe("choice delta");
    expect(messageText).toBe("message answer");
  });

  it("supports direct deltas, nested payloads, and buffered frames", async () => {
    const directDelta = await collectAgentText(frames({ event: "delta", delta: "direct delta" }, { event: "complete" }));
    const nestedPayload = await collectAgentText(frames({ payload: { event: "delta", text: "nested payload" } }, { event: "complete" }));
    const buffered = await collectAgentText(
      frames({ frames: [{ event: "delta", text: "buffered " }, { event: "delta", text: "answer" }, { event: "complete" }] }),
    );

    expect(directDelta).toBe("direct delta");
    expect(nestedPayload).toBe("nested payload");
    expect(buffered).toBe("buffered answer");
  });

  it("reads direct message text and does not duplicate alternate delta fields", async () => {
    const messageText = await collectAgentText(frames({ event: "message", text: "direct message" }, { event: "complete" }));
    const deltaText = await collectAgentText(
      frames({ event: "delta", text: "one copy", choices: [{ delta: { content: "one copy" } }] }, { event: "complete" }),
    );

    expect(messageText).toBe("direct message");
    expect(deltaText).toBe("one copy");
  });

  it("ignores tool frames and rejects an empty response", async () => {
    await expect(collectAgentText(frames({ event: "tool_result", text: "tool payload" }, { event: "complete" }), "empty section")).rejects.toThrow(
      "empty section",
    );
  });

  it("surfaces agent stream errors instead of reporting an empty response", async () => {
    await expect(
      collectAgentText(frames({ event: "error", message: "session cache miss" }), "empty section"),
    ).rejects.toThrow("session cache miss");
  });

  it("adds frame diagnostics to genuinely empty responses", async () => {
    await expect(
      collectAgentText(frames({ event: "run_meta" }, { event: "complete" }), "empty section"),
    ).rejects.toThrow("received 2 frame(s): run_meta, complete");
  });

  it("exposes every frame to an observer", async () => {
    const observed: string[] = [];
    const text = await collectAgentText(
      frames({ event: "run_meta", granted_tools: ["researcher:*"], text: "ignored" }, { event: "final", text: "done" }),
      "empty",
      { onFrame: (frame) => observed.push(String(frame.event)) },
    );

    expect(text).toBe("done");
    expect(observed).toEqual(["run_meta", "final"]);
  });
});

async function* frames(...items: AnnaAgentRunFrame[]): AsyncIterable<AnnaAgentRunFrame> {
  for (const item of items) yield item;
}
