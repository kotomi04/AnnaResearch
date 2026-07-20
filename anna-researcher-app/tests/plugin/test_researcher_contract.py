from __future__ import annotations

import json
import subprocess
import sys

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
        assert init["result"]["client_capabilities"] == {"embeddings": {}, "storage": {}}
        assert init["result"]["capabilities"] == {"sampling": {}}
        describe = plugin.call("describe")
        assert describe["result"]["name"] == "tool-xhz-researcher-python-e7k8xa3s"
        assert describe["result"]["version"] == "0.3.0"
        assert describe["result"]["host_capabilities"] == ["llm.embed", "llm.sample", "storage.app"]
        tools = [tool["name"] for tool in describe["result"]["tools"]]
        assert "research" not in tools
        assert "app_search_web" not in tools
        assert "app_call_section_research_source" in tools
        assert "app_generate_outline_draft" in tools
        assert "app_get_section_result" in tools
        assert "app_get_research_job_payload" in tools
        assert "app_call_outline_discovery_source" not in tools
        assert "app_select_outline_discovery_context" not in tools
        assert "app_save_outline_query_plan" not in tools
        assert "app_list_research_jobs" in tools
        assert "app_list_research_sources" in tools
        assert "app_test_research_source" in tools
        assert "app_update_research_source_credential" in tools
        assert {
            "app_update_settings",
            "app_call_research_source",
            "app_select_context",
            "app_fail_section",
            "app_save_research_result",
            "app_embed_texts",
        }.isdisjoint(tools)
        assert all(name.startswith("app_") for name in tools)
        assert not any(name.startswith("agent_") for name in tools)
        health = plugin.call("health")
        assert health["result"]["status"] == "healthy"
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
