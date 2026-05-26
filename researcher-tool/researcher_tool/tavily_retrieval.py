from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from .errors import ConfigurationError, RetrievalFailure


class TavilySummaryRetriever:
    endpoint = "https://api.tavily.com/search"

    def __init__(self, *, api_key: str | None = None, timeout: int = 60, fake: bool | None = None):
        self.api_key = api_key or os.getenv("TAVILY_API_KEY")
        self.timeout = timeout
        self.fake = fake if fake is not None else os.getenv("ANNA_RESEARCHER_FAKE_TAVILY") == "1"

    def search_many(self, queries: list[str], *, query_domains: list[str] | None = None, max_results: int = 5) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        seen_urls: set[str] = set()
        for query in queries:
            for item in self.search(query, query_domains=query_domains, max_results=max_results):
                url = str(item.get("url") or "")
                if url and url not in seen_urls:
                    merged.append(item)
                    seen_urls.add(url)
        return merged

    def search(self, query: str, *, query_domains: list[str] | None = None, max_results: int = 5) -> list[dict[str, Any]]:
        if self.fake:
            return self._fake_search(query, query_domains=query_domains, max_results=max_results)
        if not self.api_key:
            raise ConfigurationError("Tavily API key is not configured")

        payload = {
            "api_key": self.api_key,
            "query": query,
            "search_depth": "basic",
            "topic": "general",
            "max_results": max_results,
            "include_answer": False,
            "include_raw_content": False,
            "include_domains": query_domains or None,
            "use_cache": True,
        }
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise RetrievalFailure(f"Tavily request failed with HTTP {exc.code}") from exc
        except Exception as exc:
            raise RetrievalFailure(f"Tavily request failed: {exc}") from exc

        normalized: list[dict[str, Any]] = []
        for item in data.get("results") or []:
            url = item.get("url") or item.get("href")
            content = item.get("content") or item.get("body") or ""
            if not url:
                continue
            normalized.append({
                "query": query,
                "url": url,
                "title": item.get("title") or "",
                "content": content,
            })
        return normalized

    def _fake_search(self, query: str, *, query_domains: list[str] | None = None, max_results: int = 5) -> list[dict[str, Any]]:
        domains = query_domains or ["example.com", "research.example"]
        results = []
        for i in range(max_results):
            domain = domains[i % len(domains)]
            results.append({
                "query": query,
                "url": f"https://{domain}/research/{i + 1}",
                "title": f"{query.title()} evidence {i + 1}",
                "content": (
                    f"{query} source {i + 1} discusses current evidence, risks, "
                    "implementation tradeoffs, operational details, and adoption considerations."
                ),
            })
        return results

