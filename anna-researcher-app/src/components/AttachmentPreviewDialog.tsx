import { useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { MessageKey, MessageParams } from "../i18n/messages";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

export type AttachmentPreviewKind = "pdf" | "image" | "text" | "unsupported";

interface Props {
  kind: AttachmentPreviewKind;
  name: string;
  url: string;
  t(key: MessageKey, params?: MessageParams): string;
  onClose(): void;
}

export function AttachmentPreviewDialog({ kind, name, url, t, onClose }: Props) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="attachment-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attachment-preview-title"
      >
        <header className="attachment-preview-head">
          <div>
            <span>{previewEyebrow(kind, t)}</span>
            <h2 id="attachment-preview-title">{name}</h2>
          </div>
          <button type="button" className="secondary small-button" onClick={onClose} aria-label={t("closeButton")}>
            {t("closeButton")}
          </button>
        </header>
        {kind === "pdf" ? <PdfPreviewContent url={url} t={t} /> : null}
        {kind === "image" ? <ImagePreviewContent url={url} name={name} t={t} /> : null}
        {kind === "text" ? <TextPreviewContent url={url} t={t} /> : null}
        {kind === "unsupported" ? <UnsupportedPreviewContent t={t} /> : null}
      </div>
    </div>
  );
}

function PdfPreviewContent({ url, t }: Pick<Props, "url" | "t">) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.15);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage("");
    setDocument(null);
    setPageNumber(1);
    setPageCount(0);

    let loadingTask: { destroy(): Promise<void>; promise: Promise<PDFDocumentProxy> } | null = null;
    let loadedDocument: PDFDocumentProxy | null = null;
    void import("pdfjs-dist").then(
      (pdfjs) => {
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ url });
        return loadingTask.promise.then(
          (nextDocument) => {
            if (cancelled) {
              destroyPdfDocument(nextDocument);
              return;
            }
            loadedDocument = nextDocument;
            setDocument(nextDocument);
            setPageCount(nextDocument.numPages);
            setStatus("ready");
          },
          (error) => {
            if (cancelled) return;
            setStatus("error");
            setErrorMessage(error instanceof Error ? error.message : String(error));
          },
        );
      },
      (error) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : String(error));
      },
    );

    return () => {
      cancelled = true;
      cancelRenderTask(renderTaskRef.current);
      renderTaskRef.current = null;
      window.setTimeout(() => {
        if (loadedDocument) {
          destroyPdfDocument(loadedDocument);
        } else {
          destroyLoadingTask(loadingTask);
        }
      }, 0);
    };
  }, [url]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) {
      setStatus("error");
      setErrorMessage("Canvas is unavailable.");
      return;
    }

    cancelRenderTask(renderTaskRef.current);
    renderTaskRef.current = null;

    void document.getPage(pageNumber).then(
      (page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);
        const renderTask = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        return renderTask.promise.catch((error) => {
          if (!cancelled && error?.name !== "RenderingCancelledException") {
            setStatus("error");
            setErrorMessage(error instanceof Error ? error.message : String(error));
          }
        });
      },
      (error) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : String(error));
      },
    );

    return () => {
      cancelled = true;
      cancelRenderTask(renderTaskRef.current);
      renderTaskRef.current = null;
    };
  }, [document, pageNumber, scale]);

  return (
    <>
      <div className="attachment-preview-toolbar">
        <button type="button" className="secondary small-button" onClick={() => setPageNumber((current) => Math.max(1, current - 1))} disabled={pageNumber <= 1}>
          {t("attachmentPdfPreviousPage")}
        </button>
        <span>{t("attachmentPdfPageCount", { page: pageNumber, count: pageCount || 1 })}</span>
        <button type="button" className="secondary small-button" onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))} disabled={!pageCount || pageNumber >= pageCount}>
          {t("attachmentPdfNextPage")}
        </button>
        <button type="button" className="secondary small-button" onClick={() => setScale((current) => Math.max(0.7, Number((current - 0.15).toFixed(2))))}>
          -
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" className="secondary small-button" onClick={() => setScale((current) => Math.min(2, Number((current + 0.15).toFixed(2))))}>
          +
        </button>
      </div>
      <div className="attachment-preview-body">
        {status === "loading" ? <p className="attachment-preview-state">{t("attachmentPreviewLoading")}</p> : null}
        {status === "error" ? (
          <p className="attachment-preview-state" data-error="true">
            {t("attachmentPreviewError")}{errorMessage ? ` ${errorMessage}` : ""}
          </p>
        ) : null}
        <canvas ref={canvasRef} className="pdf-preview-canvas" />
      </div>
    </>
  );
}

function ImagePreviewContent({ url, name, t }: Pick<Props, "url" | "name" | "t">) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="attachment-preview-body image-preview-body">
      {failed ? <p className="attachment-preview-state" data-error="true">{t("attachmentPreviewError")}</p> : null}
      <img className="attachment-preview-image" src={url} alt={name} onError={() => setFailed(true)} />
    </div>
  );
}

function TextPreviewContent({ url, t }: Pick<Props, "url" | "t">) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setStatus("loading");
    setText("");
    setErrorMessage("");
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const nextText = await response.text();
        if (cancelled) return;
        setText(nextText);
        setStatus("ready");
      })
      .catch((error) => {
        if (cancelled || error?.name === "AbortError") return;
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);

  return (
    <div className="attachment-preview-body text-preview-body">
      {status === "loading" ? <p className="attachment-preview-state">{t("attachmentPreviewLoading")}</p> : null}
      {status === "error" ? (
        <p className="attachment-preview-state" data-error="true">
          {t("attachmentPreviewError")}{errorMessage ? ` ${errorMessage}` : ""}
        </p>
      ) : null}
      {status === "ready" ? <pre className="attachment-preview-text">{text}</pre> : null}
    </div>
  );
}

function UnsupportedPreviewContent({ t }: Pick<Props, "t">) {
  return (
    <div className="attachment-preview-body unsupported-preview-body">
      <p className="attachment-preview-state">{t("attachmentPreviewUnsupported")}</p>
    </div>
  );
}

function previewEyebrow(kind: AttachmentPreviewKind, t: Props["t"]): string {
  if (kind === "pdf") return t("attachmentPdfPreviewEyebrow");
  if (kind === "image") return t("attachmentImagePreviewEyebrow");
  if (kind === "unsupported") return t("attachmentPreviewEyebrow");
  return t("attachmentTextPreviewEyebrow");
}

function cancelRenderTask(task: RenderTask | null): void {
  if (!task) return;
  try {
    task.cancel();
  } catch {
    // PDF.js may already have cancelled or destroyed the render transport.
  }
}

function destroyPdfDocument(document: PDFDocumentProxy | null | unknown): void {
  if (!document || typeof document !== "object") return;
  const maybeDestroy = (document as { destroy?: unknown }).destroy;
  if (typeof maybeDestroy !== "function") return;
  try {
    const result = maybeDestroy.call(document);
    if (result && typeof (result as Promise<void>).catch === "function") {
      void (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Cleanup must not be able to tear down the React tree.
  }
}

function destroyLoadingTask(task: { destroy?: unknown } | null): void {
  if (!task || typeof task.destroy !== "function") return;
  try {
    const result = task.destroy();
    if (result && typeof (result as Promise<void>).catch === "function") {
      void (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Cleanup must not be able to tear down the React tree.
  }
}
