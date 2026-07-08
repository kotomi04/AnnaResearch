import type { AnnaFilesApi, AttachmentPrepareInput, ResearchAttachment } from "../types";

export interface UploadedResearchFile {
  name: string;
  path: string;
  content_type: string;
  size_bytes: number;
  etag: string;
  uploaded_at: string;
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
    descriptors.push({
      name: attachment.name,
      path,
      content_type: attachment.content_type,
      size_bytes: attachment.size_bytes,
      download_url: downloadUrl,
    });
  }
  return descriptors;
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
