from __future__ import annotations

import json
import re
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import unquote, urlparse

from .errors import NotFoundError, ResearcherToolError, ValidationError
from .job_store import JobStore
from .views import compact_job_view, result_view, section_result_view

RESULT_PATH_RE = re.compile(r"^/research-results/([^/]+)$")
ASSEMBLED_RESULT_PATH_RE = re.compile(r"^/assembled-research-results/([^/]+)$")
CONTEXT_PATH_RE = re.compile(r"^/contexts/([^/]+)$")
SECTION_CONTEXT_PATH_RE = re.compile(r"^/section-contexts/([^/]+)/([^/]+)$")
SECTION_RESULT_PATH_RE = re.compile(r"^/section-results/([^/]+)/([^/]+)$")


class LocalResultTransferServer:
    def __init__(self, jobs: JobStore):
        self.jobs = jobs
        self._lock = threading.Lock()
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def descriptor(self, research_id: str) -> dict[str, str]:
        return self.result_descriptor(research_id)

    def result_descriptor(self, research_id: str, *, method: str = "POST") -> dict[str, str]:
        server = self._ensure_started()
        host, port = server.server_address[:2]
        return {
            "method": method,
            "url": f"http://{host}:{port}/research-results/{research_id}",
            "content_type": "application/json",
        }

    def assembled_result_descriptor(self, research_id: str) -> dict[str, str]:
        server = self._ensure_started()
        host, port = server.server_address[:2]
        return {
            "method": "POST",
            "url": f"http://{host}:{port}/assembled-research-results/{research_id}",
            "content_type": "application/json",
        }

    def context_descriptor(self, research_id: str) -> dict[str, str]:
        server = self._ensure_started()
        host, port = server.server_address[:2]
        return {
            "method": "GET",
            "url": f"http://{host}:{port}/contexts/{research_id}",
            "content_type": "application/json",
        }

    def section_context_descriptor(self, research_id: str, section_id: str) -> dict[str, str]:
        server = self._ensure_started()
        host, port = server.server_address[:2]
        return {
            "method": "GET",
            "url": f"http://{host}:{port}/section-contexts/{research_id}/{section_id}",
            "content_type": "application/json",
        }

    def section_result_descriptor(self, research_id: str, section_id: str) -> dict[str, str]:
        server = self._ensure_started()
        host, port = server.server_address[:2]
        return {
            "method": "POST",
            "url": f"http://{host}:{port}/section-results/{research_id}/{section_id}",
            "content_type": "application/json",
        }

    def _ensure_started(self) -> ThreadingHTTPServer:
        with self._lock:
            if self._server is not None:
                return self._server
            handler = self._make_handler()
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, name="anna-researcher-result-transfer", daemon=True)
            thread.start()
            self._server = server
            self._thread = thread
            return server

    def _make_handler(self):
        jobs = self.jobs

        class ResultTransferHandler(BaseHTTPRequestHandler):
            server_version = "AnnaResearcherResultTransfer/0.1"

            def do_OPTIONS(self) -> None:  # noqa: N802
                route = self._route()
                if not route:
                    self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "message": "Not found"})
                    return
                self.send_response(HTTPStatus.NO_CONTENT)
                self._send_cors_headers()
                self.end_headers()

            def do_POST(self) -> None:  # noqa: N802
                route = self._route()
                if not route:
                    self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "message": "Not found"})
                    return
                try:
                    body = self._read_json_body()
                    if route["kind"] == "result":
                        result = save_http_result(jobs, route["research_id"], body)
                    elif route["kind"] == "assembled_result":
                        result = save_http_assembled_result(jobs, route["research_id"], body)
                    elif route["kind"] == "section_result":
                        result = save_http_section_result(jobs, route["research_id"], route["section_id"], body)
                    else:
                        self._method_not_allowed()
                        return
                    self._send_json(HTTPStatus.OK, result)
                except NotFoundError as exc:
                    self._send_json(HTTPStatus.NOT_FOUND, error_body(exc))
                except (ValidationError, ValueError) as exc:
                    message = exc.message if isinstance(exc, ValidationError) else str(exc)
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "validation_error", "message": message})
                except ResearcherToolError as exc:
                    self._send_json(HTTPStatus.BAD_REQUEST, error_body(exc))
                except Exception as exc:  # noqa: BLE001
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal_error", "message": f"{type(exc).__name__}: {exc}"})

            def do_GET(self) -> None:  # noqa: N802
                route = self._route()
                if not route:
                    self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "message": "Not found"})
                    return
                try:
                    if route["kind"] == "result":
                        result = get_http_result(jobs, route["research_id"])
                    elif route["kind"] == "context":
                        result = get_http_context(jobs, route["research_id"])
                    elif route["kind"] == "section_context":
                        result = get_http_section_context(jobs, route["research_id"], route["section_id"])
                    else:
                        self._method_not_allowed()
                        return
                    self._send_json(HTTPStatus.OK, result)
                except NotFoundError as exc:
                    self._send_json(HTTPStatus.NOT_FOUND, error_body(exc))
                except (ValidationError, ValueError) as exc:
                    message = exc.message if isinstance(exc, ValidationError) else str(exc)
                    self._send_json(HTTPStatus.BAD_REQUEST, {"error": "validation_error", "message": message})
                except ResearcherToolError as exc:
                    self._send_json(HTTPStatus.BAD_REQUEST, error_body(exc))
                except Exception as exc:  # noqa: BLE001
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal_error", "message": f"{type(exc).__name__}: {exc}"})

            def do_PUT(self) -> None:  # noqa: N802
                self._method_not_allowed()

            def do_DELETE(self) -> None:  # noqa: N802
                self._method_not_allowed()

            def log_message(self, _format: str, *_args: Any) -> None:
                return

            def _method_not_allowed(self) -> None:
                if not self._route():
                    self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "message": "Not found"})
                    return
                self._send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method_not_allowed", "message": "Method not allowed"})

            def _route(self) -> dict[str, str] | None:
                path = urlparse(self.path).path
                for kind, pattern in (
                    ("assembled_result", ASSEMBLED_RESULT_PATH_RE),
                    ("result", RESULT_PATH_RE),
                    ("context", CONTEXT_PATH_RE),
                ):
                    match = pattern.match(path)
                    if match:
                        return {"kind": kind, "research_id": unquote(match.group(1)).strip()}
                match = SECTION_CONTEXT_PATH_RE.match(path)
                if match:
                    return {
                        "kind": "section_context",
                        "research_id": unquote(match.group(1)).strip(),
                        "section_id": unquote(match.group(2)).strip(),
                    }
                match = SECTION_RESULT_PATH_RE.match(path)
                if match:
                    return {
                        "kind": "section_result",
                        "research_id": unquote(match.group(1)).strip(),
                        "section_id": unquote(match.group(2)).strip(),
                    }
                return None

            def _read_json_body(self) -> dict[str, Any]:
                raw_length = self.headers.get("Content-Length") or "0"
                try:
                    length = int(raw_length)
                except ValueError as exc:
                    raise ValueError("invalid Content-Length") from exc
                raw = self.rfile.read(max(length, 0))
                try:
                    body = json.loads(raw.decode("utf-8") or "{}")
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ValueError("request body must be valid JSON") from exc
                if not isinstance(body, dict):
                    raise ValueError("request body must be a JSON object")
                return body

            def _send_json(self, status: int, payload: dict[str, Any]) -> None:
                data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(data)

            def _send_cors_headers(self) -> None:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Private-Network", "true")

        return ResultTransferHandler


