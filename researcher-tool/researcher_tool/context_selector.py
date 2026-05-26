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
    def __init__(self, *, max_sources: int = 10, max_per_domain: int = 3, context_budget: int = 24000):
        self.max_sources = max_sources
        self.max_per_domain = max_per_domain
        self.context_budget = context_budget

    def select(
        self,
        *,
        query: str,
        search_queries: list[str],
        search_results: list[dict[str, Any]],
    ) -> dict[str, Any]:
        query_terms = tokenize(" ".join([query, *search_queries]))
        seen_urls: set[str] = set()
        scored: list[tuple[float, dict[str, Any]]] = []

        for index, result in enumerate(search_results):
            url = str(result.get("url") or result.get("href") or "").strip()
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            title = str(result.get("title") or "")
            content = str(result.get("content") or result.get("body") or result.get("raw_content") or "")
            title_terms = tokenize(title)
            content_terms = tokenize(content)
            title_hits = len(query_terms & title_terms)
            content_hits = len(query_terms & content_terms)
            score = title_hits * 4 + content_hits + max(0, 2 - index * 0.05)
            if url in query:
                score += 5
            scored.append((
                score,
                {
                    "query": result.get("query") or query,
                    "url": url,
                    "title": title or domain_of(url) or url,
                    "content": content.strip(),
                    "score": round(score, 4),
                },
            ))

        scored.sort(key=lambda item: item[0], reverse=True)
        per_domain: dict[str, int] = defaultdict(int)
        selected: list[dict[str, Any]] = []
        remaining = self.context_budget

        for _score, result in scored:
            if len(selected) >= self.max_sources or remaining <= 0:
                break
            domain = domain_of(result["url"]) or "unknown"
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
            remaining -= len(trimmed) + len(item["url"]) + len(item["title"]) + 80

        context_parts = [
            f"[{index}] {item['title']}\nURL: {item['url']}\nQuery: {item['query']}\nContent: {item['content']}"
            for index, item in enumerate(selected, 1)
        ]
        return {
            "selected_sources": selected,
            "source_urls": [item["url"] for item in selected],
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

