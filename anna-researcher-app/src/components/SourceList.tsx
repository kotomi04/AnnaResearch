import type { MessageKey } from "../i18n/messages";
import type { SearchResult } from "../types";

interface Props {
  urls: string[];
  sources?: SearchResult[];
  t(key: MessageKey): string;
}

export function SourceList({ urls, sources = [], t }: Props) {
  return (
    <aside className="source-references-panel">
      <h2>{t("sourcesHeading")}</h2>
      {urls.length === 0 ? (
        <p className="source-empty">{t("emptySources")}</p>
      ) : (
        <ol id="sources-list" className="reference-list">
          {urls.map((url, index) => {
            const source = sourceForUrl(sources, url);
            const host = hostFromUrl(url);
            const fallbackInitial = (host || url || "S").trim().charAt(0).toUpperCase() || "S";
            return (
              <li key={url}>
                <span className="reference-index" aria-label={`Reference ${index + 1}`}>[{index + 1}]</span>
                {source?.icon ? <img className="reference-icon" src={source.icon} alt="" aria-hidden="true" /> : <span className="reference-site-mark" aria-hidden="true">{fallbackInitial}</span>}
                <a href={url} target="_blank" rel="noreferrer noopener">
                  {source?.title || url}
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
