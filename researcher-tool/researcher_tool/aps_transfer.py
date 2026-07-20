from __future__ import annotations

import hashlib
import json
import re
import threading
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .errors import ValidationError


MAX_TRANSFER_BYTES = 32 * 1024 * 1024
TRANSFER_CONTENT_TYPE = "application/json"
_SAFE_PART_RE = re.compile(r"[^A-Za-z0-9._-]+")


class ApsFilesError(Exception):
    def __init__(self, code: int, message: str, data: dict[str, Any] | None = None):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.data = data or {}


@dataclass
class _PendingFilesCall:
    condition: threading.Condition
    response: dict[str, Any] | None = None
    error: ApsFilesError | None = None


class AnnaApsFilesClient:
    """Synchronous Executa reverse-RPC client for APS Files."""

    def __init__(self, *, write_frame: Callable[[dict[str, Any]], None]):
        self._write_frame = write_frame
        self._pending: dict[str, _PendingFilesCall] = {}
        self._lock = threading.Lock()

    def upload_bytes(self, *, path: str, payload: bytes, content_type: str, timeout: float = 60.0) -> dict[str, Any]:
        info = self._call(
            "files/upload_begin",
            {"path": path, "scope": "app", "size_bytes": len(payload), "content_type": content_type},
            timeout,
        )
        put_url = str(info.get("put_url") or "")
        if not put_url:
            raise ApsFilesError(-32603, "files/upload_begin did not return put_url")
        request = urllib.request.Request(put_url, data=payload, method="PUT", headers=info.get("headers") or {})
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - host-issued presigned URL
            if response.status not in (200, 201):
                raise ApsFilesError(-32603, f"APS upload failed with HTTP {response.status}")
            etag = response.headers.get("ETag") or response.headers.get("etag") or info.get("upload_id") or ""
        completed = self._call(
            "files/upload_complete",
            {
                "path": path,
                "scope": "app",
                "etag": str(etag).replace('"', ""),
                "size_bytes": len(payload),
                "content_type": content_type,
            },
            timeout,
        )
        return {**completed, "etag": completed.get("etag") or str(etag).replace('"', "")}

    def download_bytes(self, *, path: str, timeout: float = 60.0) -> bytes:
        info = self._call(
            "files/download_url",
            {"path": path, "scope": "app", "expires_in": 600, "ttl_seconds": 600},
            timeout,
        )
        get_url = str(info.get("url") or info.get("get_url") or "")
        if not get_url:
            raise ApsFilesError(-32603, "files/download_url did not return a URL")
        with urllib.request.urlopen(get_url, timeout=timeout) as response:  # noqa: S310 - host-issued presigned URL
            payload = response.read(MAX_TRANSFER_BYTES + 1)
        if len(payload) > MAX_TRANSFER_BYTES:
            raise ValidationError("APS transfer payload exceeds 32 MiB")
        return payload

    def delete(self, *, path: str, timeout: float = 30.0) -> None:
        self._call("files/delete", {"path": path, "scope": "app"}, timeout)

    def _call(self, method: str, params: dict[str, Any], timeout: float) -> dict[str, Any]:
        req_id = uuid.uuid4().hex
        condition = threading.Condition()
        pending = _PendingFilesCall(condition=condition)
        with self._lock:
            self._pending[req_id] = pending
        try:
            self._write_frame({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})
        except Exception:
            with self._lock:
                self._pending.pop(req_id, None)
            raise
        with condition:
            condition.wait_for(lambda: pending.response is not None or pending.error is not None, timeout=timeout)
        if pending.error is not None:
            raise pending.error
        if pending.response is not None:
            return pending.response
        with self._lock:
            self._pending.pop(req_id, None)
        raise ApsFilesError(-32603, f"{method} timed out after {timeout}s")

    def dispatch_response(self, msg: dict[str, Any]) -> bool:
        if not isinstance(msg, dict) or "method" in msg or msg.get("id") is None:
            return False
        with self._lock:
            pending = self._pending.pop(str(msg.get("id")), None)
        if pending is None:
            return False
        error = msg.get("error")
        with pending.condition:
            if isinstance(error, dict):
                pending.error = ApsFilesError(
                    int(error.get("code", -32603)),
                    str(error.get("message") or "APS files request failed"),
                    error.get("data") if isinstance(error.get("data"), dict) else {},
                )
            else:
                pending.response = msg.get("result") if isinstance(msg.get("result"), dict) else {}
            pending.condition.notify()
        return True


