from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .errors import ValidationError

MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
CHUNK_TOKENS = 800
CHUNK_OVERLAP_TOKENS = 125
CHUNK_TOKEN_SAFETY_MARGIN = 75
MIN_CHUNK_TOKENS = 120

TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".csv", ".tsv", ".json"}
TEXT_CONTENT_TYPES = {
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/tab-separated-values",
    "application/json",
}


def prepare_attachments(
    *,
    research_id: str,
    job_dir: Path,
    attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    if not isinstance(attachments, list):
        raise ValidationError("attachments must be an array")
    files_dir = job_dir / "attachment-files"
    files_dir.mkdir(parents=True, exist_ok=True)

    context_files: list[dict[str, Any]] = []
    chunks: list[dict[str, Any]] = []
    for index, attachment in enumerate(attachments, start=1):
        if not isinstance(attachment, dict):
            context_files.append(_failed_file(index, {}, "attachment must be an object"))
            continue
        file_id = f"file-{index}"
        name = str(attachment.get("name") or Path(str(attachment.get("path") or f"attachment-{index}")).name).strip()
        path = str(attachment.get("path") or "").strip()
        content_type = str(attachment.get("content_type") or "").strip()
        size_bytes = _optional_int(attachment.get("size_bytes"))
        file_view = {
            "id": file_id,
            "name": name or f"attachment-{index}",
            "path": path,
            "content_type": content_type,
            "size_bytes": size_bytes,
        }
        try:
            download_url = str(attachment.get("download_url") or "").strip()
            if not download_url:
                raise ValidationError("download_url is required")
            local_path = files_dir / f"{file_id}-{_safe_filename(name or 'attachment')}"
            download_attachment(download_url, local_path)
            text = extract_text(local_path, name=name, content_type=content_type)
            text = _clean_text(text)
            file_chunks = chunk_text(text)
            for chunk_index, chunk in enumerate(file_chunks, start=1):
                chunks.append(
                    {
                        "chunk_id": f"{file_id}:{chunk_index:04d}",
                        "file_id": file_id,
                        "file_name": file_view["name"],
                        "index": chunk_index,
                        "text": chunk,
                    }
                )
            context_files.append(
                {
                    **file_view,
                    "text_chars": len(text),
                    "chunk_count": len(file_chunks),
                    "status": "ready",
                    "error": None,
                }
            )
        except Exception as exc:  # noqa: BLE001
            context_files.append({**file_view, "text_chars": 0, "chunk_count": 0, "status": "failed", "error": str(exc)})

    return {
        "version": 1,
        "research_id": research_id,
        "prepared_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "files": context_files,
        "chunks": chunks,
        "summary": build_attachment_summary(context_files, chunks),
    }


def download_attachment(url: str, destination: Path) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https", "data"}:
        raise ValidationError("unsupported attachment download URL scheme")
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with urllib.request.urlopen(url, timeout=30) as response, destination.open("wb") as output:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    raise ValidationError("attachment exceeds the 25 MB download limit")
                output.write(chunk)
    except urllib.error.URLError as exc:
        raise ValidationError(f"attachment download failed: {exc}") from exc


def extract_text(path: Path, *, name: str, content_type: str = "") -> str:
    suffix = Path(name or path.name).suffix.lower() or path.suffix.lower()
    normalized_type = content_type.split(";")[0].strip().lower()
    if suffix in TEXT_EXTENSIONS or normalized_type in TEXT_CONTENT_TYPES or normalized_type.startswith("text/"):
        return _read_text(path)
    if suffix == ".pdf" or normalized_type == "application/pdf":
        return _extract_pdf_text(path)
    raise ValidationError(f"unsupported attachment type: {content_type or suffix or 'unknown'}")


def chunk_text(text: str) -> list[str]:
    clean = text.strip()
    if not clean:
        raise ValidationError("attachment did not contain extractable text")
    blocks = _split_structural_blocks(clean)
    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0
    previous_tail = ""

    for block in blocks:
        block_tokens = estimate_tokens(block)
        if block_tokens > CHUNK_TOKENS:
            if current:
                chunks.append("\n\n".join(current).strip())
                previous_tail = _chunk_tail(chunks[-1])
                current = []
                current_tokens = 0
            for piece in _split_long_block(block):
                if previous_tail:
                    piece = f"{previous_tail}\n\n{piece}"
                chunks.append(piece.strip())
                previous_tail = _chunk_tail(chunks[-1])
            continue

        if current and current_tokens + block_tokens > CHUNK_TOKENS:
            chunks.append("\n\n".join(current).strip())
            previous_tail = _chunk_tail(chunks[-1])
            if previous_tail and estimate_tokens(previous_tail) + block_tokens <= CHUNK_TOKENS:
                current = [previous_tail, block]
            else:
                current = [block]
            current_tokens = estimate_tokens("\n\n".join(current))
            continue

        current.append(block)
        current_tokens += block_tokens

    if current:
        chunks.append("\n\n".join(current).strip())

    return _merge_short_chunks([chunk for chunk in chunks if chunk.strip()])


def build_attachment_summary(files: list[dict[str, Any]], chunks: list[dict[str, Any]]) -> str:
    ready = [file for file in files if file.get("status") == "ready"]
    failed = [file for file in files if file.get("status") == "failed"]
    parts = [
        f"{len(ready)} uploaded file(s) prepared into {len(chunks)} text chunk(s).",
    ]
    if ready:
        parts.append(
            "Ready files: "
            + "; ".join(
                f"{file.get('name')} ({int(file.get('text_chars') or 0)} chars, {int(file.get('chunk_count') or 0)} chunks)"
                for file in ready[:8]
            )
        )
    if failed:
        parts.append("Failed files: " + "; ".join(f"{file.get('name')}: {file.get('error')}" for file in failed[:5]))
    preview = "\n\n".join(str(chunk.get("text") or "")[:500] for chunk in chunks[:3]).strip()
    if preview:
        parts.append("Preview:\n" + preview)
    return "\n".join(parts)


def _read_text(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = data.decode("utf-8", errors="replace")
    if path.suffix.lower() == ".json":
        try:
            parsed = json.loads(text)
            return json.dumps(parsed, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            return text
    return text


def _extract_pdf_text(path: Path) -> str:
    try:
        import fitz  # type: ignore[import-not-found]
    except Exception as exc:  # noqa: BLE001
        raise ValidationError("PDF attachment parsing requires PyMuPDF/fitz") from exc
    pages: list[str] = []
    with fitz.open(path) as doc:
        for page in doc:
            pages.append(page.get_text("text"))
    return "\n\n".join(pages)


def _clean_text(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n").replace("\r", "\n")).strip()


def _split_structural_blocks(text: str) -> list[str]:
    blocks: list[str] = []
    current_heading = ""
    for raw in re.split(r"\n\s*\n", text):
        block = raw.strip()
        if not block:
            continue
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) == 1 and _looks_like_heading(lines[0]):
            if current_heading:
                blocks.append(current_heading)
            current_heading = lines[0]
            continue
        if current_heading:
            block = f"{current_heading}\n{block}"
            current_heading = ""
        blocks.append(block)
    if current_heading:
        blocks.append(current_heading)
    return blocks or [text]


def _looks_like_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if stripped.startswith(("#", "##", "###", "####")):
        return True
    if re.match(r"^(\d+(\.\d+)*[.)]?|[一二三四五六七八九十]+[、.．])\s*\S+", stripped):
        return True
    if len(stripped) <= 80 and not re.search(r"[。.!?！？；;]$", stripped):
        return True
    return False


def estimate_tokens(text: str) -> int:
    """Approximate mixed Chinese/English token count without adding tokenizer deps."""
    cjk = re.findall(r"[\u3400-\u9fff]", text)
    words = re.findall(r"[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*", text)
    punctuation = re.findall(r"[^\s\w\u3400-\u9fff]", text)
    return max(1, len(cjk) + len(words) + max(0, len(punctuation) // 4))


def _split_long_block(block: str) -> list[str]:
    units = _sentence_units(block)
    pieces: list[str] = []
    current: list[str] = []
    current_tokens = 0
    target_tokens = max(1, CHUNK_TOKENS - CHUNK_OVERLAP_TOKENS - CHUNK_TOKEN_SAFETY_MARGIN)
    for unit in units:
        unit_tokens = estimate_tokens(unit)
        if unit_tokens > target_tokens:
            if current:
                pieces.append("".join(current).strip())
                current = []
                current_tokens = 0
            pieces.extend(_split_oversized_unit(unit))
            continue
        if current and current_tokens + unit_tokens > target_tokens:
            pieces.append("".join(current).strip())
            current = []
            current_tokens = 0
        current.append(unit)
        current_tokens += unit_tokens
    if current:
        pieces.append("".join(current).strip())
    return [piece for piece in pieces if piece]


def _sentence_units(text: str) -> list[str]:
    units = re.findall(r".+?(?:[。！？.!?](?:\s+|$)|\n+|$)", text, flags=re.S)
    return [unit for unit in units if unit.strip()]


def _split_oversized_unit(text: str) -> list[str]:
    tokens = re.findall(r"[\u3400-\u9fff]|[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*|\S", text)
    pieces: list[str] = []
    start = 0
    target_tokens = max(1, CHUNK_TOKENS - CHUNK_OVERLAP_TOKENS - CHUNK_TOKEN_SAFETY_MARGIN)
    while start < len(tokens):
        end = min(len(tokens), start + target_tokens)
        piece = _join_tokenish(tokens[start:end]).strip()
        if piece:
            pieces.append(piece)
        if end >= len(tokens):
            break
        start = max(end - CHUNK_OVERLAP_TOKENS, start + 1)
    return pieces


def _join_tokenish(tokens: list[str]) -> str:
    text = ""
    for token in tokens:
        if not text:
            text = token
        elif re.match(r"^[A-Za-z0-9]", token) and re.search(r"[A-Za-z0-9]$", text):
            text += " " + token
        else:
            text += token
    return text


def _chunk_tail(text: str) -> str:
    units = _sentence_units(text)
    tail: list[str] = []
    total = 0
    for unit in reversed(units):
        unit_tokens = estimate_tokens(unit)
        if tail and total + unit_tokens > CHUNK_OVERLAP_TOKENS:
            break
        tail.insert(0, unit.strip())
        total += unit_tokens
        if total >= CHUNK_OVERLAP_TOKENS:
            break
    return "\n".join(tail).strip()


def _merge_short_chunks(chunks: list[str]) -> list[str]:
    if len(chunks) <= 1:
        return chunks
    merged: list[str] = []
    for chunk in chunks:
        if merged and estimate_tokens(chunk) < MIN_CHUNK_TOKENS and estimate_tokens(merged[-1]) + estimate_tokens(chunk) <= CHUNK_TOKENS:
            merged[-1] = f"{merged[-1]}\n\n{chunk}".strip()
        else:
            merged.append(chunk)
    return merged


def _safe_filename(name: str) -> str:
    clean = re.sub(r"[^\w.\-]+", "-", name.strip(), flags=re.UNICODE).strip("-._")
    return clean[:120] or "attachment"


def _optional_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _failed_file(index: int, attachment: dict[str, Any], error: str) -> dict[str, Any]:
    return {
        "id": f"file-{index}",
        "name": str(attachment.get("name") or f"attachment-{index}"),
        "path": str(attachment.get("path") or ""),
        "content_type": str(attachment.get("content_type") or ""),
        "size_bytes": _optional_int(attachment.get("size_bytes")),
        "text_chars": 0,
        "chunk_count": 0,
        "status": "failed",
        "error": error,
    }
