import type { MessageKey } from "../i18n/messages";
import type { CitationSource, SearchResult } from "../types";
import { SourceSiteIcon } from "./SourceSiteIcon";

interface Props {
  urls: string[];
  sources?: SearchResult[];
  citationSources?: CitationSource[];
  t(key: MessageKey): string;
  onAttachmentOpen?(source: Extract<CitationSource, { kind: "attachment" }>): void;
}

export function SourceList({ urls, sources = [], citationSources, t, onAttachmentOpen }: Props) {
  const references = citationSources?.length ? citationSources : urls.map((url) => ({ kind: "url" as const, url }));
  return (
    <aside className="source-references-panel">
      <h2>{t("sourcesHeading")}</h2>
      {references.length === 0 ? (
        <p className="source-empty">{t("emptySources")}</p>
      ) : (
        <ol id="sources-list" className="reference-list">
          {references.map((reference, index) => {
            if (reference.kind === "attachment") {
              const label = attachmentChunkLabel(reference);
              return (
                <li key={`${reference.file_id}-${reference.chunk_id || index}`} className="reference-attachment-item">
                  <span className="reference-index" aria-label={`Reference ${index + 1}`}>[{index + 1}]</span>
                  {onAttachmentOpen ? (
                    <button type="button" className="reference-attachment-button" onClick={() => onAttachmentOpen(reference)}>
                      {reference.file_name}{label ? ` · ${label}` : ""}
                    </button>
                  ) : (
                    <span>
                      {reference.file_name}{label ? ` · ${label}` : ""}
                    </span>
                  )}
                </li>
              );
            }
            const source = sourceForUrl(sources, reference.url);
            const host = hostFromUrl(reference.url);
            const fallbackInitial = (host || reference.url || "S").trim().charAt(0).toUpperCase() || "S";
            return (
              <li key={reference.url}>
                <span className="reference-index" aria-label={`Reference ${index + 1}`}>[{index + 1}]</span>
                <SourceSiteIcon
                  host={host}
                  icon={source?.icon}
                  imageClassName="reference-icon"
                  fallbackClassName="reference-site-mark"
                  fallbackText={fallbackInitial}
                />
                <a href={reference.url} target="_blank" rel="noreferrer noopener">
                  {source?.title || reference.url}
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function attachmentChunkLabel(reference: Extract<CitationSource, { kind: "attachment" }>): string {
  const chunkId = String(reference.chunk_id || "");
  const match = /:(?:0*)(\d+)$/.exec(chunkId);
  if (match) return `chunk ${Number(match[1])}`;
  if (chunkId.endsWith(":image-summary")) return "";
  return chunkId ? "chunk" : "";
}

function sourceForUrl(sources: SearchResult[], url: string): SearchResult | null {
  const normalized = normalizeUrlForMatch(url);
  return sources.find((source) => normalizeUrlForMatch(source.url) === normalized) || null;
}

function normalizeUrlForMatch(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/";
    return parsed.toString();
  } catch {
    return String(url || "").trim().replace(/\/$/, "");
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
