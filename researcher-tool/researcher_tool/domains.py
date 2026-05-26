from __future__ import annotations

from typing import Any

from .errors import ValidationError


def normalize_domains(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        raw = value.split(",")
    elif isinstance(value, list):
        raw = value
    else:
        raise ValidationError("query_domains must be a string or array")

    domains: list[str] = []
    for item in raw:
        text = str(item or "").strip().lower()
        text = text.removeprefix("https://").removeprefix("http://").strip("/")
        if text and text not in domains:
            domains.append(text)
    return domains

