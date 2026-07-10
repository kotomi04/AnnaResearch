import { useEffect, useState } from "react";

interface Props {
  host: string;
  icon?: string;
  imageClassName: string;
  fallbackClassName: string;
  fallbackText: string;
}

export function SourceSiteIcon({ host, icon, imageClassName, fallbackClassName, fallbackText }: Props) {
  const normalizedHost = normalizeHost(host);
  const iconUrl = String(icon || "").trim() || (normalizedHost ? `https://${normalizedHost}/favicon.ico` : "");
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [iconUrl]);

  if (!iconUrl || failed) {
    return <span className={fallbackClassName} aria-hidden="true">{fallbackText}</span>;
  }
  return <img className={imageClassName} src={iconUrl} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}

function normalizeHost(host: string): string {
  return String(host || "").trim().toLowerCase().replace(/^www\./, "");
}
