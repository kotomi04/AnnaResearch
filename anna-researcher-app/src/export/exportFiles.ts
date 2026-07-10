import type { CitationSource, ResearchResult } from "../types";

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
  const citationSources = input.result.citation_sources?.length
    ? input.result.citation_sources
    : (input.result.source_urls || []).map((url) => ({ kind: "url" as const, url }));
  const markdown = appendSourcesToMarkdown(input.result.report_markdown || "", citationSources, input.sourcesHeading);
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

export function appendSourcesToMarkdown(markdown: string, citationSources: CitationSource[], heading = "Sources") {
  const references = citationSources
    .map((source, index) => formatMarkdownCitationSource(source, index + 1))
    .filter(Boolean)
    .join("\n");
  if (!references) return markdown;
  return `${markdown.trim()}\n\n## ${heading}\n\n${references}\n`;
}

function formatMarkdownCitationSource(source: CitationSource, number: number): string {
  if (source.kind === "url") {
    const url = String(source.url || "").trim();
    return url ? `[${number}] ${url}` : "";
  }
  const fileName = String(source.file_name || "").trim();
  if (!fileName) return "";
  const chunkLabel = attachmentChunkLabel(source);
  return `[${number}] ${fileName}${chunkLabel ? ` · ${chunkLabel}` : ""}`;
}

function attachmentChunkLabel(source: Extract<CitationSource, { kind: "attachment" }>): string {
  const chunkId = String(source.chunk_id || "");
  const match = /:(?:0*)(\d+)$/.exec(chunkId);
  if (match) return `chunk ${Number(match[1])}`;
  if (chunkId.endsWith(":image-summary")) return "";
  return chunkId ? "chunk" : "";
}
