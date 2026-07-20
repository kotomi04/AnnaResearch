import type { AnnaAgentApi, AnnaFilesApi, ApsTransferDescriptor, AttachmentImageAnalysis, AttachmentPrepareInput, ResearchAttachment } from "../types";
import { collectAgentText } from "./agentSession";

export interface UploadedResearchFile {
  name: string;
  path: string;
  content_type: string;
  size_bytes: number;
  etag: string;
  uploaded_at: string;
}

const MAX_TRANSFER_BYTES = 32 * 1024 * 1024;

export async function uploadJsonTransfer(input: {
  filesApi: AnnaFilesApi | null | undefined;
  prefix: string;
  kind: string;
  payload: unknown;
}): Promise<ApsTransferDescriptor> {
  if (!input.filesApi) throw new Error("Anna files API is unavailable for APS transfer.");
  const bytes = new TextEncoder().encode(JSON.stringify(input.payload));
  if (bytes.byteLength > MAX_TRANSFER_BYTES) throw new Error("APS transfer payload exceeds 32 MiB.");
  const path = `${input.prefix.replace(/\/+$/, "")}/transfers/${sanitizeFilename(input.kind)}-${transferNonce()}.json`;
  const init = await input.filesApi.upload_init({ path, content_type: "application/json", size: bytes.byteLength });
  const response = await fetch(init.put_url, { method: "PUT", headers: init.headers || {}, body: bytes });
  if (!response.ok) throw new Error(`APS transfer upload failed with HTTP ${response.status}.`);
  const etag = (response.headers.get("ETag") || "").replace(/"/g, "") || init.upload_id || "";
  const finalized = await input.filesApi.upload_finalize({ path, etag, size_bytes: bytes.byteLength });
  return {
    path: finalized.path || path,
    content_type: "application/json",
    size_bytes: finalized.size_bytes ?? bytes.byteLength,
    etag: finalized.etag || etag,
    sha256: await sha256Hex(bytes),
    delete_after_read: true,
  };
}

export async function downloadJsonTransfer<T>(input: {
  filesApi: AnnaFilesApi | null | undefined;
  transfer: ApsTransferDescriptor;
}): Promise<T> {
  if (!input.filesApi) throw new Error("Anna files API is unavailable for APS transfer.");
  validateApsTransferDescriptor(input.transfer);
  const link = await input.filesApi.download_url({ path: input.transfer.path });
  const url = String(link.get_url || link.url || "");
  if (!url) throw new Error("Anna files download_url did not return a URL for APS transfer.");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`APS transfer download failed with HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== input.transfer.size_bytes) throw new Error("APS transfer size mismatch.");
  if (await sha256Hex(bytes) !== input.transfer.sha256.toLowerCase()) throw new Error("APS transfer sha256 mismatch.");
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("APS transfer did not contain valid JSON.");
  }
  await deleteTransferBestEffort(input.filesApi, input.transfer);
  return data as T;
}

export async function deleteTransferBestEffort(filesApi: AnnaFilesApi | null | undefined, transfer: ApsTransferDescriptor): Promise<void> {
  if (!filesApi?.delete || !transfer.delete_after_read || !transfer.path.includes("/transfers/")) return;
  await filesApi.delete({ path: transfer.path }).catch(() => undefined);
}

function validateApsTransferDescriptor(transfer: ApsTransferDescriptor): void {
  if (!transfer?.path || !transfer.path.includes("/transfers/") || !transfer.path.endsWith(".json")) throw new Error("APS transfer path is invalid.");
  if (transfer.content_type !== "application/json") throw new Error("APS transfer content type is invalid.");
  if (transfer.delete_after_read !== true) throw new Error("APS transfer delete_after_read flag is invalid.");
  if (!Number.isInteger(transfer.size_bytes) || transfer.size_bytes < 0 || transfer.size_bytes > MAX_TRANSFER_BYTES) throw new Error("APS transfer size is invalid.");
  if (!/^[0-9a-f]{64}$/i.test(transfer.sha256 || "")) throw new Error("APS transfer sha256 is invalid.");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function transferNonce(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function uploadResearchFilesToAps(input: {
  filesApi: AnnaFilesApi | null | undefined;
  researchId: string;
  files: File[];
}): Promise<UploadedResearchFile[]> {
  if (!input.files.length) return [];
  if (!input.filesApi) throw new Error("Anna files API is unavailable.");
  const researchId = input.researchId.trim();
  if (!researchId) throw new Error("Research job is missing research_id.");

  const prefix = `research-jobs/${encodePathPart(researchId)}/uploads`;
  const uploaded: UploadedResearchFile[] = [];
  for (const [index, file] of input.files.entries()) {
    const contentType = file.type || "application/octet-stream";
    const path = `${prefix}/${Date.now()}-${index + 1}-${sanitizeFilename(file.name || "attachment")}`;
    const init = await input.filesApi.upload_init({
      path,
      content_type: contentType,
      size: file.size,
    });
    const putRes = await fetch(init.put_url, {
      method: "PUT",
      headers: init.headers || {},
      body: file,
    });
    if (!putRes.ok) {
      const body = await putRes.text().catch(() => "");
      throw new Error(`File upload failed (${putRes.status}): ${body.slice(0, 240)}`);
    }
    const etag = (putRes.headers.get("ETag") || "").replace(/"/g, "") || init.upload_id || "";
    const finalize = await input.filesApi.upload_finalize({
      path,
      etag,
      size_bytes: file.size,
    });
    uploaded.push({
      name: file.name,
      path: finalize.path || path,
      content_type: contentType,
      size_bytes: finalize.size_bytes ?? file.size,
      etag: finalize.etag || etag,
      uploaded_at: new Date().toISOString(),
    });
  }
  return uploaded;
}

export async function getResearchFileDownloadDescriptors(input: {
  filesApi: AnnaFilesApi | null | undefined;
  agentApi?: AnnaAgentApi | null | undefined;
  researchQuery?: string;
  attachments: ResearchAttachment[];
}): Promise<AttachmentPrepareInput[]> {
  if (!input.attachments.length) return [];
  if (!input.filesApi) throw new Error("Anna files API is unavailable.");
  const descriptors: AttachmentPrepareInput[] = [];
  for (const attachment of input.attachments) {
    const path = String(attachment.path || "").trim();
    if (!path) continue;
    const response = await input.filesApi.download_url({ path });
    const downloadUrl = String(response.get_url || response.url || "").trim();
    if (!downloadUrl) throw new Error(`Anna files download_url did not return a URL for ${attachment.name || path}.`);
    const descriptor: AttachmentPrepareInput = {
      name: attachment.name,
      path,
      content_type: attachment.content_type,
      size_bytes: attachment.size_bytes,
      download_url: downloadUrl,
    };
    if (isImageAttachment(attachment)) {
      try {
        descriptor.image_analysis = await analyzeImageAttachment({
          agentApi: input.agentApi,
          name: attachment.name,
          contentType: attachment.content_type,
          downloadUrl,
          researchQuery: input.researchQuery,
        });
      } catch (error) {
        descriptor.image_analysis_error = error instanceof Error ? error.message : String(error);
      }
    }
    descriptors.push(descriptor);
  }
  return descriptors;
}

async function analyzeImageAttachment(input: {
  agentApi: AnnaAgentApi | null | undefined;
  name: string;
  contentType?: string;
  downloadUrl: string;
  researchQuery?: string;
}): Promise<AttachmentImageAnalysis> {
  if (!input.agentApi) throw new Error("Anna agent API is unavailable for image analysis.");
  const session = await input.agentApi.session({ submode: "auto" });
  try {
    const text = await collectAgentText(
      session.run({
        content: buildImageAnalysisPrompt(input),
      }),
      "Image analysis returned an empty response.",
    );
    return normalizeImageAnalysis(parseJsonObject(text), text);
  } finally {
    await session.delete().catch(() => undefined);
  }
}

function buildImageAnalysisPrompt(input: { name: string; contentType?: string; downloadUrl: string; researchQuery?: string }): string {
  return [
    "You are analyzing one uploaded research image attachment for later use in a research report.",
    "",
    "You MUST call the `analyze_image` tool directly on the image URL below before making any judgment.",
    "Do not use `upload_local_file`; the URL is already available to analyze directly.",
    "After the tool call, your final answer MUST be exactly one JSON object that follows the schema below.",
    "Do not return the raw tool output unless it has been transformed into this schema.",
    "Do not include markdown, code fences, comments, explanations, or any text before or after the JSON object.",
    "",
    "Core rules:",
    "- Describe only what is visible in the image.",
    "- Do not invent facts, numbers, dates, organizations, locations, chart values, or source names.",
    "- Do not infer hidden context beyond the image.",
    "- If text, numbers, axes, legends, or labels are hard to read, put them in `uncertainties` instead of guessing.",
    "- If the image is a chart/table, distinguish clearly between directly readable values and visual trends.",
    "- If the image contains people, only describe visible, non-sensitive attributes needed for research context.",
    "- Do not identify people unless their name is visibly written in the image.",
    "- If the image cannot be accessed or analyzed, still return the same JSON schema with image_type `unknown`, a concise failure summary, empty arrays, relevance_score 0, and the reason in `extraction_limits`.",
    "",
    "Output contract:",
    "- The response MUST start with `{` and end with `}`.",
    "- The response MUST be parseable by JSON.parse.",
    "- Use double quotes for every key and string.",
    "- Do not use trailing commas.",
    "- Do not omit required top-level keys from the schema.",
    "",
    "Return this exact JSON shape, replacing placeholder values with your analysis:",
    JSON.stringify(
      {
        image_type: "photo | chart | table | screenshot | document_scan | diagram | map | mixed | unknown",
        summary: "One concise sentence describing the image.",
        detailed_description: "A neutral description of the visible content.",
        visible_text: [
          {
            text: "Exact readable text from the image.",
            location: "Approximate location, e.g. top-left, chart title, x-axis, legend, table header.",
            confidence: "high | medium | low",
          },
        ],
        key_observations: [
          {
            observation: "A factual observation visible in the image.",
            evidence: "What visible part of the image supports this observation.",
            confidence: "high | medium | low",
          },
        ],
        chart_or_table: {
          is_chart_or_table: true,
          type: "bar_chart | line_chart | pie_chart | scatter_plot | table | other | not_applicable",
          title: "Readable chart/table title, or empty string.",
          axes_or_headers: ["Readable axes, legends, or table headers."],
          readable_values: ["Only values that are clearly readable."],
          visual_trends: ["Only broad visual trends, not invented precise values."],
        },
        research_relevance: {
          relevance: "How this image relates to the research task, or why it is unrelated.",
          relevance_score: "number from 0 to 1",
          possible_use_in_report: "How this image could be cited or used later.",
          related_topics: ["Keywords or topics visibly supported by the image."],
        },
        uncertainties: ["Anything unreadable, ambiguous, cropped, low-resolution, or uncertain."],
        extraction_limits: ["Limitations of this analysis, e.g. cannot verify source/date/context from image alone."],
      },
      null,
      2,
    ),
    "",
    "Set research_relevance.relevance_score from 0 to 1, where 0 means unrelated and 1 means directly useful for the research query.",
    "",
    "Context for relevance judgment:",
    `Research query: ${input.researchQuery || "(not provided)"}`,
    "",
    `Attachment name: ${input.name || "image attachment"}`,
    `Content type: ${input.contentType || "image/*"}`,
    `Image URL: ${input.downloadUrl}`,
  ].join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    }
  }
  throw new Error(`Image analysis did not return a JSON object. Raw response preview: ${previewText(text)}`);
}

function previewText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300) || "(empty)";
}

function normalizeImageAnalysis(value: Record<string, unknown>, rawText: string): AttachmentImageAnalysis {
  const summary = readString(value.summary);
  if (!summary) throw new Error("Image analysis JSON did not include summary.");
  return {
    image_type: readString(value.image_type),
    summary,
    detailed_description: readString(value.detailed_description),
    visible_text: value.visible_text,
    key_observations: value.key_observations,
    chart_or_table: value.chart_or_table,
    research_relevance: value.research_relevance,
    uncertainties: readStringArray(value.uncertainties),
    extraction_limits: readStringArray(value.extraction_limits),
    raw_text: rawText,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return items.length ? items : undefined;
}

function isImageAttachment(attachment: ResearchAttachment): boolean {
  const contentType = String(attachment.content_type || "").split(";")[0].trim().toLowerCase();
  if (["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(contentType)) return true;
  const path = `${attachment.name || ""} ${attachment.path || ""}`.toLowerCase();
  return /\.(png|jpe?g|webp|gif)(\s|$)/.test(path);
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "attachment";
}

function encodePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
