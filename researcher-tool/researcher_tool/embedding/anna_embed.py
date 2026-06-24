from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import threading
from typing import Any
import uuid


class EmbeddingsError(Exception):
    def __init__(self, code: int, message: str, data: dict[str, Any] | None = None):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.data = data or {}


@dataclass
class _PendingEmbedding:
    condition: threading.Condition
    response: dict[str, Any] | None = None
    error: EmbeddingsError | None = None


class AnnaEmbeddingsClient:
    """Minimal Executa reverse-RPC client for host-managed embeddings."""

    def __init__(self, *, write_frame: Callable[[dict[str, Any]], None]):
        self._write_frame = write_frame
        self._pending: dict[str, _PendingEmbedding] = {}
        self._lock = threading.Lock()

    def create(self, *, texts: list[str], model: str = "anna-managed-v1", timeout: float = 30.0) -> dict[str, Any]:
        inputs = [str(text) for text in texts if str(text or "").strip()]
        if not inputs:
            raise EmbeddingsError(-32504, "texts must be non-empty")

        req_id = uuid.uuid4().hex
        condition = threading.Condition()
        pending = _PendingEmbedding(condition=condition)
        with self._lock:
            self._pending[req_id] = pending

        params: dict[str, Any] = {"input": inputs}
        if model:
            params["model"] = model
        self._write_frame({"jsonrpc": "2.0", "id": req_id, "method": "embeddings/create", "params": params})

        with condition:
            condition.wait_for(lambda: pending.response is not None or pending.error is not None, timeout=timeout)

        if pending.error is not None:
            raise pending.error
        if pending.response is not None:
            return pending.response

        with self._lock:
            self._pending.pop(req_id, None)
        raise EmbeddingsError(-32505, f"embeddings/create timed out after {timeout}s")

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
                pending.error = EmbeddingsError(
                    int(error.get("code", -32603)),
                    str(error.get("message", "unknown embeddings error")),
                    error.get("data") if isinstance(error.get("data"), dict) else {},
                )
            else:
                pending.response = msg.get("result") or {}
            pending.condition.notify()
        return True


def embed_texts(args: dict[str, Any], *, embeddings: AnnaEmbeddingsClient) -> dict[str, Any]:
    raw_texts = args.get("texts") or args.get("input") or []
    texts = [raw_texts] if isinstance(raw_texts, str) else list(raw_texts)
    model = str(args.get("model") or "anna-managed-v1")
    timeout = float(args.get("timeout") or 30.0)
    vectors: list[list[Any]] = []
    usage: Any = None
    meta: dict[str, Any] = {}
    for text in texts:
        clean = str(text or "").strip()
        if not clean:
            continue
        result = embeddings.create(texts=[clean], model=model, timeout=timeout)
        data = result.get("data") or []
        for item in data:
            if isinstance(item, dict) and isinstance(item.get("embedding"), list):
                vectors.append(item.get("embedding"))
                break
        usage = result.get("usage") or usage
        if isinstance(result.get("_meta"), dict):
            meta = result.get("_meta") or meta
    first = vectors[0] if vectors else []
    return {
        "count": len(vectors),
        "dimensions": meta.get("dimensions") or (len(first) if first else 0),
        "first_vector_preview": first[:8] if isinstance(first, list) else [],
        "model": model,
        "usage": usage,
        "_meta": {
            "latencyMs": meta.get("latencyMs"),
            "costUsd": meta.get("costUsd"),
            "backendModel": meta.get("backendModel"),
            "provider": meta.get("provider"),
        },
    }
