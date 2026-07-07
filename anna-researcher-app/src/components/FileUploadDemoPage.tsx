import { useMemo, useState } from "react";
import type { AnnaFilesApi, AnnaFilesListItem } from "../types";

interface FileUploadDemoPageProps {
  filesApi: AnnaFilesApi | null;
  onBack: () => void;
}

interface UploadSummary {
  path: string;
  sizeBytes: number;
  etag: string;
}

const DEFAULT_PREFIX = "researcher/uploads/";
const DEFAULT_PATH = `${DEFAULT_PREFIX}hello.txt`;
const DEFAULT_TEXT = "Hello from Anna Researcher APS upload test.";
const DEFAULT_CONTENT_TYPE = "text/plain; charset=utf-8";

export function FileUploadDemoPage({ filesApi, onBack }: FileUploadDemoPageProps) {
  const [path, setPath] = useState(DEFAULT_PATH);
  const [prefix, setPrefix] = useState(DEFAULT_PREFIX);
  const [contentType, setContentType] = useState(DEFAULT_CONTENT_TYPE);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [status, setStatus] = useState(filesApi ? "Ready" : "Anna files API is unavailable.");
  const [isBusy, setIsBusy] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [items, setItems] = useState<AnnaFilesListItem[]>([]);
  const [lastUpload, setLastUpload] = useState<UploadSummary | null>(null);
  const [rawJson, setRawJson] = useState("");

  const normalizedPath = useMemo(() => path.trim() || DEFAULT_PATH, [path]);
  const normalizedPrefix = useMemo(() => prefix.trim() || DEFAULT_PREFIX, [prefix]);

  async function upload() {
    if (!filesApi) {
      setStatus("Anna files API is unavailable. Check manifest files grant and APS storage.");
      return;
    }
    setIsBusy(true);
    setDownloadUrl("");
    setStatus("Uploading...");
    try {
      const bytes = new TextEncoder().encode(text);
      const init = await filesApi.upload_init({
        path: normalizedPath,
        content_type: contentType.trim() || DEFAULT_CONTENT_TYPE,
        size: bytes.length,
      });
      setRawJson(JSON.stringify({ upload_init: init }, null, 2));
      const putRes = await fetch(init.put_url, {
        method: "PUT",
        headers: init.headers || {},
        body: bytes,
      });
      if (!putRes.ok) {
        const body = await putRes.text().catch(() => "");
        throw new Error(`PUT ${putRes.status}: ${body.slice(0, 240)}`);
      }
      const etag = (putRes.headers.get("ETag") || "").replace(/"/g, "") || init.upload_id || "";
      const finalize = await filesApi.upload_finalize({
        path: normalizedPath,
        etag,
        size_bytes: bytes.length,
      });
      const summary = {
        path: finalize.path || normalizedPath,
        sizeBytes: finalize.size_bytes ?? bytes.length,
        etag: finalize.etag || etag,
      };
      setLastUpload(summary);
      setRawJson(JSON.stringify({ upload_init: init, upload_finalize: finalize }, null, 2));
      setStatus("Uploaded");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function getDownloadUrl() {
    if (!filesApi) {
      setStatus("Anna files API is unavailable.");
      return;
    }
    setIsBusy(true);
    setStatus("Requesting download URL...");
    try {
      const res = await filesApi.download_url({ path: normalizedPath });
      setRawJson(JSON.stringify({ download_url: res }, null, 2));
      const url = res.get_url || res.url || "";
      setDownloadUrl(url);
      setStatus(url ? "Download URL ready" : "No URL returned");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      setDownloadUrl("");
    } finally {
      setIsBusy(false);
    }
  }

  async function listFiles() {
    if (!filesApi) {
      setStatus("Anna files API is unavailable.");
      return;
    }
    setIsBusy(true);
    setStatus("Listing files...");
    try {
      const res = await filesApi.list({ prefix: normalizedPrefix });
      const nextItems = res.items || [];
      setItems(nextItems);
      setRawJson(JSON.stringify({ list: res }, null, 2));
      setStatus(`${nextItems.length} file(s)`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="file-upload-demo-page">
      <div className="guided-page-head">
        <div>
          <span className="step-pill">APS Files</span>
          <h2>文件上传实验</h2>
          <p>通过 Anna Host API 上传到 APS，并验证下载链接和列表读取。</p>
        </div>
        <button type="button" className="secondary-action" onClick={onBack}>
          返回
        </button>
      </div>

      <div className="file-demo-layout">
        <section className="file-demo-main">
          <div className="field-stack">
            <label htmlFor="file-demo-path">Object path</label>
            <input
              id="file-demo-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={DEFAULT_PATH}
            />
          </div>
          <div className="file-demo-grid">
            <div className="field-stack">
              <label htmlFor="file-demo-prefix">List prefix</label>
              <input
                id="file-demo-prefix"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
                placeholder={DEFAULT_PREFIX}
              />
            </div>
            <div className="field-stack">
              <label htmlFor="file-demo-content-type">Content type</label>
              <input
                id="file-demo-content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
                placeholder={DEFAULT_CONTENT_TYPE}
              />
            </div>
          </div>
          <div className="field-stack">
            <label htmlFor="file-demo-content">File content</label>
            <textarea
              id="file-demo-content"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
            />
          </div>
          <div className="file-demo-actions">
            <button type="button" className="primary-action" onClick={upload} disabled={isBusy || !filesApi}>
              上传
            </button>
            <button type="button" className="secondary-action" onClick={getDownloadUrl} disabled={isBusy || !filesApi}>
              获取链接
            </button>
            <button type="button" className="secondary-action" onClick={listFiles} disabled={isBusy || !filesApi}>
              刷新列表
            </button>
          </div>
        </section>

        <aside className="file-demo-side">
          <div className="file-demo-status" data-error={!filesApi || status.includes("Error") || status.includes("PUT")}>
            {status}
          </div>
          {lastUpload ? (
            <dl className="file-demo-kv">
              <div>
                <dt>Path</dt>
                <dd>{lastUpload.path}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{lastUpload.sizeBytes} B</dd>
              </div>
              <div>
                <dt>ETag</dt>
                <dd>{lastUpload.etag || "-"}</dd>
              </div>
            </dl>
          ) : null}
          {downloadUrl ? (
            <a className="file-demo-link" href={downloadUrl} target="_blank" rel="noreferrer">
              打开下载链接
            </a>
          ) : null}
        </aside>
      </div>

      <section className="file-demo-results">
        <div>
          <h3>Files</h3>
          <div className="file-demo-list">
            {items.length ? (
              items.map((item) => (
                <div className="file-demo-list-row" key={item.path}>
                  <strong>{item.path}</strong>
                  <span>{item.size_bytes != null ? `${item.size_bytes} B` : "-"}</span>
                  <span>{item.content_type || "-"}</span>
                </div>
              ))
            ) : (
              <p className="helper-text">No files loaded.</p>
            )}
          </div>
        </div>
        <div>
          <h3>Raw response</h3>
          <pre className="file-demo-raw">{rawJson || "{}"}</pre>
        </div>
      </section>
    </section>
  );
}
