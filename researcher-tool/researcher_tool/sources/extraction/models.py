from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExtractedPage:
    url: str
    title: str = ""
    raw_content: str = ""
    content_type: str = "unknown"
    status: str = "success"
    error: str | None = None
