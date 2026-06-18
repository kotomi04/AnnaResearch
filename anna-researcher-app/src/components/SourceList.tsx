import type { MessageKey } from "../i18n/messages";

interface Props {
  urls: string[];
  t(key: MessageKey): string;
}

export function SourceList({ urls, t }: Props) {
  return (
    <aside>
      <h2>{t("sourcesHeading")}</h2>
      {urls.length === 0 ? (
        <p className="source-empty">{t("emptySources")}</p>
      ) : (
        <ol id="sources-list" className="reference-list">
          {urls.map((url, index) => (
            <li key={url}>
              <span className="reference-index" aria-label={`Reference ${index + 1}`}>[{index + 1}]</span>
              <a href={url} target="_blank" rel="noreferrer noopener">
                {url}
              </a>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
