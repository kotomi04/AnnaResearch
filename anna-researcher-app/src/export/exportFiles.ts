import type { ResearchResult } from "../types";

type FilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;

export async function exportResearchMarkdownFile(input: {
  result: ResearchResult;
  sourcesHeading: string;
}) {
  const picker = (window as Window & { showSaveFilePicker?: FilePicker }).showSaveFilePicker;
  if (!picker) throw new Error("showSaveFilePicker is not available in this host.");

  const filename = `${safeExportFilename(input.result.research_id)}.md`;
  const markdown = appendSourcesToMarkdown(input.result.report_markdown || "", input.result.source_urls || [], input.sourcesHeading);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const handle = await picker({
    suggestedName: filename,
    types: [{ description: "Markdown file", accept: { "text/markdown": [".md"] } }],
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export function safeExportFilename(researchId?: string) {
  const value = (researchId || "anna-research-report").toLowerCase();
  return value.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "anna-research-report";
}

export function appendSourcesToMarkdown(markdown: string, sourceUrls: string[], heading = "Sources") {
  const cleanedUrls = sourceUrls.map((url) => String(url || "").trim()).filter(Boolean);
  if (!cleanedUrls.length) return markdown;
  const references = cleanedUrls.map((url, index) => `[${index + 1}] ${url}`).join("\n");
  return `${markdown.trim()}\n\n## ${heading}\n\n${references}\n`;
}