def save_http_result(jobs: JobStore, research_id: str, body: dict[str, Any]) -> dict[str, Any]:
    existing = jobs.load(research_id)
    report = str(body.get("report_markdown") or "")
    if not report.strip():
        raise ValidationError("report_markdown is required for a completed result")
    result = {
        "report_markdown": report,
        "source_urls": body.get("source_urls") or existing.get("source_urls") or [],
        "status": "completed",
        "stage": "completed",
        "progress": 100,
        "error": None,
    }
    job = jobs.save_result(research_id, result)
    return {"job": compact_job_view(job), "result": compact_result_view(job)}


def save_http_assembled_result(jobs: JobStore, research_id: str, body: dict[str, Any]) -> dict[str, Any]:
    existing = jobs.load(research_id)
    report = str(body.get("report_markdown") or "")
    if not report.strip():
        raise ValidationError("report_markdown is required for a completed assembled result")
    result = {
        "report_markdown": report,
        "source_urls": body.get("source_urls") or existing.get("source_urls") or [],
        "status": "completed",
        "stage": "completed",
        "progress": 100,
        "error": None,
    }
    job = jobs.save_assembled_result(research_id, result)
    return {"job": compact_job_view(job), "result": compact_result_view(job)}


def save_http_section_result(jobs: JobStore, research_id: str, section_id: str, body: dict[str, Any]) -> dict[str, Any]:
    status = str(body.get("status") or "completed")
    markdown = str(body.get("section_markdown") or "")
    if status == "completed" and not markdown.strip():
        raise ValidationError("section_markdown is required for a completed section result")
    result = {
        "status": status,
        "section_markdown": markdown,
        "section_summary": body.get("section_summary"),
        "source_urls": body.get("source_urls") or [],
        "error": body.get("error"),
    }
    job = jobs.save_section_result(research_id, section_id, result)
    section = (job.get("section_results") or {}).get(section_id) or {}
    return {"job": compact_job_view(job), "section_result": section_result_view(section, include_markdown=True)}


def get_http_result(jobs: JobStore, research_id: str) -> dict[str, Any]:
    job = jobs.load(research_id)
    if not job.get("report_markdown"):
        raise NotFoundError(f"research result not found: {research_id}")
    return {"job": compact_job_view(job), "result": compact_result_view(job)}


def get_http_context(jobs: JobStore, research_id: str) -> dict[str, Any]:
    job = jobs.load(research_id)
    return {
        "selected_context": job.get("selected_context") or "",
        "selected_sources": job.get("selected_sources") or [],
        "source_urls": job.get("source_urls") or [],
    }


def get_http_section_context(jobs: JobStore, research_id: str, section_id: str) -> dict[str, Any]:
    job = jobs.load(research_id)
    context = (job.get("section_selected_context") or {}).get(section_id)
    if not isinstance(context, dict):
        raise NotFoundError(f"section context not found: {section_id}")
    return {
        "selected_context": context.get("selected_context") or "",
        "selected_sources": context.get("selected_sources") or [],
        "source_urls": context.get("source_urls") or [],
        "selected_at": context.get("selected_at"),
    }


def compact_result_view(job: dict[str, Any]) -> dict[str, Any]:
    return result_view(job, include_sources=False)


def error_body(exc: ResearcherToolError) -> dict[str, Any]:
    return {"error": exc.code, "message": exc.message, "data": exc.data}
