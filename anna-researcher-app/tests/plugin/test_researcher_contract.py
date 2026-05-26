from __future__ import annotations

import json
import subprocess
import sys

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
        assert all(name.startswith("app_") for name in tools)
        health = plugin.call("health")
        assert health["result"]["status"] == "healthy"
    finally:
        plugin.close()


def test_settings_job_search_context_result_lifecycle(tmp_path):
    plugin = PluginProcess(tmp_path)
    try:
        plugin.call("initialize", {"protocolVersion": "2.0"})
        settings = plugin.call("invoke", {"tool": "app_update_settings", "arguments": {"tavily_api_key": "tvly-test-secret"}})
        assert settings["result"]["success"] is True
        assert settings["result"]["data"]["settings"]["tavily"]["configured"] is True

        created = plugin.call("invoke", {"tool": "app_create_research_job", "arguments": {"query": "anna app adapter"}})
        research_id = created["result"]["data"]["job"]["research_id"]

        search = plugin.call("invoke", {"tool": "app_search_web", "arguments": {"research_id": research_id, "search_queries": ["anna app adapter"]}})
        assert search["result"]["data"]["search_results"]

        selected = plugin.call("invoke", {"tool": "app_select_context", "arguments": {"research_id": research_id}})
        assert selected["result"]["data"]["selected_context"]

        saved = plugin.call("invoke", {"tool": "app_save_research_result", "arguments": {"research_id": research_id, "report_markdown": "# Research Report"}})
        assert saved["result"]["data"]["result"]["report_markdown"] == "# Research Report"
    finally:
        plugin.close()

