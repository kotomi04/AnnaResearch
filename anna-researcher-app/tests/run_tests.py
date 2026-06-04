from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_ROOT.parent
TOOL_DIR = REPO_ROOT / "researcher-tool"
sys.path.insert(0, str(TOOL_DIR))

from researcher_tool.context_selector import LexicalContextSelector  # noqa: E402
from researcher_tool.dispatcher import AppDispatcher  # noqa: E402
from researcher_tool.errors import ConfigurationError, NotFoundError, ValidationError  # noqa: E402
from researcher_tool.job_store import JobStore  # noqa: E402
from researcher_tool.settings import SettingsStore  # noqa: E402


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def make_dispatcher(tmp_path: Path) -> AppDispatcher:
    root = tmp_path / ".research"
    return AppDispatcher(settings=SettingsStore(root=root), jobs=JobStore(root=root), selector=LexicalContextSelector(max_sources=4, context_budget=4000))


def test_settings(tmp_path: Path):
    dispatcher = make_dispatcher(tmp_path)
    settings = dispatcher.dispatch("app_get_settings", {})["settings"]
    assert_true(settings["tavily"]["configured"] is False, "settings should start unconfigured")
    updated = dispatcher.dispatch("app_update_settings", {"tavily_api_key": "tvly-test-secret"})["settings"]
    assert_true(updated["tavily"]["configured"] is True, "settings should become configured")
    assert_true("secret" not in updated["tavily"]["masked"], "settings should mask key")
    cleared = dispatcher.dispatch("app_update_settings", {"clear_tavily_api_key": True})["settings"]
    assert_true(cleared["tavily"]["configured"] is False, "settings should clear")


def test_job_shell(tmp_path: Path):
    dispatcher = make_dispatcher(tmp_path)
    created = dispatcher.dispatch("app_create_research_job", {"query": "Anna App"})
    job = created["job"]
    assert_true(job["research_id"].startswith("research_"), "job should have id")
    loaded = dispatcher.dispatch("app_get_research_job", {})["job"]
    assert_true(loaded["research_id"] == job["research_id"], "latest job should load")
    assert_true(loaded["schema_version"] == 2, "loaded job should advertise v2")
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
    assert_true(updated["job"]["stage"] == "search_next_query", "metadata should update")
    assert_true(updated["job"]["progress"] == 25, "progress should update")
    assert_true(updated["job"]["iteration"] == 1, "iteration should update")
    assert_true(updated["job"]["max_iterations"] == 5, "max_iterations should update")
    try:
        dispatcher.dispatch("app_update_research_job", {"research_id": job["research_id"], "updates": {"tavily_api_key": "leak"}})
        raise AssertionError("secret-like field should be rejected")
    except ValidationError:
        pass
    empty = AppDispatcher(settings=SettingsStore(root=tmp_path / "empty"), jobs=JobStore(root=tmp_path / "empty"))
    assert_true(empty.dispatch("app_get_research_job", {})["job"] is None, "empty latest should be null")
    try:
        dispatcher.dispatch("app_get_research_job", {"research_id": "missing"})
        raise AssertionError("missing explicit id should fail")
    except NotFoundError:
        pass


def test_call_research_source_context_result(tmp_path: Path):
    os.environ["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna researcher"})["job"]
    research_id = job["research_id"]
    call = dispatcher.dispatch(
        "app_call_research_source",
        {"research_id": research_id, "iteration": 1, "source_id": "tavily", "queries": ["anna researcher", "anna app research"]},
    )
    assert_true(call["source_call"]["results_count"] > 0, "call should return synthetic results")
    assert_true(all("items" not in c for c in call["source_call"]["calls"]), "items must be stripped from public payload")
    selected = dispatcher.dispatch("app_select_context", {"research_id": research_id})
    assert_true("selected_context" not in selected, "context should not return through stdio")
    context = get_json(selected["context_transfer"]["url"])
    assert_true(bool(context["selected_context"]), "context should be selected")
    assert_true("[来源:" in context["selected_context"], "context items must carry source prefix")
    transfer = dispatcher.dispatch("app_save_research_result", {"research_id": research_id})["transfer"]
    assert_true(transfer["method"] == "POST", "save should return transfer descriptor")
    saved = post_json(transfer["url"], {"report_markdown": "# Research Report\n\nDone", "source_urls": context["source_urls"]})
    assert_true(saved["result"]["report_markdown"].startswith("# Research Report"), "result should persist")
    assert_true("sources" not in saved["result"], "http result should be compact")
    loaded = dispatcher.dispatch("app_get_research_job", {"research_id": research_id})["job"]
    assert_true("report_markdown" not in loaded["result"], "loaded job should not include full result markdown")
    restored = get_json(loaded["result_transfer"]["url"])
    assert_true(restored["result"]["report_markdown"].startswith("# Research Report"), "result transfer should restore markdown")
    assert_true("search_results" not in loaded, "loaded job should be compact")
    assert_true(loaded["iterations"], "loaded job should expose iterations")
    assert_true(all("raw_results" not in it for it in loaded["iterations"]), "raw_results must never leave the backend")


