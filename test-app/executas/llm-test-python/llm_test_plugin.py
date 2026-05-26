#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable

TOOL_ID = "tool-test-llm-sampling-12345678"
VERSION = "0.1.0"
PROTOCOL_VERSION_V2 = "2.0"
SAMPLING_TIMEOUT_SECONDS = 30.0
AGENT_TIMEOUT_SECONDS = 180.0
TOOL_COMPLETE = "complete"
TOOL_AGENT_SESSION = "agent_session"

MANIFEST: dict[str, Any] = {
    "name": TOOL_ID,
    "display_name": "LLM / Agent Test",
    "version": VERSION,
    "description": "Minimal tool that asks Anna host to complete text through sampling/createMessage and agent/session.*.",
    "author": "Anna Research",
    "host_capabilities": ["llm.sample", "llm.agent.auto"],
    "tools": [
        {
            "name": TOOL_COMPLETE,
            "description": "Complete the supplied prompt with Anna LLM sampling.",
            "parameters": [
                {"name": "prompt", "type": "string", "description": "Prompt to send to Anna LLM", "required": True}
            ],
        },
        {
            "name": TOOL_AGENT_SESSION,
            "description": "Create an Anna Agent session, run one turn, and delete the session.",
            "parameters": [
                {"name": "prompt", "type": "string", "description": "Prompt to send to Anna Agent", "required": True}
            ],
        }
    ],
    "runtime": {"type": "uv", "min_version": "0.1.0"},
}

_stdout_lock = threading.Lock()


def log(message: str) -> None:
    print(f"[llm-agent-test] {datetime.now(timezone.utc).isoformat()} {message}", file=sys.stderr, flush=True)


def write_frame(msg: dict[str, Any]) -> None:
    payload = json.dumps(msg, ensure_ascii=False)
    with _stdout_lock:
        sys.stdout.write(payload + "\n")
        sys.stdout.flush()


