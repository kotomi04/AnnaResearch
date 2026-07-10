import type { AnnaAgentRunFrame } from "../types";

export async function collectAgentText(
  stream: AsyncIterable<AnnaAgentRunFrame>,
  emptyMessage = "Anna Agent returned an empty response.",
  options: { onFrame?: (frame: AnnaAgentRunFrame) => void } = {},
): Promise<string> {
  let streamedText = "";
  let finalText = "";

  for await (const frame of stream) {
    options.onFrame?.(frame);
    const event = String(frame.event || "").toLowerCase();
    if (event === "raw" && frame.text?.trim() === "[DONE]") break;
    if (event === "tool_call" || event === "tool_result") continue;

    const choiceDeltas = (frame.choices || [])
      .map((choice) => [choice?.delta?.content, choice?.delta?.text].filter(isText).join(""))
      .join("");
    const isFinalEvent = event === "message" || event === "final" || event === "complete";
    const finalCandidate = [
      isFinalEvent ? frame.text : "",
      isFinalEvent ? frame.output_text : "",
      isFinalEvent ? contentToText(frame.content) : "",
      isFinalEvent ? contentToText(frame.message?.content) : "",
      ...(frame.choices || []).map((choice) => contentToText(choice?.message?.content)),
    ]
      .filter(isText)
      .join("");

    if (finalCandidate.trim()) finalText = finalCandidate;
    if (!finalCandidate.trim() && event !== "message" && event !== "final" && event !== "complete" && event !== "end") {
      const directDelta = [frame.text, frame.output_text, contentToText(frame.content)].filter(isText).join("");
      streamedText += directDelta || choiceDeltas;
    }
    if (event === "complete" || event === "end") break;
  }

  const text = (finalText || streamedText).trim();
  if (!text) throw new Error(emptyMessage);
  return text;
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