class ApsJsonTransferStore:
    def __init__(self, files: AnnaApsFilesClient):
        self.files = files

    def upload(self, *, prefix: str, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(data) > MAX_TRANSFER_BYTES:
            raise ValidationError("APS transfer payload exceeds 32 MiB")
        path = f"{prefix.rstrip('/')}/transfers/{_safe_part(kind)}-{uuid.uuid4().hex}.json"
        result = self.files.upload_bytes(path=path, payload=data, content_type=TRANSFER_CONTENT_TYPE)
        return {
            "path": path,
            "content_type": TRANSFER_CONTENT_TYPE,
            "size_bytes": len(data),
            "etag": str(result.get("etag") or ""),
            "sha256": hashlib.sha256(data).hexdigest(),
            "delete_after_read": True,
        }

    def download_json(self, descriptor: Any, *, expected_prefix: str) -> dict[str, Any]:
        transfer = validate_transfer_descriptor(descriptor, expected_prefix=expected_prefix)
        payload = self.files.download_bytes(path=transfer["path"])
        if len(payload) != transfer["size_bytes"]:
            raise ValidationError("APS transfer size mismatch")
        if hashlib.sha256(payload).hexdigest() != transfer["sha256"]:
            raise ValidationError("APS transfer sha256 mismatch")
        try:
            decoded = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValidationError("APS transfer must contain a JSON object") from exc
        if not isinstance(decoded, dict):
            raise ValidationError("APS transfer must contain a JSON object")
        return decoded

    def delete_best_effort(self, descriptor: Any) -> None:
        if not isinstance(descriptor, dict):
            return
        path = str(descriptor.get("path") or "").strip()
        if "/transfers/" not in path:
            return
        try:
            self.files.delete(path=path)
        except Exception:  # noqa: BLE001 - cleanup must not replace the successful operation
            return


def validate_transfer_descriptor(descriptor: Any, *, expected_prefix: str) -> dict[str, Any]:
    if not isinstance(descriptor, dict):
        raise ValidationError("payload_transfer must be an object")
    path = str(descriptor.get("path") or "").strip()
    prefix = expected_prefix.rstrip("/") + "/transfers/"
    if not path.startswith(prefix) or not path.endswith(".json"):
        raise ValidationError("payload_transfer path is outside the expected APS transfer prefix")
    content_type = str(descriptor.get("content_type") or "")
    if content_type != TRANSFER_CONTENT_TYPE:
        raise ValidationError("payload_transfer content_type must be application/json")
    if descriptor.get("delete_after_read") is not True:
        raise ValidationError("payload_transfer delete_after_read must be true")
    try:
        size_bytes = int(descriptor.get("size_bytes"))
    except (TypeError, ValueError) as exc:
        raise ValidationError("payload_transfer size_bytes must be an integer") from exc
    if size_bytes < 0 or size_bytes > MAX_TRANSFER_BYTES:
        raise ValidationError("payload_transfer size_bytes is outside the allowed range")
    sha256 = str(descriptor.get("sha256") or "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValidationError("payload_transfer sha256 is invalid")
    return {**descriptor, "path": path, "size_bytes": size_bytes, "sha256": sha256}


def research_transfer_prefix(research_id: str) -> str:
    return f"research-jobs/{_safe_part(research_id)}"


def source_test_transfer_prefix(test_id: str) -> str:
    return f"research-source-tests/{_safe_part(test_id)}"


def _safe_part(value: str) -> str:
    cleaned = _SAFE_PART_RE.sub("-", str(value or "").strip()).strip("-.")
    if not cleaned:
        raise ValidationError("APS transfer path part is empty")
    return cleaned[:160]