class SamplingError(Exception):
    def __init__(self, message: str, *, code: int | str = "sampling_error", data: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.data = data or {}


class SamplingClient:
    def __init__(self, *, write: Callable[[dict[str, Any]], None]):
        self.write = write
        self.disabled_reason: str | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def disable(self, reason: str) -> None:
        self.disabled_reason = reason

    async def create_message(
        self,
        *,
        messages: list[dict[str, Any]],
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float | None = None,
        metadata: dict[str, Any] | None = None,
        timeout: float = SAMPLING_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        if self.disabled_reason:
            raise SamplingError(self.disabled_reason, code="sampling_disabled")

        loop = asyncio.get_running_loop()
        self._loop = loop
        req_id = uuid.uuid4().hex
        future = loop.create_future()
        with self._lock:
            self._pending[req_id] = future

        params: dict[str, Any] = {
            "messages": messages,
            "maxTokens": max_tokens,
            "includeContext": "none",
        }
        if system_prompt is not None:
            params["systemPrompt"] = system_prompt
        if temperature is not None:
            params["temperature"] = temperature
        if metadata:
            params["metadata"] = metadata

        log(
            "sampling/createMessage send "
            f"id={req_id} maxTokens={max_tokens} timeout={timeout}s "
            f"metadata={json.dumps(metadata or {}, ensure_ascii=False)}"
        )
        self.write({"jsonrpc": "2.0", "id": req_id, "method": "sampling/createMessage", "params": params})

        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            usage = result.get("usage") if isinstance(result, dict) else None
            model = result.get("model") if isinstance(result, dict) else None
            log(f"sampling/createMessage ok id={req_id} model={model!r} usage={usage!r}")
            return result
        except asyncio.TimeoutError as exc:
            with self._lock:
                self._pending.pop(req_id, None)
            log(f"sampling/createMessage timeout id={req_id} after={timeout}s")
            raise SamplingError(f"sampling/createMessage timed out after {timeout}s", code="sampling_timeout") from exc

    def dispatch_response(self, msg: dict[str, Any]) -> bool:
        req_id = msg.get("id")
        with self._lock:
            future = self._pending.pop(req_id, None)
        if future is None:
            log(f"sampling/createMessage unmatched response id={req_id!r}")
            return False
        loop = self._loop
        if loop is None:
            log(f"sampling/createMessage response id={req_id!r} received without event loop")
            return True

        def resolve() -> None:
            if future.done():
                log(f"sampling/createMessage response id={req_id!r} ignored because future is done")
                return
            if "error" in msg:
                error = msg.get("error") or {}
                log(f"sampling/createMessage error id={req_id!r} error={json.dumps(error, ensure_ascii=False)}")
                if isinstance(error, dict):
                    future.set_exception(SamplingError(str(error.get("message") or "sampling failed"), code=error.get("code", "sampling_error"), data=error))
                else:
                    future.set_exception(SamplingError(str(error)))
            else:
                log(f"sampling/createMessage response id={req_id!r} received")
                future.set_result(msg.get("result") or {})

        loop.call_soon_threadsafe(resolve)
        return True


class AgentError(SamplingError):
    pass


class AgentSessionClient:
    def __init__(self, *, write: Callable[[dict[str, Any]], None]):
        self.write = write
        self.disabled_reason: str | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def disable(self, reason: str) -> None:
        self.disabled_reason = reason

    async def call(self, method: str, params: dict[str, Any], *, timeout: float = AGENT_TIMEOUT_SECONDS) -> dict[str, Any]:
        if self.disabled_reason:
            raise AgentError(self.disabled_reason, code="agent_disabled")

        loop = asyncio.get_running_loop()
        self._loop = loop
        req_id = uuid.uuid4().hex
        future = loop.create_future()
        with self._lock:
            self._pending[req_id] = future

        clean_params = {k: v for k, v in params.items() if v is not None}
        log(f"{method} send id={req_id} params={json.dumps(_redact_for_log(clean_params), ensure_ascii=False)}")
        self.write({"jsonrpc": "2.0", "id": req_id, "method": method, "params": clean_params})

        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            log(f"{method} ok id={req_id} keys={list(result.keys()) if isinstance(result, dict) else type(result).__name__}")
            return result
        except asyncio.TimeoutError as exc:
            with self._lock:
                self._pending.pop(req_id, None)
            log(f"{method} timeout id={req_id} after={timeout}s")
            raise AgentError(f"{method} timed out after {timeout}s", code="agent_timeout") from exc

    def dispatch_response(self, msg: dict[str, Any]) -> bool:
        req_id = msg.get("id")
        with self._lock:
            future = self._pending.pop(req_id, None)
        if future is None:
            return False
        loop = self._loop
        if loop is None:
            log(f"agent response id={req_id!r} received without event loop")
            return True

        def resolve() -> None:
            if future.done():
                log(f"agent response id={req_id!r} ignored because future is done")
                return
            if "error" in msg:
                error = msg.get("error") or {}
                log(f"agent error id={req_id!r} error={json.dumps(error, ensure_ascii=False)}")
                if isinstance(error, dict):
                    future.set_exception(AgentError(str(error.get("message") or "agent call failed"), code=error.get("code", "agent_error"), data=error))
                else:
                    future.set_exception(AgentError(str(error)))
            else:
                log(f"agent response id={req_id!r} received")
                future.set_result(msg.get("result") or {})

        loop.call_soon_threadsafe(resolve)
        return True

    async def create(self, *, label: str) -> dict[str, Any]:
        return await self.call(
            "agent/session.create",
            {
                "kind": "agent",
                "agent_submode": "auto",
                "label": label,
                "ttl_seconds": 600,
            },
            timeout=30.0,
        )

    async def run(self, *, app_session_uuid: str, content: str) -> dict[str, Any]:
        return await self.call(
            "agent/session.run",
            {
                "app_session_uuid": app_session_uuid,
                "content": content,
                "recursion_limit": 8,
            },
            timeout=AGENT_TIMEOUT_SECONDS,
        )

    async def delete(self, *, app_session_uuid: str) -> dict[str, Any]:
        return await self.call(
            "agent/session.delete",
            {"app_session_uuid": app_session_uuid},
            timeout=30.0,
        )


sampling = SamplingClient(write=write_frame)
agent = AgentSessionClient(write=write_frame)
_loop = asyncio.new_event_loop()
_loop_thread = threading.Thread(target=_loop.run_forever, daemon=True)
_loop_thread.start()


def _redact_for_log(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: ("<redacted>" if "token" in key.lower() or "credential" in key.lower() else _redact_for_log(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_for_log(item) for item in value]
    return value


def _invoke_context(params: dict[str, Any]) -> dict[str, Any]:
    context = params.get("context")
    if isinstance(context, dict):
        return context
    return {}


def make_response(req_id: Any, *, result: Any = None, error: dict[str, Any] | None = None) -> dict[str, Any]:
    response = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        response["error"] = error
    else:
        response["result"] = result
    return response


def handle_initialize(req_id: Any, params: dict[str, Any]) -> dict[str, Any]:
    proto = (params or {}).get("protocolVersion") or "1.1"
    log(f"initialize protocolVersion={proto!r}")
    if proto != PROTOCOL_VERSION_V2:
        sampling.disable(f"host did not negotiate protocol v2; got {proto!r}")
        agent.disable(f"host did not negotiate protocol v2; got {proto!r}")
    return make_response(
        req_id,
        result={
            "protocolVersion": PROTOCOL_VERSION_V2 if proto == PROTOCOL_VERSION_V2 else "1.1",
            "serverInfo": {"name": TOOL_ID, "version": VERSION},
            "client_capabilities": {"sampling": {}, "agent": {"submodes": ["auto"]}} if proto == PROTOCOL_VERSION_V2 else {},
            "capabilities": {"sampling": {}, "agent": {"submodes": ["auto"]}} if proto == PROTOCOL_VERSION_V2 else {},
        },
    )


def handle_describe(req_id: Any) -> dict[str, Any]:
    log("describe")
    return make_response(req_id, result=MANIFEST)


def handle_health(req_id: Any) -> dict[str, Any]:
    log("health")
    return make_response(
        req_id,
        result={
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": VERSION,
            "tools_count": len(MANIFEST["tools"]),
            "host_capabilities": MANIFEST["host_capabilities"],
        },
    )


async def complete(prompt: str, *, invoke_id: str) -> dict[str, Any]:
    text = str(prompt or "").strip()
    if not text:
        raise ValueError("prompt is required")
    preview = text[:80].replace("\n", "\\n")
    log(f"complete start invoke_id={invoke_id!r} prompt_len={len(text)} prompt_preview={preview!r}")

    result = await sampling.create_message(
        messages=[{"role": "user", "content": {"type": "text", "text": text}}],
        max_tokens=1024,
        system_prompt="You are a helpful assistant. Answer clearly and concisely.",
        temperature=0.2,
        metadata={"executa_invoke_id": invoke_id, "tool": TOOL_COMPLETE},
    )
    content = result.get("content")
    if isinstance(content, dict):
        output = str(content.get("text") or "")
    else:
        output = str(result.get("text") or content or "")
    log(f"complete done invoke_id={invoke_id!r} output_len={len(output)}")
    return {
        "text": output,
        "model": result.get("model"),
        "usage": result.get("usage"),
        "stopReason": result.get("stopReason"),
        "raw": result,
    }


async def run_agent_session(prompt: str, *, invoke_id: str) -> dict[str, Any]:
    text = str(prompt or "").strip()
    if not text:
        raise ValueError("prompt is required")
    preview = text[:80].replace("\n", "\\n")
    log(f"agent_session start invoke_id={invoke_id!r} prompt_len={len(text)} prompt_preview={preview!r}")

    session: dict[str, Any] | None = None
    app_session_uuid = ""
    frames: list[dict[str, Any]] = []
    try:
        session = await agent.create(label=f"llm-agent-test {invoke_id or uuid.uuid4().hex[:8]}")
        app_session_uuid = str(session.get("app_session_uuid") or "")
        if not app_session_uuid:
            raise AgentError("agent/session.create did not return app_session_uuid", code="agent_bad_response", data=session)
        log(
            "agent_session created "
            f"invoke_id={invoke_id!r} app_session_uuid={app_session_uuid!r} "
            f"thread_id={session.get('thread_id')!r} granted_tools={session.get('granted_tools')!r}"
        )

        run_result = await agent.run(app_session_uuid=app_session_uuid, content=text)
        raw_frames = run_result.get("frames") or []
        if isinstance(raw_frames, list):
            frames = [frame for frame in raw_frames if isinstance(frame, dict)]
        output = _text_from_agent_frames(frames, run_result)
        log(
            "agent_session run done "
            f"invoke_id={invoke_id!r} app_session_uuid={app_session_uuid!r} "
            f"frames={len(frames)} output_len={len(output)}"
        )
        return {
            "text": output,
            "app_session_uuid": app_session_uuid,
            "thread_id": session.get("thread_id"),
            "granted_tools": session.get("granted_tools"),
            "run_id": run_result.get("run_id"),
            "stream_id": run_result.get("stream_id"),
            "frames": frames,
            "raw": run_result,
        }
    finally:
        if app_session_uuid:
            try:
                await agent.delete(app_session_uuid=app_session_uuid)
                log(f"agent_session deleted invoke_id={invoke_id!r} app_session_uuid={app_session_uuid!r}")
            except AgentError as exc:
                log(f"agent_session delete failed invoke_id={invoke_id!r} app_session_uuid={app_session_uuid!r} code={exc.code!r} message={exc.message!r}")


def _text_from_agent_frames(frames: list[dict[str, Any]], run_result: dict[str, Any]) -> str:
    chunks: list[str] = []
    final_text = ""
    for frame in frames:
        event = frame.get("event")
        text = frame.get("text")
        if event in ("token", "delta", "message") and isinstance(text, str):
            chunks.append(text)
        elif event in ("complete", "final") and isinstance(text, str) and text:
            final_text = text
    if final_text:
        return final_text
    final = run_result.get("final")
    if isinstance(final, dict) and isinstance(final.get("text"), str):
        return final["text"]
    return "".join(chunks)


def handle_invoke(req_id: Any, params: dict[str, Any]) -> None:
    started = time.monotonic()
    tool = params.get("tool")
    args = params.get("arguments") or {}
    context = _invoke_context(params)
    invoke_id = context.get("invoke_id") or params.get("invoke_id") or ""
    log(
        f"invoke start req_id={req_id!r} tool={tool!r} invoke_id={invoke_id!r} "
        f"context_keys={sorted(context.keys())}"
    )
    if tool not in (TOOL_COMPLETE, TOOL_AGENT_SESSION):
        log(f"invoke reject req_id={req_id!r} reason=unknown_tool")
        write_frame(make_response(req_id, error={"code": -32601, "message": f"unknown tool: {tool}"}))
        return
    if not isinstance(args, dict):
        log(f"invoke reject req_id={req_id!r} reason=bad_arguments")
        write_frame(make_response(req_id, error={"code": -32602, "message": "`arguments` must be an object"}))
        return

    if tool == TOOL_COMPLETE:
        coro = complete(str(args.get("prompt") or ""), invoke_id=invoke_id)
    else:
        coro = run_agent_session(str(args.get("prompt") or ""), invoke_id=invoke_id)

    future = asyncio.run_coroutine_threadsafe(coro, _loop)
    try:
        timeout = AGENT_TIMEOUT_SECONDS + 10 if tool == TOOL_AGENT_SESSION else SAMPLING_TIMEOUT_SECONDS + 10
        data = future.result(timeout=timeout)
        elapsed = time.monotonic() - started
        log(f"invoke ok req_id={req_id!r} elapsed={elapsed:.2f}s")
        write_frame(make_response(req_id, result={"success": True, "tool": tool, "data": data}))
    except SamplingError as exc:
        elapsed = time.monotonic() - started
        log(f"invoke sampling_error req_id={req_id!r} elapsed={elapsed:.2f}s code={exc.code!r} message={exc.message!r}")
        write_frame(make_response(req_id, result={"success": False, "tool": tool, "error": exc.message, "data": {"code": exc.code, **exc.data}}))
    except Exception as exc:  # noqa: BLE001
        elapsed = time.monotonic() - started
        log(f"invoke error req_id={req_id!r} elapsed={elapsed:.2f}s error={type(exc).__name__}: {exc}")
        write_frame(make_response(req_id, result={"success": False, "tool": tool, "error": f"{type(exc).__name__}: {exc}"}))


def handle_message(line: str, pool: ThreadPoolExecutor) -> None:
    try:
        msg = json.loads(line)
    except json.JSONDecodeError as exc:
        write_frame(make_response(None, error={"code": -32700, "message": f"parse error: {exc}"}))
        return

    if "method" not in msg:
        if agent.dispatch_response(msg):
            return
        if not sampling.dispatch_response(msg):
            log(f"unmatched response id={msg.get('id')!r}")
        return

    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") or {}
    if method == "initialize":
        write_frame(handle_initialize(req_id, params))
    elif method == "describe":
        write_frame(handle_describe(req_id))
    elif method == "health":
        write_frame(handle_health(req_id))
    elif method == "invoke":
        pool.submit(handle_invoke, req_id, params)
    elif method == "shutdown":
        write_frame(make_response(req_id, result={"ok": True}))
    else:
        write_frame(make_response(req_id, error={"code": -32601, "message": f"method not found: {method}"}))


def main() -> None:
    log(f"{TOOL_ID} v{VERSION} ready sampling_timeout={SAMPLING_TIMEOUT_SECONDS}s agent_timeout={AGENT_TIMEOUT_SECONDS}s")
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix="invoke") as pool:
        for raw in sys.stdin:
            line = raw.strip()
            if line:
                handle_message(line, pool)
    _loop.call_soon_threadsafe(_loop.stop)


if __name__ == "__main__":
    main()
