from __future__ import annotations

import asyncio
import json
import os
import threading
import uuid
from typing import Any, Callable

from .errors import SamplingFailure

DEFAULT_SAMPLING_TIMEOUT_SECONDS = 30.0


class SamplingClient:
    """Small Executa v2 reverse-RPC sampling client with fake mode."""

    def __init__(self, *, write_frame: Callable[[dict[str, Any]], None] | None = None, fake: bool | None = None):
        self.write_frame = write_frame
        self.fake = fake if fake is not None else os.getenv("ANNA_RESEARCHER_FAKE_SAMPLING") == "1"
        self._pending: dict[str, asyncio.Future] = {}
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self.disabled_reason: str | None = None

    def disable(self, reason: str) -> None:
        self.disabled_reason = reason

    async def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float | None = None,
        metadata: dict[str, Any] | None = None,
        timeout: float = DEFAULT_SAMPLING_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        if self.fake:
            return fake_sampling_response(messages=messages, system_prompt=system_prompt, metadata=metadata)
        if self.disabled_reason:
            raise SamplingFailure(self.disabled_reason)
        if not self.write_frame:
            raise SamplingFailure("sampling writer is not configured")

        loop = asyncio.get_running_loop()
        self._loop = loop
        req_id = uuid.uuid4().hex
        future = loop.create_future()
        with self._lock:
            self._pending[req_id] = future
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "sampling/createMessage",
            "params": {
                "messages": messages,
                "maxTokens": max_tokens,
                "includeContext": "none",
            },
        }
        if system_prompt is not None:
            payload["params"]["systemPrompt"] = system_prompt
        if temperature is not None:
            payload["params"]["temperature"] = temperature
        if metadata:
            payload["params"]["metadata"] = metadata
        self.write_frame(payload)
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError as exc:
            with self._lock:
                self._pending.pop(req_id, None)
            raise SamplingFailure(f"sampling/createMessage timed out after {timeout}s") from exc

    def dispatch_response(self, msg: dict[str, Any]) -> bool:
        if "method" in msg:
            return False
        req_id = msg.get("id")
        with self._lock:
            future = self._pending.pop(req_id, None)
        if future is None:
            return False
        loop = self._loop
        if loop is None:
            return True

        def resolve() -> None:
            if future.done():
                return
            if "error" in msg:
                err = msg["error"] or {}
                future.set_exception(SamplingFailure(str(err.get("message", "sampling failed")), data=err if isinstance(err, dict) else {}))
            else:
                future.set_result(msg.get("result") or {})

        loop.call_soon_threadsafe(resolve)
        return True


def text_from_sampling(result: dict[str, Any]) -> str:
    content = result.get("content")
    if isinstance(content, dict):
        return str(content.get("text") or "")
    if isinstance(content, str):
        return content
    return str(result.get("text") or "")


def fake_sampling_response(*, messages: list[dict[str, Any]], system_prompt: str | None, metadata: dict[str, Any] | None) -> dict[str, Any]:
    text = "\n".join(_message_text(message) for message in messages)
    stage = (metadata or {}).get("stage")
    if stage == "select_role":
        out = {
            "server": "Anna Research Analyst",
            "agent_role_prompt": "You are an objective research assistant who writes structured, source-grounded reports.",
        }
    elif stage == "plan_queries":
        query = (metadata or {}).get("query") or _first_line(text)
        out = {"queries": [query, f"{query} evidence", f"{query} implementation"]}
    elif stage == "write_report":
        query = (metadata or {}).get("query") or "Research topic"
        out = (
            f"# Research Report: {query}\n\n"
            "## Summary\n\n"
            f"This report synthesizes the available source summaries for **{query}**.\n\n"
            "## Key Findings\n\n"
            "- The available evidence highlights practical tradeoffs and implementation concerns.\n"
            "- Source coverage should be reviewed before making high-stakes decisions.\n\n"
            "## References\n\n"
            "See the source list attached to this result."
        )
    else:
        out = {"text": "ok"}
    return {
        "role": "assistant",
        "content": {"type": "text", "text": json.dumps(out, ensure_ascii=False) if isinstance(out, dict) else out},
        "model": "fake-anna-sampling",
        "usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
    }


def _message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, dict):
        return str(content.get("text") or "")
    return str(content or "")


def _first_line(text: str) -> str:
    return (text.strip().splitlines() or ["Research topic"])[0][:120]
