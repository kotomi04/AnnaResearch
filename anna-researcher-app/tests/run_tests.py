from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_DIR = APP_ROOT / "executas" / "researcher-python"
sys.path.insert(0, str(PLUGIN_DIR))

from researcher_adapter.context_selector import LexicalContextSelector  # noqa: E402
from researcher_adapter.dispatcher import ResearchDispatcher  # noqa: E402
from researcher_adapter.errors import InvalidActionError, NotReadyError  # noqa: E402
from researcher_adapter.job_store import JobStore  # noqa: E402
from researcher_adapter.orchestrator import AnnaResearchOrchestrator  # noqa: E402
from researcher_adapter.sampling_llm import DEFAULT_SAMPLING_TIMEOUT_SECONDS, SamplingClient  # noqa: E402
from researcher_adapter.tavily_retrieval import TavilySummaryRetriever  # noqa: E402


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def make_orchestrator():
    return AnnaResearchOrchestrator(
        sampling=SamplingClient(fake=True),
        retriever=TavilySummaryRetriever(fake=True),
        selector=LexicalContextSelector(max_sources=4, context_budget=4000),
    )


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


def test_orchestrator(tmp_path: Path):
    store = JobStore(root=tmp_path, jobs_id="test")
    job = store.create(query="anna app adapter", query_domains=["example.com"])
    orchestrator = make_orchestrator()
    for _ in range(10):
        job = asyncio.run(orchestrator.advance(job, invoke_id="invoke-test"))
        store.save(job)
        if job["status"] == "completed":
            break
    assert_true(job["status"] == "completed", "orchestrator should complete")
    assert_true(job["report_markdown"].startswith("# Research Report"), "report should be markdown")
    assert_true(bool(job["source_urls"]), "source urls should be present")


def test_dispatcher(tmp_path: Path):
    dispatcher = ResearchDispatcher(store=JobStore(root=tmp_path, jobs_id="test"), orchestrator=make_orchestrator())
    first = dispatcher.start({"query": "anna researcher"})
    second = dispatcher.start({"query": "another"})
    assert_true(first["active"] is False, "first start should create")
    assert_true(second["active"] is True, "second start should report active")
    try:
        asyncio.run(dispatcher.dispatch({"action": "unknown"}))
        raise AssertionError("invalid action should raise")
    except InvalidActionError:
        pass
    try:
        dispatcher.get_result({"research_id": first["job"]["research_id"]})
        raise AssertionError("incomplete result should raise")
    except NotReadyError:
        pass


class PluginProcess:
    def __init__(self, tmp_path: Path):
        env = os.environ.copy()
        env["ANNA_RESEARCHER_WORKSPACE"] = str(tmp_path)
        env["ANNA_RESEARCHER_FAKE_SAMPLING"] = "1"
        env["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
        env.pop("TAVILY_API_KEY", None)
        self.proc = subprocess.Popen(
            [sys.executable, "researcher_plugin.py"],
            cwd=PLUGIN_DIR,
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
        describe = plugin.call("describe")
        assert_true(describe["result"]["name"] == "tool-test-researcher-12345678", "describe should advertise tool")
        start = plugin.call("invoke", {"tool": "research", "arguments": {"action": "start", "query": "anna app adapter"}})
        research_id = start["result"]["data"]["job"]["research_id"]
        job = None
        for _ in range(10):
            advance = plugin.call("invoke", {"tool": "research", "arguments": {"action": "advance", "research_id": research_id}, "invoke_id": "invoke-test"})
            job = advance["result"]["data"]["job"]
            if job["status"] == "completed":
                break
        assert_true(job and job["status"] == "completed", "plugin lifecycle should complete")
        result = plugin.call("invoke", {"tool": "research", "arguments": {"action": "get_result", "research_id": research_id}})
        payload = result["result"]["data"]["result"]
        assert_true(payload["report_markdown"].startswith("# Research Report"), "plugin should return report")
    finally:
        plugin.close()


def test_bundle_contract():
    bundle_js = "\n".join(path.read_text(encoding="utf-8") for path in (APP_ROOT / "bundle").glob("assets/*.js"))
    index = (APP_ROOT / "bundle" / "index.html").read_text(encoding="utf-8")
    manifest = (APP_ROOT / "manifest.json").read_text(encoding="utf-8")
    assert_true('"start"' in bundle_js, "bundle should start")
    assert_true('"advance"' in bundle_js, "bundle should advance")
    assert_true('"get_result"' in bundle_js, "bundle should get result")
    assert_true('"get_status"' in bundle_js, "bundle should keep status action typed")
    assert_true("query_domains" in bundle_js, "bundle should pass domain filters")
    assert_true("tool-test-researcher-12345678" in bundle_js, "bundle should invoke required tool")
    assert_true("/static/anna-apps/_sdk/0.1.0/index.js" in index, "bundle should load Anna SDK")
    assert_true('type="module"' in index, "bundle should load generated module entry")
    report_view_source = (APP_ROOT / "src" / "components" / "ReportView.tsx").read_text(encoding="utf-8")
    assert_true("dangerouslySetInnerHTML" not in report_view_source, "report view should not use raw React HTML injection")
    assert_true("innerHTML" not in report_view_source, "report view should not use raw DOM HTML injection")
    assert_true("tool-test-researcher-12345678" in manifest, "manifest should reference tool")


def test_sampling_timeout_budget():
    assert_true(DEFAULT_SAMPLING_TIMEOUT_SECONDS < 45, "sampling timeout should return before frontend RPC timeout")


def main():
    tests = [
        ("selector", lambda tmp: test_selector()),
        ("orchestrator", test_orchestrator),
        ("dispatcher", test_dispatcher),
        ("plugin_contract", test_plugin_contract),
        ("bundle_contract", lambda tmp: test_bundle_contract()),
        ("sampling_timeout_budget", lambda tmp: test_sampling_timeout_budget()),
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
