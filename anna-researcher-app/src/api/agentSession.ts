import type { AnnaAgentRunFrame } from "../types";

export async function collectAgentText(
  stream: AsyncIterable<AnnaAgentRunFrame>,
  emptyMessage = "Anna Agent returned an empty response.",
  options: { onFrame?: (frame: AnnaAgentRunFrame) => void } = {},
): Promise<string> {
  let streamedText = "";
  let finalText = "";
  let frameCount = 0;
  const observedEvents = new Set<string>();

  outer: for await (const receivedFrame of stream) {
    options.onFrame?.(receivedFrame);
    for (const frame of expandFrames(receivedFrame)) {
      frameCount += 1;
      const event = frameEvent(frame);
      observedEvents.add(event || "unknown");
      if (event === "error") {
        throw new Error(frameErrorMessage(frame) || "Anna Agent stream returned an error.");
      }
      if (event === "raw" && extractFrameText(frame).trim() === "[DONE]") break outer;
      if (event === "tool_call" || event === "tool_result") continue;

      const isFinalEvent = event === "message" || event === "final" || event === "complete";
      const candidate = extractFrameText(frame);
      if (isFinalEvent && candidate.trim()) {
        finalText = candidate;
      } else if (candidate && event !== "message" && event !== "final" && event !== "complete" && event !== "end") {
        streamedText += candidate;
      }
      if (event === "complete" || event === "end") break outer;
    }
  }

  const text = (finalText || streamedText).trim();
  if (!text) {
    const diagnostic = frameCount === 0
      ? "received no stream frames"
      : `received ${frameCount} frame(s): ${Array.from(observedEvents).join(", ")}`;
    throw new Error(`${emptyMessage} (${diagnostic}).`);
  }
  return text;
}

function expandFrames(frame: AnnaAgentRunFrame): AnnaAgentRunFrame[] {
  if (!Array.isArray(frame.frames)) return [frame];
  return frame.frames.flatMap(expandFrames);
}

function frameEvent(frame: AnnaAgentRunFrame): string {
  const direct = String(frame.event || "").toLowerCase();
  if (direct) return direct;
  const payload = asFrame(frame.payload);
  return payload ? frameEvent(payload) : "";
}

function extractFrameText(frame: AnnaAgentRunFrame): string {
  const messageContent = typeof frame.message === "object" && frame.message
    ? contentToText(frame.message.content)
    : "";
  const direct = firstText(
    frame.text,
    frame.output_text,
    contentToText(frame.content),
    typeof frame.delta === "string" ? frame.delta : "",
    contentToText(asRecord(frame.delta)?.content),
    contentToText(asRecord(frame.delta)?.text),
    messageContent,
  );
  if (direct) return direct;

  const choiceText = (frame.choices || [])
    .map((choice) => firstText(
      choice?.delta?.content,
      choice?.delta?.text,
      contentToText(choice?.message?.content),
    ))
    .join("");
  if (choiceText) return choiceText;

  const payload = asFrame(frame.payload);
  return payload ? extractFrameText(payload) : "";
}

function frameErrorMessage(frame: AnnaAgentRunFrame): string {
  if (typeof frame.message === "string") return frame.message;
  const direct = firstText(frame.text, contentToText(frame.message?.content));
  if (direct) return direct;
  const payload = asFrame(frame.payload);
  return payload ? frameErrorMessage(payload) : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asFrame(value: unknown): AnnaAgentRunFrame | undefined {
  return asRecord(value) as AnnaAgentRunFrame | undefined;
}

function firstText(...values: unknown[]): string {
  return values.find(isText) as string | undefined || "";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .join("");
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
