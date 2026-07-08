from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import threading
from typing import Any
import uuid


class SamplingError(Exception):
    def __init__(self, code: int, message: str, data: dict[str, Any] | None = None):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.data = data or {}


@dataclass
class _PendingSampling:
    condition: threading.Condition
    response: dict[str, Any] | None = None
    error: SamplingError | None = None


class AnnaSamplingClient:
    """Minimal Executa reverse-RPC client for Anna-managed LLM sampling."""

    def __init__(self, *, write_frame: Callable[[dict[str, Any]], None]):
        self._write_frame = write_frame
        self._pending: dict[str, _PendingSampling] = {}
        self._lock = threading.Lock()

    def create_message(
        self,
        *,
        messages: list[dict[str, Any]],
        system_prompt: str = "",
        max_tokens: int = 900,
        temperature: float = 0.2,
        metadata: dict[str, Any] | None = None,
        timeout: float = 60.0,
    ) -> dict[str, Any]:
        if not messages:
            raise SamplingError(-32514, "messages must be non-empty")

        req_id = uuid.uuid4().hex
        condition = threading.Condition()
        pending = _PendingSampling(condition=condition)
        with self._lock:
            self._pending[req_id] = pending

        params: dict[str, Any] = {
            "messages": messages,
            "maxTokens": max_tokens,
            "temperature": temperature,
            "includeContext": "none",
            "metadata": metadata or {},
        }
        if system_prompt:
            params["systemPrompt"] = system_prompt
        self._write_frame({"jsonrpc": "2.0", "id": req_id, "method": "sampling/createMessage", "params": params})

        with condition:
            condition.wait_for(lambda: pending.response is not None or pending.error is not None, timeout=timeout)

        if pending.error is not None:
            raise pending.error
        if pending.response is not None:
            return pending.response

        with self._lock:
            self._pending.pop(req_id, None)
        raise SamplingError(-32515, f"sampling/createMessage timed out after {timeout}s")

    def dispatch_response(self, msg: dict[str, Any]) -> bool:
        if not isinstance(msg, dict) or "method" in msg:
            return False
        req_id = msg.get("id")
        if req_id is None:
            return False
        with self._lock:
            pending = self._pending.pop(str(req_id), None)
        if pending is None:
            return False
        error = msg.get("error")
        with pending.condition:
            if error:
                pending.error = SamplingError(
                    int(error.get("code", -32603)),
                    str(error.get("message", "unknown sampling error")),
                    error.get("data") if isinstance(error.get("data"), dict) else {},
                )
            else:
                pending.response = msg.get("result") or {}
            pending.condition.notify()
        return True


def sampling_text(result: dict[str, Any]) -> str:
    content = result.get("content")
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
    if isinstance(result.get("text"), str):
        return str(result.get("text") or "")
    message = result.get("message")
    if isinstance(message, dict):
        msg_content = message.get("content")
        if isinstance(msg_content, str):
            return msg_content
        if isinstance(msg_content, dict) and isinstance(msg_content.get("text"), str):
            return str(msg_content.get("text") or "")
    return ""
