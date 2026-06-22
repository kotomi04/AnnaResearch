from __future__ import annotations

import json
import subprocess
import sys
import urllib.request

import pytest

from conftest import TOOL_DIR, isolated_env


class PluginProcess:
    def __init__(self, tmp_path):
        self.proc = subprocess.Popen(
            [sys.executable, "researcher_plugin.py"],
            cwd=TOOL_DIR,
            env=isolated_env(tmp_path),
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
        assert self.proc.stdin is not None
        assert self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        assert line, self.proc.stderr.read() if self.proc.stderr else "no response"
        response = json.loads(line)
        assert response["id"] == req_id
        return response


def test_describe_v2_app_methods_only(tmp_path):
    plugin = PluginProcess(tmp_path)
    try:
        init = plugin.call("initialize", {"protocolVersion": "2.0"})
        assert init["result"]["protocolVersion"] == "2.0"
        assert init["result"]["client_capabilities"] == {}
        describe = plugin.call("describe")
        assert describe["result"]["name"] == "tool-test-researcher-12345678"
        assert describe["result"]["version"] == "0.2.0"
        assert "host_capabilities" not in describe["result"]
        tools = [tool["name"] for tool in describe["result"]["tools"]]
        assert "research" not in tools
        assert "app_search_web" not in tools
        assert "app_call_research_source" in tools
        assert "app_list_research_jobs" in tools
        assert "app_list_research_sources" in tools
        assert "app_test_research_source" in tools
        assert "app_update_research_source_credential" in tools
        assert all(name.startswith("app_") for name in tools)
        health = plugin.call("health")
        assert health["result"]["status"] == "healthy"
    finally:
        plugin.close()


def test_app_call_research_source_lifecycle(tmp_path):
    plugin = PluginProcess(tmp_path)
    try:
        plugin.call("initialize", {"protocolVersion": "2.0"})

        sources = plugin.call("invoke", {"tool": "app_list_research_sources", "arguments": {}})
        ids = [s["id"] for s in sources["result"]["data"]["sources"]]
        assert "tavily" in ids

        saved = plugin.call(
            "invoke",
            {"tool": "app_update_research_source_credential", "arguments": {"id": "tavily", "credential": "tvly-test-secret"}},
        )
        view = saved["result"]["data"]["source"]
        assert view["credential_status"] == "configured"
        assert view["credential"] == "tvly-test-secret"

        created = plugin.call("invoke", {"tool": "app_create_research_job", "arguments": {"query": "anna app adapter"}})
        research_id = created["result"]["data"]["job"]["research_id"]

        call = plugin.call(
            "invoke",
            {
                "tool": "app_call_research_source",
                "arguments": {
                    "research_id": research_id,
                    "iteration": 1,
                    "source_id": "tavily",
                    "queries": ["anna app adapter"],
                },
            },
        )
        source_call = call["result"]["data"]["source_call"]
        assert source_call["source_id"] == "tavily"
        assert source_call["results_count"] >= 1
        assert all("items" not in entry for entry in source_call["calls"])

        selected = plugin.call("invoke", {"tool": "app_select_context", "arguments": {"research_id": research_id}})
        assert selected["result"]["data"]["selected_context"]

        transfer_response = plugin.call("invoke", {"tool": "app_save_research_result", "arguments": {"research_id": research_id}})
        transfer = transfer_response["result"]["data"]["transfer"]
        assert transfer["method"] == "POST"
        assert "report_markdown" not in json.dumps(transfer)
        saved = post_json(transfer["url"], {"report_markdown": "# Research Report"})
        assert saved["result"]["report_markdown"] == "# Research Report"
    finally:
        plugin.close()


def test_legacy_app_search_web_is_rejected(tmp_path):
    plugin = PluginProcess(tmp_path)
    try:
        plugin.call("initialize", {"protocolVersion": "2.0"})
        created = plugin.call("invoke", {"tool": "app_create_research_job", "arguments": {"query": "anna"}})
        research_id = created["result"]["data"]["job"]["research_id"]
        rejected = plugin.call(
            "invoke",
            {"tool": "app_search_web", "arguments": {"research_id": research_id, "search_queries": ["anna"]}},
        )
        # tool is unknown after Slice 1; the plugin returns a JSON-RPC error
        assert "error" in rejected
        assert "app_search_web" in rejected["error"]["message"]
    finally:
        plugin.close()


def post_json(url: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))
