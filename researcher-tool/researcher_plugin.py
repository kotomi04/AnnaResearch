#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import threading
from datetime import datetime, timezone
from typing import Any

from researcher_tool.dispatcher import AppDispatcher
from researcher_tool.errors import ResearcherToolError, ValidationError

TOOL_ID = "tool-test-researcher-12345678"
VERSION = "0.2.0"
APP_METHODS = [
    "app_get_settings",
    "app_update_settings",
    "app_create_research_job",
    "app_update_research_job",
    "app_save_confirmed_research_role",
    "app_save_confirmed_research_focuses",
    "app_save_confirmed_research_outline",
    "app_get_research_job",
    "app_list_research_sources",
    "app_update_research_source_credential",
    "app_set_research_source_enabled",
    "app_upsert_research_source",
    "app_delete_research_source",
    "app_test_research_source",
    "app_call_research_source",
    "app_call_section_research_source",
    "app_select_context",
    "app_select_section_context",
    "app_save_section_result",
    "app_fail_section",
    "app_save_report_framing",
    "app_save_assembled_research_result",
    "app_save_research_result",
]

MANIFEST: dict[str, Any] = {
    "name": TOOL_ID,
    "display_name": "Anna Researcher",
    "version": VERSION,
    "description": "Standalone backend tool for the Anna Researcher app.",
    "author": "Anna Research",
    "tools": [
        {
            "name": method,
            "description": f"Anna Researcher app method: {method}.",
            "parameters": [{"name": "payload", "type": "object", "description": "App method arguments.", "required": False}],
        }
        for method in APP_METHODS
    ],
    "runtime": {"type": "uv", "min_version": "0.1.0"},
}

_stdout_lock = threading.Lock()
dispatcher = AppDispatcher()


def write_frame(msg: dict[str, Any]) -> None:
    payload = json.dumps(msg, ensure_ascii=False)
    with _stdout_lock:
        sys.stdout.write(payload + "\n")
        sys.stdout.flush()


def make_response(req_id: Any, *, result: Any = None, error: dict[str, Any] | None = None) -> dict[str, Any]:
    response = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        response["error"] = error
    else:
        response["result"] = result
    return response


def handle_initialize(req_id: Any, params: dict[str, Any]) -> dict[str, Any]:
    proto = (params or {}).get("protocolVersion") or "1.1"
    negotiated = "2.0" if proto == "2.0" else "1.1"
    return make_response(
        req_id,
        result={
            "protocolVersion": negotiated,
            "serverInfo": {"name": TOOL_ID, "version": VERSION},
            "client_capabilities": {},
            "capabilities": {},
        },
    )


def handle_invoke(req_id: Any, params: dict[str, Any]) -> dict[str, Any]:
    tool = str(params.get("tool") or "")
    args = params.get("arguments") or {}
    if tool not in APP_METHODS:
        return make_response(req_id, error={"code": -32601, "message": f"unknown tool: {tool}"})
    if not isinstance(args, dict):
        return make_response(req_id, error={"code": -32602, "message": "`arguments` must be an object"})
    try:
        data = dispatcher.dispatch(tool, args)
        return make_response(req_id, result={"success": True, "tool": tool, "data": data})
    except ResearcherToolError as exc:
        return make_response(req_id, result={"success": False, "tool": tool, "error": exc.message, "data": {"code": exc.code, **exc.data}})
    except Exception as exc:  # noqa: BLE001
        return make_response(req_id, result={"success": False, "tool": tool, "error": f"{type(exc).__name__}: {exc}", "data": {"code": "internal_error"}})


def handle_message(line: str) -> None:
    try:
        msg = json.loads(line)
    except json.JSONDecodeError as exc:
        write_frame(make_response(None, error={"code": -32700, "message": f"parse error: {exc}"}))
        return

    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") or {}
    if method == "initialize":
        write_frame(handle_initialize(req_id, params))
    elif method == "describe":
        write_frame(make_response(req_id, result=MANIFEST))
    elif method == "health":
        write_frame(make_response(req_id, result={"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat(), "version": VERSION, "tools_count": len(APP_METHODS)}))
    elif method == "invoke":
        write_frame(handle_invoke(req_id, params))
    elif method == "shutdown":
        write_frame(make_response(req_id, result={"ok": True}))
    else:
        write_frame(make_response(req_id, error={"code": -32601, "message": f"method not found: {method}"}))


def main() -> None:
    print(f"[anna-researcher] {TOOL_ID} v{VERSION} ready", file=sys.stderr)
    for line in sys.stdin:
        line = line.strip()
        if line:
            handle_message(line)


if __name__ == "__main__":
    main()
