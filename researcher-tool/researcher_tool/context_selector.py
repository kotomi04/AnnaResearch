from __future__ import annotations

import re
from collections import defaultdict
from typing import Any
from urllib.parse import urlparse

TOKEN_RE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_\-]{1,}")
STOPWORDS = {
    "about", "after", "also", "and", "are", "but", "can", "for", "from",
    "how", "into", "its", "more", "not", "the", "their", "then", "there",
    "this", "that", "what", "when", "where", "which", "with", "will", "your",
}


def tokenize(text: str) -> set[str]:
    return {
        token.lower()
        for token in TOKEN_RE.findall(text or "")
        if token.lower() not in STOPWORDS and len(token) > 2
    }


def domain_of(url: str) -> str:
    host = urlparse(url or "").netloc.lower()
    return host[4:] if host.startswith("www.") else host


class LexicalContextSelector:
    """Ranks and emits context items across multiple Research Sources.

    Items lacking a URL fall back to ``(source_id, title)`` for deduplication.
    Each emitted context item is prefixed with ``[来源: <name>]`` so the report
    writer can optionally attribute fragments to a specific source."""

    def __init__(self, *, max_sources: int = 10, max_per_domain: int = 3, context_budget: int = 24000, min_content_length: int = 300):
        self.max_sources = max_sources
        self.max_per_domain = max_per_domain
        self.context_budget = context_budget
        self.min_content_length = min_content_length

    def select(
        self,
        *,
        query: str,
        search_queries: list[str],
        search_results: list[dict[str, Any]],
    ) -> dict[str, Any]:
        query_terms = tokenize(" ".join([query, *search_queries]))
        seen_keys: set[tuple[str, str]] = set()
        scored: list[tuple[float, dict[str, Any]]] = []

        for index, result in enumerate(search_results):
            url = str(result.get("url") or result.get("href") or "").strip()
            title = str(result.get("title") or "").strip()
            source_id = str(result.get("source_id") or "").strip()
            source_name = str(result.get("source_name") or "").strip() or source_id
            if url:
                key = ("url", url)
            elif source_id or title:
                key = ("st", f"{source_id}::{title.lower()}")
            else:
                continue
            if key in seen_keys:
                continue
            seen_keys.add(key)
            if str(result.get("extraction_status") or "").strip().lower() == "failed":
                continue
            content = str(result.get("content") or result.get("body") or result.get("raw_content") or "")
            if len(content.strip()) < self.min_content_length:
                continue
            title_terms = tokenize(title)
            content_terms = tokenize(content)
            title_hits = len(query_terms & title_terms)
            content_hits = len(query_terms & content_terms)
            score = title_hits * 4 + content_hits + max(0, 2 - index * 0.05)
            if url and url in query:
                score += 5
            scored.append((
                score,
                {
                    "query": result.get("query") or query,
                    "url": url,
                    "title": title or domain_of(url) or url or source_name or "(无标题)",
                    "content": content.strip(),
                    "source_id": source_id,
                    "source_name": source_name,
                    "score": round(score, 4),
                    "extraction_status": result.get("extraction_status"),
                    "extraction_error": result.get("extraction_error"),
                    "content_type": result.get("content_type"),
                },
            ))

        scored.sort(key=lambda item: item[0], reverse=True)
        per_domain: dict[str, int] = defaultdict(int)
        selected: list[dict[str, Any]] = []
        remaining = self.context_budget

        for _score, result in scored:
            if len(selected) >= self.max_sources or remaining <= 0:
                break
            domain = domain_of(result["url"]) or result.get("source_id") or "unknown"
            if per_domain[domain] >= self.max_per_domain:
                continue
            text = result["content"]
            if not text:
                continue
            allowance = max(0, remaining - 400)
            if allowance <= 0:
                break
            trimmed = trim_text(text, min(allowance, 4000))
            if not trimmed:
                continue
            item = dict(result)
            item["content"] = trimmed
            selected.append(item)
            per_domain[domain] += 1
            remaining -= len(trimmed) + len(item.get("url") or "") + len(item["title"]) + 80

        context_parts: list[str] = []
        for index, item in enumerate(selected, 1):
            source_label = item.get("source_name") or item.get("source_id") or "未知来源"
            prefix = f"[来源: {source_label}]"
            url_line = f"URL: {item['url']}" if item.get("url") else "URL: (无)"
            context_parts.append(
                f"{prefix} [{index}] {item['title']}\n{url_line}\nQuery: {item['query']}\nContent: {item['content']}"
            )
        return {
            "selected_sources": selected,
            "source_urls": [item["url"] for item in selected if item.get("url")],
            "selected_context": "\n\n".join(context_parts),
        }


def trim_text(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    boundary = max(cut.rfind(". "), cut.rfind("; "), cut.rfind(", "))
    if boundary > limit * 0.6:
        cut = cut[: boundary + 1]
    return cut.rstrip() + "..."