def test_result_transfer_http(tmp_path: Path):
    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
    first = dispatcher.dispatch("app_save_research_result", {"research_id": job["research_id"]})["transfer"]
    second = dispatcher.dispatch("app_save_research_result", {"research_id": job["research_id"]})["transfer"]
    assert_true(first["url"] == second["url"], "transfer server should be singleton")
    options = urllib.request.Request(first["url"], method="OPTIONS")
    with urllib.request.urlopen(options, timeout=5) as response:
        assert_true(response.status == 204, "preflight should succeed")
        assert_true(response.headers["Access-Control-Allow-Origin"] == "*", "cors should allow any origin")
        assert_true(response.headers["Access-Control-Allow-Private-Network"] == "true", "private network preflight should be allowed")
    try:
        post_json(first["url"], {"report_markdown": " "})
        raise AssertionError("blank report should fail")
    except urllib.error.HTTPError as exc:
        assert_true(exc.code == 400, "blank report should return 400")


def test_section_large_payload_transfer(tmp_path: Path):
    os.environ["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna section"})["job"]
    research_id = job["research_id"]
    dispatcher.dispatch(
        "app_save_confirmed_research_outline",
        {
            "research_id": research_id,
            "sections": [
                {
                    "id": "section-1",
                    "title": "Section One",
                    "outline": "Cover Anna section evidence.",
                    "allowed_source_ids": ["tavily"],
                    "max_iterations": 1,
                }
            ],
        },
    )
    dispatcher.dispatch(
        "app_call_section_research_source",
        {"research_id": research_id, "section_id": "section-1", "iteration": 1, "source_id": "tavily", "queries": ["anna section"]},
    )
    selected = dispatcher.dispatch("app_select_section_context", {"research_id": research_id, "section_id": "section-1"})
    assert_true("selected_context" not in selected, "section context should not return through stdio")
    section_context = get_json(selected["context_transfer"]["url"])
    assert_true(bool(section_context["selected_context"]), "section context transfer should return context")
    assert_true("selected_context" not in selected["job"]["section_selected_context"]["section-1"], "job view should not include section context text")
    section_transfer = dispatcher.dispatch("app_save_section_result", {"research_id": research_id, "section_id": "section-1"})["transfer"]
    section_saved = post_json(
        section_transfer["url"],
        {
            "section_markdown": "## Section One\n\n" + ("large section. " * 200),
            "section_summary": "large section summary",
            "source_urls": section_context["source_urls"],
            "status": "completed",
        },
    )
    assert_true(section_saved["section_result"]["section_markdown"].startswith("## Section One"), "section result transfer should save markdown")
    loaded = dispatcher.dispatch("app_get_research_job", {"research_id": research_id})["job"]
    assert_true("section_markdown" not in loaded["section_results"]["section-1"], "job view should not include section markdown")
    assembled_transfer = dispatcher.dispatch("app_save_assembled_research_result", {"research_id": research_id})["transfer"]
    assembled = post_json(
        assembled_transfer["url"],
        {"report_markdown": "# Final\n\n" + ("assembled report. " * 200), "source_urls": section_context["source_urls"]},
    )
    assert_true(assembled["result"]["report_markdown"].startswith("# Final"), "assembled result transfer should save final report")
    final_job = dispatcher.dispatch("app_get_research_job", {"research_id": research_id})["job"]
    assert_true("report_markdown" not in final_job["result"], "final job view should not include full report")
    assert_true(final_job["result_transfer"]["method"] == "GET", "final job should expose result read transfer")


def test_call_research_source_requires_credential(tmp_path: Path):
    old = os.environ.pop("ANNA_RESEARCHER_FAKE_TAVILY", None)
    try:
        dispatcher = make_dispatcher(tmp_path)
        job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
        try:
            dispatcher.dispatch(
                "app_call_research_source",
                {"research_id": job["research_id"], "iteration": 1, "source_id": "tavily", "queries": ["anna"]},
            )
            raise AssertionError("missing Tavily credential should fail")
        except ConfigurationError:
            pass
    finally:
        if old is not None:
            os.environ["ANNA_RESEARCHER_FAKE_TAVILY"] = old


