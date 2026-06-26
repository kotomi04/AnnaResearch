from __future__ import annotations

import io
import json
import os
import urllib.error
import urllib.request

import pytest

from researcher_tool.context_selector import LexicalContextSelector
from researcher_tool.dispatcher import AppDispatcher
from researcher_tool.errors import ConfigurationError, NotFoundError, ValidationError
from researcher_tool.job_store import JobStore, normalize_query_for_dedup
from researcher_tool.settings import SettingsStore, mask_secret
from researcher_tool.sources import (
    BUILTIN_SOURCE_IDS,
    CredentialStore,
    ResearchSourceExecutor,
    ResearchSourceRegistry,
    SourceCallError,
    builtin_duckduckgo_definition,
    builtin_tavily_definition,
    migrate_legacy_tavily_key,
)
from researcher_tool.sources.envelope import EnvelopeError, validate_envelope
from researcher_tool.sources.executor import resolve_path
from researcher_tool.sources.extraction import arxiv as arxiv_extraction
from researcher_tool.sources.extraction import fetcher as extraction_fetcher
from researcher_tool.sources.extraction.html import extract_html
from researcher_tool.sources.extraction.models import ExtractedPage
from researcher_tool.sources.extraction.pdf import extract_pdf
from researcher_tool.sources.native import duckduckgo as duckduckgo_native
from researcher_tool.sources.native.executor import NativeResearchSourceExecutor


def make_dispatcher(tmp_path):
    root = tmp_path / ".research"
    return AppDispatcher(
        settings=SettingsStore(root=root),
        jobs=JobStore(root=root),
        selector=LexicalContextSelector(max_sources=4, context_budget=4000),
    )


def post_json(url: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url: str):
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# Settings & legacy migration
# ---------------------------------------------------------------------------


def test_mask_secret_uses_front_zero_back_four():
    assert mask_secret("tvly-abcdef1234") == "***1234"
    assert mask_secret("short") == "***hort"
    assert mask_secret("abc") == "***"
    assert mask_secret("") == ""


