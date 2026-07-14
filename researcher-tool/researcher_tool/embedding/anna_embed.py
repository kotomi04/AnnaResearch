from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import threading
from typing import Any
import uuid


MAX_PARALLEL_EMBEDDING_BATCHES = 8


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


@dataclass
class EmbeddingBatchOutcome:
    result: dict[str, Any] | None = None
    error: Exception | None = None


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

    def create_batches(
        self,
        *,
        batches: list[list[str]],
        model: str = "anna-managed-v1",
        timeout: float = 30.0,
    ) -> list[dict[str, Any]]:
        outcomes = self.create_batches_settled(batches=batches, model=model, timeout=timeout)
        results: list[dict[str, Any]] = []
        for outcome in outcomes:
            if outcome.error is not None:
                raise outcome.error
            results.append(outcome.result or {})
        return results

    def create_batches_settled(
        self,
        *,
        batches: list[list[str]],
        model: str = "anna-managed-v1",
        timeout: float = 30.0,
    ) -> list[EmbeddingBatchOutcome]:
        prepared_batches = [list(batch) for batch in batches]
        if not prepared_batches:
            return []

        def create_batch(texts: list[str]) -> EmbeddingBatchOutcome:
            try:
                return EmbeddingBatchOutcome(result=self.create(texts=texts, model=model, timeout=timeout))
            except Exception as exc:  # noqa: BLE001 - callers need per-batch failures for checkpointing
                return EmbeddingBatchOutcome(error=exc)

        worker_count = min(MAX_PARALLEL_EMBEDDING_BATCHES, len(prepared_batches))
        with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="embedding") as pool:
            return list(pool.map(create_batch, prepared_batches))

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