def test_selector():
    selector = LexicalContextSelector(max_sources=2, max_per_domain=1, context_budget=700)
    selected = selector.select(
        query="anna app research",
        search_queries=["anna app research"],
        search_results=[
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://example.com/a", "title": "Anna research", "content": "Anna app research context"},
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://example.com/a", "title": "Duplicate", "content": "duplicate"},
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://example.com/b", "title": "Same domain", "content": "anna app same domain"},
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://docs.example.org/c", "title": "Context selector", "content": "research context selector evidence"},
        ],
    )
    assert_true(selected["source_urls"] == ["https://example.com/a", "https://docs.example.org/c"], "selector should dedupe and limit domains")
    assert_true("[来源: Tavily]" in selected["selected_context"], "selector should emit source prefix")


class PluginProcess:
    def __init__(self, tmp_path: Path):
        env = os.environ.copy()
        env["ANNA_RESEARCHER_WORKSPACE"] = str(tmp_path)
        env["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
        env.pop("TAVILY_API_KEY", None)
        self.proc = subprocess.Popen(
            [sys.executable, "researcher_plugin.py"],
            cwd=TOOL_DIR,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.next_id = 1

    def close(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            self.proc.wait(timeout=5)

    def call(self, method, params=None):
        req_id = self.next_id
        self.next_id += 1
        payload = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            payload["params"] = params
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise AssertionError(self.proc.stderr.read())
        response = json.loads(line)
        assert_true(response["id"] == req_id, "response id should match")
        return response


def test_plugin_contract(tmp_path: Path):
    plugin = PluginProcess(tmp_path)
    try:
        init = plugin.call("initialize", {"protocolVersion": "2.0"})
        assert_true(init["result"]["protocolVersion"] == "2.0", "initialize should negotiate v2")
        assert_true(init["result"].get("client_capabilities") == {}, "tool should not declare sampling")
        describe = plugin.call("describe")
        tools = [tool["name"] for tool in describe["result"]["tools"]]
        assert_true(describe["result"]["name"] == "tool-test-researcher-12345678", "describe should advertise tool")
        assert_true(describe["result"]["version"] == "0.2.0", "describe should advertise breaking version")
        assert_true("research" not in tools, "legacy research method should be absent")
        assert_true("app_search_web" not in tools, "legacy app_search_web must be removed")
        assert_true("app_call_research_source" in tools, "new app_call_research_source must be advertised")
        assert_true("app_list_research_sources" in tools, "new app_list_research_sources must be advertised")
        assert_true("app_test_research_source" in tools, "source test method must be advertised")
        assert_true(all(name.startswith("app_") for name in tools), "all methods should be app methods")
        health = plugin.call("health")
        assert_true(health["result"]["status"] == "healthy", "health should pass")
        settings = plugin.call("invoke", {"tool": "app_get_settings", "arguments": {}})
        assert_true(settings["result"]["success"] is True, "app_get_settings should invoke")
    finally:
        plugin.close()


def post_json(url: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url: str):
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def test_bundle_contract():
    bundle_js = "\n".join(path.read_text(encoding="utf-8") for path in (APP_ROOT / "bundle").glob("assets/*.js"))
    manifest = (APP_ROOT / "manifest.json").read_text(encoding="utf-8")
    assert_true("tool-test-researcher-12345678" in manifest, "manifest should reference tool")
    assert_true('"min_version":"0.2.0"' in manifest.replace(" ", ""), "manifest should require tool 0.2.0")
    assert_true('"llm":["complete"]' in manifest.replace(" ", ""), "manifest should authorize llm.complete")
    assert_true('method:"research"' not in bundle_js and 'method: "research"' not in bundle_js, "bundle should not call legacy research method")
    assert_true('"action":"advance"' not in bundle_js and 'action:"advance"' not in bundle_js, "bundle should not contain legacy advance action")
    assert_true("app_search_web" not in bundle_js, "bundle should not reference legacy app_search_web")
    assert_true("query_domains" not in bundle_js, "bundle should not reference query_domains")


def main():
    tests = [
        ("settings", test_settings),
        ("job_shell", test_job_shell),
        ("call_research_source", test_call_research_source_context_result),
        ("result_transfer_http", test_result_transfer_http),
        ("section_large_payload_transfer", test_section_large_payload_transfer),
        ("call_requires_credential", test_call_research_source_requires_credential),
        ("selector", lambda tmp: test_selector()),
        ("plugin_contract", test_plugin_contract),
        ("bundle_contract", lambda tmp: test_bundle_contract()),
    ]
    with tempfile.TemporaryDirectory() as root:
        root_path = Path(root)
        for name, fn in tests:
            tmp = root_path / name
            tmp.mkdir()
            fn(tmp)
            print(f"ok {name}")


if __name__ == "__main__":
    main()