def test_settings_mask_and_clear(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    assert dispatcher.dispatch("app_get_settings", {})["settings"]["tavily"]["configured"] is False
    view = dispatcher.dispatch("app_update_settings", {"tavily_api_key": "tvly-test-secret"})["settings"]
    assert view["tavily"]["configured"] is True
    assert "secret" not in view["tavily"]["masked"]
    assert dispatcher.dispatch(
        "app_update_settings", {"clear_tavily_api_key": True}
    )["settings"]["tavily"]["configured"] is False


def test_legacy_tavily_key_migration_is_idempotent(tmp_path):
    root = tmp_path / ".research"
    settings = SettingsStore(root=root)
    settings.update(tavily_api_key="tvly-legacy-key-aaaa")
    creds = CredentialStore(root)

    assert migrate_legacy_tavily_key(settings, creds) is True
    assert "tavily_api_key" not in settings.read_raw()
    assert creds.get_token("tavily") == "tvly-legacy-key-aaaa"
    assert creds.status("tavily")["credential"] == "tvly-legacy-key-aaaa"

    # Re-running the migration is a no-op.
    assert migrate_legacy_tavily_key(settings, creds) is False
    assert creds.get_token("tavily") == "tvly-legacy-key-aaaa"


def test_credential_store_set_clear_remove(tmp_path):
    creds = CredentialStore(tmp_path / ".research")
    assert creds.status("tavily") == {"credential_status": "missing", "credential": ""}
    status = creds.set_token("tavily", "tvly-abcdef1234")
    assert status == {"credential_status": "configured", "credential": "tvly-abcdef1234"}
    creds.clear("tavily")
    assert creds.get_token("tavily") == ""
    creds.set_token("custom", "secret-zzzz")
    creds.remove("custom")
    assert creds.get_token("custom") == ""


# ---------------------------------------------------------------------------
# Job store v2
# ---------------------------------------------------------------------------


def test_job_create_update_latest_and_not_found(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
    assert job["research_id"].startswith("research_")
    latest_status = dispatcher.dispatch("app_get_research_job", {})["job"]
    assert latest_status["research_id"] == job["research_id"]
    assert "schema_version" not in latest_status
    assert get_json(latest_status["job_transfer"]["url"])["job"]["research_id"] == job["research_id"]
    updated = dispatcher.dispatch(
        "app_update_research_job",
        {
            "research_id": job["research_id"],
            "updates": {
                "stage": "search_next_query",
                "progress": 25,
                "iteration": 1,
                "max_iterations": 5,
                "enabled_sources": ["tavily"],
            },
        },
    )
    assert updated["job"]["stage"] == "search_next_query"
    assert updated["job"]["progress"] == 25
    assert updated["job"]["iteration"] == 1
    assert updated["job"]["max_iterations"] == 5
    with pytest.raises(ValidationError):
        dispatcher.dispatch(
            "app_update_research_job",
            {"research_id": job["research_id"], "updates": {"tavily_api_key": "leak"}},
        )
    with pytest.raises(NotFoundError):
        dispatcher.dispatch("app_get_research_job", {"research_id": "missing"})


def test_compact_job_view_exposes_v2_fields(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
    immediate = dispatcher.dispatch("app_get_research_job", {"research_id": job["research_id"]})["job"]
    assert "iterations" not in immediate
    assert "source_urls" not in immediate
    loaded = get_json(immediate["job_transfer"]["url"])["job"]
    assert loaded["schema_version"] == 2
    assert loaded["iterations"] == []
    assert loaded["research_log"] == []
    assert loaded["iteration"] == 0
    assert loaded["max_iterations"] == 5
    assert loaded["enabled_sources"] == []


def test_job_store_has_called_dedup_uses_normalized_query(tmp_path):
    jobs = JobStore(root=tmp_path / ".research")
    job = jobs.create(query="anna")
    research_id = job["research_id"]
    assert jobs.has_called(research_id, "tavily", normalize_query_for_dedup("Anna  App")) is False
    jobs.append_iteration(
        research_id,
        iteration=1,
        source_id="tavily",
        source_name="Tavily",
        queries=["Anna App"],
        source_calls=[{"query": "Anna App", "items": [{"url": "https://x.example", "title": "t"}], "duration_ms": 1}],
        raw_results=[{"query": "Anna App", "url": "https://x.example", "title": "t", "content": "c"}],
    )
    assert jobs.has_called(research_id, "tavily", normalize_query_for_dedup("anna  app")) is True
    assert jobs.has_called(research_id, "tavily", normalize_query_for_dedup("different")) is False


def test_normalize_query_collapses_whitespace_and_case():
    assert normalize_query_for_dedup("  Anna   App  ") == "anna app"
    assert normalize_query_for_dedup("ANNA\tApp") == "anna app"
    assert normalize_query_for_dedup("") == ""


# ---------------------------------------------------------------------------
# Native DuckDuckGo adapter
# ---------------------------------------------------------------------------


def test_duckduckgo_native_search_normalizes_results(monkeypatch):
    class FakeDDGS:
        def text(self, query, *, region, max_results):
            assert query == "anna research"
            assert region == "us-en"
            assert max_results == 20
            return [
                {"href": "https://example.com/a", "title": "Alpha", "body": "alpha body"},
                {"url": "https://example.com/b", "title": "Beta", "snippet": "beta snippet"},
                {"href": "https://example.com/c", "content": "content fallback"},
                {"title": "No useful content"},
            ]

    monkeypatch.setattr(duckduckgo_native, "_create_client", lambda: FakeDDGS())

    results = duckduckgo_native.search_duckduckgo(" anna research ", max_results=50, region="us-en")

    assert results == [
        {
            "query": "anna research",
            "url": "https://example.com/a",
            "title": "Alpha",
            "content": "alpha body",
        },
        {
            "query": "anna research",
            "url": "https://example.com/b",
            "title": "Beta",
            "content": "beta snippet",
        },
        {
            "query": "anna research",
            "url": "https://example.com/c",
            "title": "https://example.com/c",
            "content": "content fallback",
        },
    ]


def test_duckduckgo_native_search_handles_empty_query(monkeypatch):
    monkeypatch.setattr(duckduckgo_native, "_create_client", lambda: pytest.fail("client should not be created"))

    assert duckduckgo_native.search_duckduckgo("   ") == []


def test_duckduckgo_native_search_wraps_ddgs_errors(monkeypatch):
    class FailingDDGS:
        def text(self, query, *, region, max_results):
            raise RuntimeError("blocked")

    monkeypatch.setattr(duckduckgo_native, "_create_client", lambda: FailingDDGS())

    with pytest.raises(duckduckgo_native.DuckDuckGoSearchError, match="duckduckgo search failed"):
        duckduckgo_native.search_duckduckgo("anna")


def test_native_research_source_executor_call_wraps_ddgs_results():
    executor = NativeResearchSourceExecutor(
        clock=_fixed_clock(),
        adapters={
            "ddgs": lambda query: [
                {"query": query, "url": "https://example.com/a", "title": "Alpha", "content": "alpha body"},
            ]
        },
        extractor=lambda items, **kwargs: items,
    )

    result = executor.call(_native_definition(), " anna ")

    assert result.source_id == "duckduckresearch"
    assert result.source_name == "DuckDuckResearch"
    assert result.query == "anna"
    assert result.duration_ms == 125
    assert result.error is None
    assert result.items == [
        {
            "query": "anna",
            "url": "https://example.com/a",
            "title": "Alpha",
            "content": "alpha body",
            "source_id": "duckduckresearch",
            "source_name": "DuckDuckResearch",
        }
    ]


def test_native_research_source_executor_extracts_by_default():
    extractor_calls = []

    def fake_extractor(items, **kwargs):
        extractor_calls.append((items, kwargs))
        enriched = []
        for item in items:
            enriched.append({**item, "raw_content": "Fetched body", "content": item["content"] + "\n\nFull content:\nFetched body"})
        return enriched

    executor = NativeResearchSourceExecutor(
        clock=_fixed_clock(),
        adapters={
            "ddgs": lambda query: [
                {"query": query, "url": "https://example.com/a", "title": "Alpha", "content": "alpha snippet"},
            ]
        },
        extractor=fake_extractor,
    )
    definition = _native_definition()
    definition["native"]["max_urls"] = 2
    definition["native"]["max_chars_per_page"] = 9000
    definition["native"]["max_pdf_pages"] = 4
    definition["native"]["browser_fallback"] = True
    definition["native"]["browser_fallback_min_chars"] = 250
    definition["native"]["browser_timeout"] = 12

    result = executor.call(definition, "anna")

    assert result.error is None
    assert result.items[0]["raw_content"] == "Fetched body"
    assert result.items[0]["content"] == "alpha snippet\n\nFull content:\nFetched body"
    assert extractor_calls == [
        (
            [{"query": "anna", "url": "https://example.com/a", "title": "Alpha", "content": "alpha snippet"}],
            {
                "query": "anna",
                "max_urls": 2,
                "timeout": 20.0,
                "max_chars_per_page": 9000,
                "max_pdf_pages": 4,
                "browser_fallback": True,
                "browser_fallback_min_chars": 250,
                "browser_timeout": 12.0,
            },
        )
    ]


def test_native_research_source_executor_reports_extraction_failure():
    def failing_extractor(items, **kwargs):
        raise RuntimeError("fetch blocked")

    executor = NativeResearchSourceExecutor(
        clock=_fixed_clock(),
        adapters={"ddgs": lambda query: [{"query": query, "url": "https://example.com/a", "title": "Alpha", "content": "alpha"}]},
        extractor=failing_extractor,
    )
    definition = _native_definition()

    result = executor.call(definition, "anna")
    test = executor.test(definition, "anna")

    assert result.error == "upstream_5xx"
    assert result.items == []
    assert test.error and test.error["code"] == "upstream_5xx"
    assert "native extraction failed" in test.error["message"]


def test_native_research_source_executor_reports_empty_results():
    executor = NativeResearchSourceExecutor(clock=_fixed_clock(), adapters={"ddgs": lambda query: []})

    result = executor.call(_native_definition(), "anna")
    test = executor.test(_native_definition(), "anna")

    assert result.error == "empty_result"
    assert result.items == []
    assert test.error == {"code": "empty_result", "message": "native source returned no results"}
    assert test.extracted == []


def test_native_research_source_executor_reports_bad_definition():
    executor = NativeResearchSourceExecutor(clock=_fixed_clock())

    result = executor.call({"id": "native", "name": "Native", "native": {"adapter": "missing"}}, "anna")
    test = executor.test({"id": "native", "name": "Native", "native": {"adapter": "missing"}}, "anna")

    assert result.error == "bad_definition"
    assert result.items == []
    assert test.error and test.error["code"] == "bad_definition"


def test_pdf_extraction_reads_local_pdf(tmp_path):
    fitz = pytest.importorskip("fitz")
    pdf_path = tmp_path / "sample.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Anna PDF extraction smoke test")
    doc.save(str(pdf_path))
    doc.close()

    result = extract_pdf(str(pdf_path), max_pages=1, max_chars_per_page=2000)

    assert result.status == "success"
    assert result.content_type == "pdf"
    assert result.url == str(pdf_path)
    assert "Anna PDF extraction smoke test" in result.raw_content


def test_arxiv_extraction_reads_paper_metadata(monkeypatch):
    def fake_load(query, *, max_results):
        assert query == "2401.12345"
        assert max_results == 2
        return {
            "title": "Anna Research Systems",
            "authors": "Ada Lovelace, Alan Turing",
            "published": "2026-06-22T00:00:00+00:00",
            "summary": "A paper about research agents.",
        }

    monkeypatch.setattr(arxiv_extraction, "_load_arxiv_document", fake_load)

    result = arxiv_extraction.extract_arxiv("https://arxiv.org/abs/2401.12345v2")

    assert result.status == "success"
    assert result.content_type == "arxiv"
    assert result.title == "Anna Research Systems"
    assert "Published: 2026-06-22T00:00:00+00:00" in result.raw_content
    assert "Author: Ada Lovelace, Alan Turing" in result.raw_content
    assert "Content: A paper about research agents." in result.raw_content


def test_arxiv_extraction_reports_empty_source():
    result = arxiv_extraction.extract_arxiv(" ")

    assert result.status == "failed"
    assert result.error == "empty_source"


def test_html_extraction_reads_local_html_and_removes_noise(tmp_path):
    html_path = tmp_path / "page.html"
    html_path.write_text(
        """
        <html>
          <head><title>Anna Page</title><script>bad()</script></head>
          <body>
            <nav>Navigation should disappear</nav>
            <article>
              <h1>Research Findings</h1>
              <p>Anna extracts the useful article body.</p>
              <p>Read the <a href="https://example.com/source">source page</a> for details.</p>
              <ul><li>First finding</li><li>Second finding</li></ul>
            </article>
            <footer>Footer should disappear</footer>
          </body>
        </html>
        """,
        encoding="utf-8",
    )

    result = extract_html(str(html_path), max_chars_per_page=2000)

    assert result.status == "success"
    assert result.content_type == "html"
    assert result.title == "Anna Page"
    assert "# Research Findings" in result.raw_content
    assert "Anna extracts the useful article body." in result.raw_content
    assert "source page⟨1⟩" in result.raw_content
    assert "## References" in result.raw_content
    assert "⟨1⟩ https://example.com/source: source page" in result.raw_content
    assert "- First finding" in result.raw_content
    assert "Navigation should disappear" not in result.raw_content
    assert "Footer should disappear" not in result.raw_content


def test_html_extraction_prunes_and_filters_markdown_by_query(tmp_path):
    html_path = tmp_path / "filtered.html"
    html_path.write_text(
        """
        <html>
          <head><title>Market Page</title></head>
          <body>
            <main>
              <section>
                <h2>Anthropic financing</h2>
                <p>Anthropic raised new funding from strategic cloud partners and expanded its enterprise market position.</p>
                <p>Claude adoption in enterprise accounts supports the company's market positioning.</p>
              </section>
              <section>
                <h2>Recipe notes</h2>
                <p>Banana bread tastes better with cinnamon and walnuts.</p>
              </section>
              <p><a href="/a">Home</a> <a href="/b">Login</a> <a href="/c">Register</a> <a href="/d">Share</a></p>
            </main>
          </body>
        </html>
        """,
        encoding="utf-8",
    )

    result = extract_html(
        str(html_path),
        max_chars_per_page=4000,
        query="Anthropic financing enterprise market positioning",
    )

    assert result.status == "success"
    assert "# Anthropic financing" in result.raw_content
    assert "strategic cloud partners" in result.raw_content
    assert "enterprise accounts" in result.raw_content
    assert "Banana bread" not in result.raw_content
    assert "Home" not in result.raw_content


def test_fetch_url_uses_browser_fallback_for_short_static_content(monkeypatch):
    calls = []

    monkeypatch.setattr(
        extraction_fetcher,
        "extract_html",
        lambda url, **kwargs: calls.append(("static", url, kwargs)) or ExtractedPage(url=url, title="Short", raw_content="Short", content_type="html"),
    )
    monkeypatch.setattr(
        extraction_fetcher,
        "extract_with_browser_fallback",
        lambda url, **kwargs: calls.append(("browser", url, kwargs))
        or ExtractedPage(url=url, title="Browser", raw_content="# Browser markdown", content_type="html"),
    )

    page = extraction_fetcher.fetch_url(
        "https://example.com/dynamic",
        query="dynamic page",
        browser_fallback=True,
        browser_fallback_min_chars=20,
        browser_timeout=9,
    )

    assert page.title == "Browser"
    assert page.raw_content == "# Browser markdown"
    assert calls == [
        ("static", "https://example.com/dynamic", {"timeout": 20.0, "max_chars_per_page": 12000, "query": "dynamic page"}),
        ("browser", "https://example.com/dynamic", {"query": "dynamic page", "timeout": 9, "max_chars_per_page": 12000}),
    ]


def test_extraction_fetcher_routes_by_url_type(monkeypatch):
    calls = []

    monkeypatch.setattr(
        extraction_fetcher,
        "extract_arxiv",
        lambda url: calls.append(("arxiv", url)) or ExtractedPage(url=url, raw_content="arxiv", content_type="arxiv"),
    )
    monkeypatch.setattr(
        extraction_fetcher,
        "extract_pdf",
        lambda url, **kwargs: calls.append(("pdf", url, kwargs)) or ExtractedPage(url=url, raw_content="pdf", content_type="pdf"),
    )
    monkeypatch.setattr(
        extraction_fetcher,
        "extract_html",
        lambda url, **kwargs: calls.append(("html", url, kwargs)) or ExtractedPage(url=url, raw_content="html", content_type="html"),
    )

    pages = extraction_fetcher.fetch_many(
        [
            "https://arxiv.org/abs/2401.12345",
            "https://arxiv.org/pdf/2401.12345",
            "https://example.com/report.pdf",
            "https://example.com/page",
            "https://example.com/page#section",
        ],
        max_urls=10,
        max_chars_per_page=111,
        max_pdf_pages=2,
    )

    assert [page.content_type for page in pages] == ["arxiv", "arxiv", "pdf", "html"]
    assert calls[0] == ("arxiv", "https://arxiv.org/abs/2401.12345")
    assert calls[1] == ("arxiv", "https://arxiv.org/pdf/2401.12345")
    assert calls[2][0:2] == ("pdf", "https://example.com/report.pdf")
    assert calls[2][2]["max_chars_per_page"] == 111
    assert calls[2][2]["max_pdf_pages"] == 2
    assert calls[3][0:2] == ("html", "https://example.com/page")


def test_extraction_fetcher_enriches_search_items(monkeypatch):
    monkeypatch.setattr(
        extraction_fetcher,
        "fetch_many",
        lambda items, **kwargs: [
            ExtractedPage(
                url="https://example.com/a",
                title="Fetched title",
                raw_content="Full page text",
                content_type="html",
            )
        ],
    )

    enriched = extraction_fetcher.enrich_items_with_extracted_content(
        [
            {"url": "https://example.com/a#intro", "content": "Snippet"},
            {"url": "https://example.com/b", "content": "Untouched"},
        ]
    )

    assert enriched[0]["title"] == "Fetched title"
    assert enriched[0]["raw_content"] == "Full page text"
    assert enriched[0]["content"] == "Snippet\n\nRelevant excerpts:\nFull page text"
    assert enriched[0]["extraction_status"] == "success"
    assert enriched[1] == {"url": "https://example.com/b", "content": "Untouched"}


@pytest.mark.skipif(
    os.getenv("ANNA_RESEARCHER_REAL_DDGS") != "1",
    reason="set ANNA_RESEARCHER_REAL_DDGS=1 to run the real DuckDuckGo/ddgs network test",
)
def test_duckduckgo_native_search_real_network():
    results = duckduckgo_native.search_duckduckgo("Anna app research", max_results=3)

    assert 1 <= len(results) <= 3
    for item in results:
        assert item["query"] == "Anna app research"
        assert item["url"].startswith(("http://", "https://"))
        assert item["title"] or item["content"]


def _native_definition():
    return {
        "id": "duckduckresearch",
        "name": "DuckDuckResearch",
        "native": {"adapter": "ddgs", "max_results": 5, "region": "wt-wt"},
    }


def _fixed_clock():
    values = iter([10.0, 10.125, 20.0, 20.125])
    return lambda: next(values)


# ---------------------------------------------------------------------------
# Envelope validation (ADR 0004)
# ---------------------------------------------------------------------------


def _user_envelope(**overrides):
    base = {
        "id": "custom",
        "name": "Custom",
        "request": {
            "method": "GET",
            "url": "https://api.example/search?token={token}&q={query}",
        },
        "pagination": {"mode": "none", "max_pages": 1},
        "result": {
            "items_path": "results[]",
            "url": {"mode": "path", "value": "url"},
            "title": {"mode": "path", "value": "title"},
            "content": {"mode": "paths", "value": ["snippet"]},
        },
        "response": {"content_type": "application/json"},
    }
    for key, value in overrides.items():
        if value is None:
            base.pop(key, None)
        else:
            base[key] = value
    return base


def test_envelope_accepts_minimal_user_definition():
    validate_envelope(_user_envelope(), kind="user")


@pytest.mark.parametrize(
    "mutator, expected_reason",
    [
        (lambda d: d["request"].__setitem__("method", "PUT"), "method_must_be_get_or_post"),
        (lambda d: d.__setitem__("auth", {"oauth_client_secret": "x"}), "oauth_not_supported"),
        (lambda d: d.__setitem__("auth", {"x-hmac-signature": "x"}), "hmac_not_supported"),
        (
            lambda d: d["request"].__setitem__("headers", {"Content-Type": "multipart/form-data; boundary=---"}),
            "content_type_not_supported",
        ),
        (lambda d: d.__setitem__("script", "() => {}"), "script_fields_not_supported"),
        (
            lambda d: d["request"].__setitem__("url", "https://api.example/search?token={token}&q={query}&fancy={magic}"),
            "unknown_placeholder",
        ),
        (
            lambda d: d["request"].__setitem__("url", "https://api.example/search?q={query}"),
            "token_placeholder_required",
        ),
        (lambda d: d.__setitem__("pagination", {"mode": "rolling", "max_pages": 1}), "pagination_mode_invalid"),
        (lambda d: d.__setitem__("pagination", {"mode": "page", "max_pages": 99}), "max_pages_exceeds_cap"),
        (lambda d: d["result"].pop("url"), "result_url_required"),
        (lambda d: d["result"].__setitem__("content", {"mode": "paths", "value": []}), "result_content_paths_must_be_nonempty_array"),
        (
            lambda d: d["result"].__setitem__("title", {"mode": "none"}),
            "result_title_mode_invalid",
        ),
        (
            lambda d: d["result"].__setitem__("url", {"mode": "template", "value": "https://example.test/{{context.token}}"}),
            "result_template_token_not_allowed",
        ),
        (
            lambda d: d["result"].__setitem__("content", {"mode": "template", "value": "bad {{query}}"}),
            "result_template_placeholder_invalid",
        ),
        (
            lambda d: d.__setitem__("response", {"content_type": "text/html"}),
            "response_must_be_json",
        ),
        (lambda d: d.__setitem__("max_parallel", 99), "max_parallel_out_of_range"),
    ],
)
def test_envelope_rejects_invalid_shapes(mutator, expected_reason):
    definition = _user_envelope()
    mutator(definition)
    with pytest.raises(EnvelopeError) as exc:
        validate_envelope(definition, kind="user")
    assert exc.value.reason == expected_reason


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def test_registry_lists_builtin_tavily_with_credential(tmp_path):
    root = tmp_path / ".research"
    creds = CredentialStore(root)
    registry = ResearchSourceRegistry(root, credentials=creds)
    views = registry.list_views()
    by_id = {view["id"]: view for view in views}
    assert list(by_id) == ["tavily", "duckduckgo"]
    assert by_id["tavily"]["kind"] == "builtin"
    assert by_id["tavily"]["credential_status"] == "missing"
    assert by_id["tavily"]["definition"]["id"] == "tavily"
    assert by_id["tavily"]["definition"]["request"]["body"]["api_key"] == "{token}"
    assert "credential" not in by_id["tavily"]["definition"]
    assert "token" not in by_id["tavily"]["definition"]
    assert by_id["duckduckgo"]["kind"] == "builtin"
    assert by_id["duckduckgo"]["credential_status"] == "configured"
    assert by_id["duckduckgo"]["credential"] == ""
    assert by_id["duckduckgo"]["definition"]["native"]["adapter"] == "ddgs"

    creds.set_token("tavily", "tvly-secret-1234")
    refreshed = registry.get_view("tavily")
    assert refreshed["credential_status"] == "configured"
    assert refreshed["credential"] == "tvly-secret-1234"


def test_registry_rejects_user_attempt_to_override_builtin(tmp_path):
    root = tmp_path / ".research"
    creds = CredentialStore(root)
    registry = ResearchSourceRegistry(root, credentials=creds)
    assert "tavily" in BUILTIN_SOURCE_IDS
    assert "duckduckgo" in BUILTIN_SOURCE_IDS
    with pytest.raises(ValidationError) as exc:
        registry.upsert_user_source(_user_envelope(id="tavily", name="hijacked"))
    assert exc.value.data.get("reason") == "builtin_protected"


def test_registry_upsert_and_delete_user_source_clears_credential(tmp_path):
    root = tmp_path / ".research"
    creds = CredentialStore(root)
    registry = ResearchSourceRegistry(root, credentials=creds)
    view = registry.upsert_user_source(_user_envelope(id="acme", name="ACME"))
    assert view["id"] == "acme"
    assert view["kind"] == "user"
    creds.set_token("acme", "acme-token-abcd")
    assert creds.get_token("acme") == "acme-token-abcd"
    registry.delete_user_source("acme")
    assert creds.get_token("acme") == ""
    with pytest.raises(NotFoundError):
        registry.get_definition("acme")


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, body: bytes, status: int = 200):
        self._body = body
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self) -> bytes:
        return self._body


