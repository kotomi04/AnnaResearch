from __future__ import annotations

import re


def split_text_chunks(text: str, *, chunk_chars: int = 1200) -> list[str]:
    limit = max(200, int(chunk_chars or 1200))
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", str(text or "")) if part.strip()]
    chunks: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) > limit:
            chunks.extend(_split_long_text(paragraph, limit))
        else:
            chunks.append(paragraph)
    return chunks


def _split_long_text(text: str, limit: int) -> list[str]:
    chunks: list[str] = []
    clean = text.strip()
    while clean:
        chunks.append(clean[:limit].strip())
        clean = clean[limit:].strip()
    return [chunk for chunk in chunks if chunk]
