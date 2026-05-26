from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
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
    created = dispatcher.dispatch("app_create_research_job", {"query": "Anna App", "query_domains": "HTTPS://Example.com/, docs.example.com"})
    job = created["job"]
    assert_true(job["research_id"].startswith("research_"), "job should have id")
    loaded = dispatcher.dispatch("app_get_research_job", {})["job"]
    assert_true(loaded["research_id"] == job["research_id"], "latest job should load")
    updated = dispatcher.dispatch("app_update_research_job", {"research_id": job["research_id"], "updates": {"stage": "plan_queries", "progress": 25}})
    assert_true(updated["job"]["stage"] == "plan_queries", "metadata should update")
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


def test_search_context_result(tmp_path: Path):
    os.environ["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
    dispatcher = make_dispatcher(tmp_path)
    dispatcher.dispatch("app_update_settings", {"tavily_api_key": "tvly-test-secret"})
    job = dispatcher.dispatch("app_create_research_job", {"query": "anna researcher", "query_domains": ["example.com"]})["job"]
    research_id = job["research_id"]
    search = dispatcher.dispatch("app_search_web", {"research_id": research_id, "search_queries": ["anna researcher", "anna app research"], "query_domains": "example.com"})
    assert_true(len(search["search_results"]) > 0, "search should return fake results")
    assert_true(len(search["source_urls"]) == len(set(search["source_urls"])), "search urls should dedupe")
    selected = dispatcher.dispatch("app_select_context", {"research_id": research_id})
    assert_true(bool(selected["selected_context"]), "context should be selected")
    saved = dispatcher.dispatch(
        "app_save_research_result",
        {
            "research_id": research_id,
            "report_markdown": "# Research Report\n\nDone",
            "source_urls": selected["source_urls"],
            "selected_sources": selected["selected_sources"],
        },
    )
    assert_true(saved["result"]["report_markdown"].startswith("# Research Report"), "result should persist")
    loaded = dispatcher.dispatch("app_get_research_job", {"research_id": research_id})["job"]
    assert_true(loaded["result"]["report_markdown"].startswith("# Research Report"), "loaded job should include result")


def test_search_requires_settings(tmp_path: Path):
    old = os.environ.pop("ANNA_RESEARCHER_FAKE_TAVILY", None)
    try:
        dispatcher = make_dispatcher(tmp_path)
        job = dispatcher.dispatch("app_create_research_job", {"query": "anna"})["job"]
        try:
            dispatcher.dispatch("app_search_web", {"research_id": job["research_id"], "search_queries": ["anna"]})
            raise AssertionError("missing Tavily key should fail")
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
            {"query": "anna", "url": "https://example.com/a", "title": "Anna research", "content": "Anna app research context"},
            {"query": "anna", "url": "https://example.com/a", "title": "Duplicate", "content": "duplicate"},
            {"query": "anna", "url": "https://example.com/b", "title": "Same domain", "content": "anna app same domain"},
            {"query": "anna", "url": "https://docs.example.org/c", "title": "Context selector", "content": "research context selector evidence"},
        ],
    )
    assert_true(selected["source_urls"] == ["https://example.com/a", "https://docs.example.org/c"], "selector should dedupe and limit domains")


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
        assert_true(all(name.startswith("app_") for name in tools), "all methods should be app methods")
        health = plugin.call("health")
        assert_true(health["result"]["status"] == "healthy", "health should pass")
        settings = plugin.call("invoke", {"tool": "app_get_settings", "arguments": {}})
        assert_true(settings["result"]["success"] is True, "app_get_settings should invoke")
    finally:
        plugin.close()


def test_bundle_contract():
    bundle_js = "\n".join(path.read_text(encoding="utf-8") for path in (APP_ROOT / "bundle").glob("assets/*.js"))
    manifest = (APP_ROOT / "manifest.json").read_text(encoding="utf-8")
    assert_true("tool-test-researcher-12345678" in manifest, "manifest should reference tool")
    assert_true('"min_version":"0.2.0"' in manifest.replace(" ", ""), "manifest should require tool 0.2.0")
    assert_true('"llm":["complete"]' in manifest.replace(" ", ""), "manifest should authorize llm.complete")
    assert_true('method:"research"' not in bundle_js and 'method: "research"' not in bundle_js, "bundle should not call legacy research method")
    assert_true('"action":"advance"' not in bundle_js and 'action:"advance"' not in bundle_js, "bundle should not contain legacy advance action")


def main():
    tests = [
        ("settings", test_settings),
        ("job_shell", test_job_shell),
        ("search_context_result", test_search_context_result),
        ("search_requires_settings", test_search_requires_settings),
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