def fake_http(payload: dict, *, status: int = 200):
    body = json.dumps(payload).encode("utf-8")

    def _open(request, timeout=None):
        return FakeResponse(body, status=status)

    return _open


def test_executor_calls_builtin_tavily_with_token_substitution():
    captured: list[dict] = []

    def http(request, timeout=None):
        captured.append(
            {
                "method": request.get_method(),
                "url": request.full_url,
                "body": json.loads(request.data.decode("utf-8")) if request.data else None,
            }
        )
        return FakeResponse(
            json.dumps(
                {
                    "results": [
                        {"url": "https://ex.com/a", "title": "A", "content": "alpha"},
                        {"url": "https://ex.com/b", "title": "B", "content": "beta"},
                    ]
                }
            ).encode("utf-8")
        )

    executor = ResearchSourceExecutor(token_provider=lambda sid: "tvly-secret-abcd", http_open=http, sleep=lambda _: None)
    result = executor.call(builtin_tavily_definition(), "anna")
    assert result.error is None
    assert len(result.items) == 2
    assert result.items[0]["source_id"] == "tavily"
    assert captured and captured[0]["method"] == "POST"
    assert captured[0]["body"]["api_key"] == "tvly-secret-abcd"
    assert captured[0]["body"]["query"] == "anna"


