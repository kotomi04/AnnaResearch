from __future__ import annotations

import re
import urllib.parse


def is_http_url(value: str) -> bool:
    parsed = urllib.parse.urlparse(str(value or "").strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def normalize_whitespace(value: str) -> str:
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in str(value or "").splitlines()]
    compact = [line for line in lines if line]
    return "\n".join(compact).strip()


def truncate_text(value: str, max_chars: int) -> str:
    limit = max(1, int(max_chars or 1))
    text = str(value or "")
    return text if len(text) <= limit else text[:limit]


def same_url_without_fragment(value: str) -> str:
    parsed = urllib.parse.urlparse(str(value or "").strip())
    return urllib.parse.urlunparse(parsed._replace(fragment=""))
