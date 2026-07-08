import type { MessageKey } from "../i18n/messages";
import type { CitationSource, SearchResult } from "../types";

interface Props {
  urls: string[];
  sources?: SearchResult[];
  citationSources?: CitationSource[];
  t(key: MessageKey): string;
}

export function SourceList({ urls, sources = [], citationSources, t }: Props) {
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
              const fallbackInitial = (reference.file_name || "F").trim().charAt(0).toUpperCase() || "F";
              return (
                <li key={`${reference.file_id}-${reference.chunk_id || index}`}>
                  <span className="reference-index" aria-label={`Reference ${index + 1}`}>[{index + 1}]</span>
                  <span className="reference-site-mark" aria-hidden="true">{fallbackInitial}</span>
                  <span>
                    {reference.file_name}
                    {reference.chunk_id ? ` · ${reference.chunk_id}` : ""}
                  </span>
                </li>
              );
            }
            const source = sourceForUrl(sources, reference.url);
            const host = hostFromUrl(reference.url);
            const fallbackInitial = (host || reference.url || "S").trim().charAt(0).toUpperCase() || "S";
            return (
              <li key={reference.url}>
                <span className="reference-index" aria-label={`Reference ${index + 1}`}>[{index + 1}]</span>
                {source?.icon ? <img className="reference-icon" src={source.icon} alt="" aria-hidden="true" /> : <span className="reference-site-mark" aria-hidden="true">{fallbackInitial}</span>}
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