def test_executor_returns_empty_result_when_no_items_returned():
    executor = ResearchSourceExecutor(
        token_provider=lambda sid: "tok",
        http_open=fake_http({"results": []}),
        sleep=lambda _: None,
    )
    result = executor.call(builtin_tavily_definition(), "anna")
    assert result.error == "empty_result"
    assert result.items == []


def test_executor_classifies_http_status_codes():
    cases = {
        401: "auth_failed",
        403: "auth_failed",
        429: "rate_limited",
        500: "upstream_5xx",
        502: "upstream_5xx",
        418: "bad_definition",
    }
    for status, expected in cases.items():
        def opener(status_code=status):
            def _open(request, timeout=None):
                raise urllib.error.HTTPError(request.full_url, status_code, "boom", hdrs=None, fp=io.BytesIO(b""))

            return _open

        executor = ResearchSourceExecutor(token_provider=lambda sid: "tok", http_open=opener(), sleep=lambda _: None)
        result = executor.call(builtin_tavily_definition(), "anna")
        assert result.error == expected, f"status {status} -> expected {expected}, got {result.error}"


def test_executor_retries_get_once_on_rate_limit():
    calls = {"n": 0}

    def opener(request, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError(request.full_url, 429, "slow down", hdrs=None, fp=io.BytesIO(b""))
        return FakeResponse(json.dumps({"results": [{"url": "https://x", "title": "t", "snippet": "s"}]}).encode("utf-8"))

    sleeps: list[float] = []
    definition = _user_envelope()  # GET-method envelope
    executor = ResearchSourceExecutor(
        token_provider=lambda sid: "tok",
        http_open=opener,
        sleep=lambda d: sleeps.append(d),
    )
    result = executor.call(definition, "anna")
    assert calls["n"] == 2
    assert sleeps == [1.0]
    assert result.error is None
    assert len(result.items) == 1


def test_executor_supports_result_templates_and_single_object_items():
    definition = _user_envelope(
        result={
            "items_path": "company",
            "url": {"mode": "template", "value": "https://example.test/search?q={{context.query}}"},
            "title": {"mode": "template", "value": "{{item.name}} company profile"},
            "content": {
                "mode": "template",
                "value": "Company: {{item.name}}\nLegal person: {{item.people[0].name}}\nScope: {{item.scope}}",
            },
        }
    )
    executor = ResearchSourceExecutor(
        token_provider=lambda sid: "tok",
        http_open=fake_http({"company": {"name": "ACME", "people": [{"name": "Ada"}], "scope": "Research apps"}}),
        sleep=lambda _: None,
    )
    result = executor.call(definition, "anna app")
    assert result.error is None
    assert len(result.items) == 1
    assert result.items[0]["url"] == "https://example.test/search?q=anna app"
    assert result.items[0]["title"] == "ACME company profile"
    assert "Legal person: Ada" in result.items[0]["content"]


def test_executor_supports_url_none_and_rejects_scalar_items_path():
    none_url = _user_envelope(
        result={
            "items_path": "result",
            "url": {"mode": "none"},
            "title": {"mode": "path", "value": "name"},
            "content": {"mode": "paths", "value": ["scope"]},
        }
    )
    executor = ResearchSourceExecutor(
        token_provider=lambda sid: "tok",
        http_open=fake_http({"result": {"name": "ACME", "scope": "Research apps"}}),
        sleep=lambda _: None,
    )
    result = executor.call(none_url, "anna")
    assert result.error is None
    assert result.items[0]["url"] == ""

    scalar = dict(none_url)
    executor = ResearchSourceExecutor(
        token_provider=lambda sid: "tok",
        http_open=fake_http({"result": "not an object"}),
        sleep=lambda _: None,
    )
    result = executor.call(scalar, "anna")
    assert result.error == "bad_definition"


def test_executor_does_not_retry_post():
    calls = {"n": 0}

    def opener(request, timeout=None):
        calls["n"] += 1
        raise urllib.error.HTTPError(request.full_url, 429, "slow down", hdrs=None, fp=io.BytesIO(b""))

    executor = ResearchSourceExecutor(
        token_provider=lambda sid: "tok",
        http_open=opener,
        sleep=lambda _: None,
    )
    result = executor.call(builtin_tavily_definition(), "anna")
    assert calls["n"] == 1
    assert result.error == "rate_limited"


def test_executor_paginates_in_page_mode_until_empty():
    pages = [
        {"results": [{"url": "https://x.com/1", "title": "a", "content": "1"}]},
        {"results": [{"url": "https://x.com/2", "title": "b", "content": "2"}]},
        {"results": []},
    ]
    seen_pages: list[str] = []

    def opener(request, timeout=None):
        url = request.full_url
        seen_pages.append(url)
        payload = pages[len(seen_pages) - 1]
        return FakeResponse(json.dumps(payload).encode("utf-8"))

    definition = {
        "id": "pager",
        "name": "Pager",
        "request": {"method": "GET", "url": "https://x.com/?token={token}&q={query}&page={page}"},
        "pagination": {"mode": "page", "max_pages": 5, "page_size": 1, "start_page": 1},
        "result": {
            "items_path": "results[]",
            "url": {"mode": "path", "value": "url"},
            "title": {"mode": "path", "value": "title"},
            "content": {"mode": "paths", "value": ["content"]},
        },
        "response": {"content_type": "application/json"},
    }
    executor = ResearchSourceExecutor(token_provider=lambda sid: "tok", http_open=opener, sleep=lambda _: None)
    result = executor.call(definition, "anna")
    assert result.error is None
    assert len(result.items) == 2
    assert "page=1" in seen_pages[0]
    assert "page=2" in seen_pages[1]


def test_executor_test_returns_request_response_and_extracted_items():
    definition = builtin_tavily_definition()
    executor = ResearchSourceExecutor(
        token_provider=lambda sid: "tvly-secret-abcd",
        http_open=fake_http({"results": [{"url": "https://x.com/1", "title": "Title", "content": "Evidence"}]}),
        sleep=lambda _: None,
    )
    result = executor.test(definition, "anna")
    assert result.error is None
    assert result.pages[0]["request"]["method"] == "POST"
    assert result.pages[0]["request"]["body"]["api_key"] == "tvly-secret-abcd"
    assert result.pages[0]["response"]["json"]["results"][0]["title"] == "Title"
    assert result.extracted[0]["url"] == "https://x.com/1"
    assert result.extracted[0]["content"] == "Evidence"


def test_resolve_path_handles_dot_and_index_segments():
    payload = {"data": {"results": [{"name": "X"}, {"name": "Y"}]}}
    assert resolve_path(payload, "data.results[]") == payload["data"]["results"]
    assert resolve_path(payload, "data.results[0].name") == "X"
    assert resolve_path(payload, "data.missing") is None


def test_source_call_error_falls_back_to_bad_definition_for_unknown_codes():
    error = SourceCallError("nonsense", "boom")
    assert error.code == "bad_definition"


# ---------------------------------------------------------------------------
# Dispatcher: app_call_research_source end-to-end
# ---------------------------------------------------------------------------


def test_call_research_source_rejects_missing_credential(tmp_path, monkeypatch):
    monkeypatch.delenv("ANNA_RESEARCHER_FAKE_TAVILY", raising=False)
    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
    with pytest.raises(ConfigurationError):
        dispatcher.dispatch(
            "app_call_research_source",
            {"research_id": job["research_id"], "iteration": 1, "source_id": "tavily", "queries": ["anna"]},
        )


def test_call_research_source_uses_fake_token_and_records_iteration(tmp_path, monkeypatch):
    monkeypatch.setenv("ANNA_RESEARCHER_FAKE_TAVILY", "1")
    dispatcher = make_dispatcher(tmp_path)

    def fake_http(request, timeout=None):
        return FakeResponse(
            json.dumps(
                {
                    "results": [
                        {"url": "https://e.com/a", "title": "A", "content": "alpha"},
                        {"url": "https://e.com/b", "title": "B", "content": "beta"},
                    ]
                }
            ).encode("utf-8")
        )

    dispatcher.executor = ResearchSourceExecutor(
        token_provider=dispatcher._token_for, http_open=fake_http, sleep=lambda _: None
    )

    job = dispatcher.dispatch("app_create_research_job", {"query": "anna researcher"})["job"]
    response = dispatcher.dispatch(
        "app_call_research_source",
        {"research_id": job["research_id"], "iteration": 1, "source_id": "tavily", "queries": ["anna", "researcher"]},
    )
    call = response["source_call"]
    assert call["source_id"] == "tavily"
    assert call["results_count"] == 4
    assert call["error"] is None
    assert all("items" not in entry for entry in call["calls"])
    immediate = dispatcher.dispatch("app_get_research_job", {"research_id": job["research_id"]})["job"]
    loaded = get_json(immediate["job_transfer"]["url"])["job"]
    assert loaded["iterations"][0]["queries"] == ["anna", "researcher"]
    assert all("raw_results" not in iteration for iteration in loaded["iterations"])
    assert loaded["search_queries"] == ["anna", "researcher"]
    assert loaded["source_urls"] == ["https://e.com/a", "https://e.com/b"]


def test_call_research_source_uses_native_duckduckgo_without_credential(tmp_path, monkeypatch):
    monkeypatch.delenv("ANNA_RESEARCHER_FAKE_TAVILY", raising=False)
    dispatcher = make_dispatcher(tmp_path)
    dispatcher.native_executor = NativeResearchSourceExecutor(
        adapters={
            "ddgs": lambda query: [
                {"query": query, "url": "https://duck.example/a", "title": "Duck result", "content": "duck snippet"},
            ]
        },
        extractor=lambda items, **kwargs: [
            {**item, "raw_content": "Duck full content", "content": item["content"] + "\n\nFull content:\nDuck full content"}
            for item in items
        ],
    )

    job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
    response = dispatcher.dispatch(
        "app_call_research_source",
        {"research_id": job["research_id"], "iteration": 1, "source_id": "duckduckgo", "queries": ["anna"]},
    )

    call = response["source_call"]
    assert call["source_id"] == "duckduckgo"
    assert call["results_count"] == 1
    assert call["error"] is None
    loaded = dispatcher.jobs.load(job["research_id"])
    item = loaded["iterations"][0]["raw_results"][0]
    assert item["source_id"] == "duckduckgo"
    assert item["raw_content"] == "Duck full content"
    assert loaded["source_urls"] == ["https://duck.example/a"]


def test_call_research_source_rejects_duplicate_query(tmp_path, monkeypatch):
    monkeypatch.setenv("ANNA_RESEARCHER_FAKE_TAVILY", "1")
    dispatcher = make_dispatcher(tmp_path)

    def fake_http(request, timeout=None):
        return FakeResponse(
            json.dumps({"results": [{"url": "https://e.com/a", "title": "A", "content": "x"}]}).encode("utf-8")
        )

    dispatcher.executor = ResearchSourceExecutor(
        token_provider=dispatcher._token_for, http_open=fake_http, sleep=lambda _: None
    )
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
    dispatcher.dispatch(
        "app_call_research_source",
        {"research_id": job["research_id"], "iteration": 1, "source_id": "tavily", "queries": ["anna"]},
    )
    with pytest.raises(ValidationError) as exc:
        dispatcher.dispatch(
            "app_call_research_source",
            {"research_id": job["research_id"], "iteration": 2, "source_id": "tavily", "queries": ["Anna"]},
        )
    assert exc.value.data.get("reason") == "duplicate"


def test_call_section_research_source_uses_native_duckduckgo(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    dispatcher.native_executor = NativeResearchSourceExecutor(
        adapters={
            "ddgs": lambda query: [
                {"query": query, "url": "https://duck.example/section", "title": "Section result", "content": "section snippet"},
            ]
        },
        extractor=lambda items, **kwargs: items,
    )
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
    dispatcher.dispatch(
        "app_save_confirmed_research_outline",
        {
            "research_id": job["research_id"],
            "sections": [
                {
                    "id": "section-1",
                    "title": "Background",
                    "outline": "Find background information.",
                    "allowed_source_ids": ["duckduckgo"],
                    "max_iterations": 1,
                }
            ],
        },
    )

    response = dispatcher.dispatch(
        "app_call_section_research_source",
        {
            "research_id": job["research_id"],
            "section_id": "section-1",
            "iteration": 1,
            "source_id": "duckduckgo",
            "queries": ["anna background"],
        },
    )

    call = response["source_call"]
    assert call["section_id"] == "section-1"
    assert call["source_id"] == "duckduckgo"
    assert call["results_count"] == 1
    loaded = dispatcher.jobs.load(job["research_id"])
    item = loaded["section_iterations"]["section-1"][0]["raw_results"][0]
    assert item["source_name"] == "DuckDuckGo"
    assert item["url"] == "https://duck.example/section"


def test_app_search_web_is_removed(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
    with pytest.raises(ValidationError):
        dispatcher.dispatch("app_search_web", {"research_id": job["research_id"], "search_queries": ["anna"]})


def test_app_test_research_source_uses_draft_definition_and_saved_credential(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    dispatcher.dispatch("app_update_research_source_credential", {"id": "tavily", "credential": "tvly-secret-abcd"})

    def fake_http(request, timeout=None):
        return FakeResponse(
            json.dumps({"items": [{"href": "https://draft.example/a", "name": "Draft title", "body": "Draft body"}]}).encode("utf-8")
        )

    dispatcher.executor = ResearchSourceExecutor(
        token_provider=dispatcher._token_for, http_open=fake_http, sleep=lambda _: None
    )
    draft = dict(builtin_tavily_definition())
    draft["result"] = {
        "items_path": "items[]",
        "url": {"mode": "path", "value": "href"},
        "title": {"mode": "path", "value": "name"},
        "content": {"mode": "paths", "value": ["body"]},
    }
    immediate = dispatcher.dispatch(
        "app_test_research_source",
        {"id": "tavily", "definition": draft, "query": "anna"},
    )
    assert "test" not in immediate
    assert "Draft body" not in json.dumps(immediate)
    transfer = immediate["test_transfer"]
    assert transfer["method"] == "GET"
    result = get_json(transfer["url"])["test"]
    assert result["pages"][0]["request"]["body"]["api_key"] == "tvly-secret-abcd"
    assert result["pages"][0]["response"]["json"]["items"][0]["name"] == "Draft title"
    assert result["extracted"][0]["url"] == "https://draft.example/a"
    assert result["extracted"][0]["title"] == "Draft title"


def test_app_test_research_source_uses_native_definition_without_credential(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    dispatcher.native_executor = NativeResearchSourceExecutor(
        adapters={
            "ddgs": lambda query: [
                {"query": query, "url": "https://duck.example/test", "title": "Duck test", "content": "duck test body"},
            ]
        },
        extractor=lambda items, **kwargs: items,
    )

    immediate = dispatcher.dispatch(
        "app_test_research_source",
        {"id": "duckduckgo", "definition": builtin_duckduckgo_definition(), "query": "anna"},
    )

    result = get_json(immediate["test_transfer"]["url"])["test"]
    assert result["source_id"] == "duckduckgo"
    assert result["error"] is None
    assert result["pages"] == []
    assert result["extracted"][0]["url"] == "https://duck.example/test"


# ---------------------------------------------------------------------------
# Source list, credential updates, enabled flag
# ---------------------------------------------------------------------------


def test_app_list_research_sources_returns_builtin(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    sources = dispatcher.dispatch("app_list_research_sources", {})["sources"]
    by_id = {source["id"]: source for source in sources}
    assert list(by_id) == ["tavily", "duckduckgo"]
    assert by_id["tavily"]["kind"] == "builtin"
    assert by_id["tavily"]["credential_status"] == "missing"
    assert by_id["duckduckgo"]["kind"] == "builtin"
    assert by_id["duckduckgo"]["credential_status"] == "configured"


def test_update_research_source_credential_returns_plain_credential_and_clears(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    saved = dispatcher.dispatch(
        "app_update_research_source_credential", {"id": "tavily", "credential": "tvly-secret-abcd"}
    )["source"]
    assert saved["credential_status"] == "configured"
    assert saved["credential"] == "tvly-secret-abcd"
    cleared = dispatcher.dispatch("app_update_research_source_credential", {"id": "tavily", "clear": True})["source"]
    assert cleared["credential_status"] == "missing"
    assert cleared["credential"] == ""


def test_set_research_source_enabled_round_trip(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    disabled = dispatcher.dispatch("app_set_research_source_enabled", {"id": "tavily", "enabled": False})["source"]
    assert disabled["enabled"] is False
    enabled = dispatcher.dispatch("app_set_research_source_enabled", {"id": "tavily", "enabled": True})["source"]
    assert enabled["enabled"] is True


def test_upsert_user_source_persists_and_credential_can_be_added(tmp_path):
    dispatcher = make_dispatcher(tmp_path)
    definition = _user_envelope(id="acme", name="ACME")
    upserted = dispatcher.dispatch(
        "app_upsert_research_source",
        {"definition": definition, "credential": "acme-token-xyz1"},
    )["source"]
    assert upserted["kind"] == "user"
    assert upserted["credential_status"] == "configured"
    listed = dispatcher.dispatch("app_list_research_sources", {})["sources"]
    assert any(s["id"] == "acme" for s in listed)
    dispatcher.dispatch("app_delete_research_source", {"id": "acme"})
    listed_after = dispatcher.dispatch("app_list_research_sources", {})["sources"]
    assert all(s["id"] != "acme" for s in listed_after)


# ---------------------------------------------------------------------------
# Context selector: source-prefixed emission and URL-empty fallback
# ---------------------------------------------------------------------------


def test_selector_emits_source_prefix_and_dedupes_by_url():
    selector = LexicalContextSelector(max_sources=3, max_per_domain=2, context_budget=2000)
    selected = selector.select(
        query="anna app research",
        search_queries=["anna app research"],
        search_results=[
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://example.com/a", "title": "Anna research", "content": "Anna app research context"},
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://example.com/a", "title": "Duplicate", "content": "duplicate"},
            {"query": "anna", "source_id": "acme", "source_name": "ACME", "url": "", "title": "Same title", "content": "anna app research details"},
            {"query": "anna", "source_id": "acme", "source_name": "ACME", "url": "", "title": "Same title", "content": "different body"},
        ],
    )
    text = selected["selected_context"]
    assert "[来源: Tavily]" in text
    assert "[来源: ACME]" in text
    # url-empty entries dedupe on (source_id, title)
    assert selected["source_urls"] == ["https://example.com/a"]
    assert text.count("Same title") == 1
