from __future__ import annotations

import json
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]


def test_manifest_uses_refactored_tool_contract():
    manifest = json.loads((APP_ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["required_executas"][0]["tool_id"] == "tool-test-researcher-12345678"
    assert manifest["required_executas"][0]["min_version"] == "0.2.0"
    assert manifest["ui"]["host_api"]["llm"] == ["complete"]


def test_bundle_does_not_contain_legacy_research_action_contract():
    bundle_js = "\n".join(path.read_text(encoding="utf-8") for path in (APP_ROOT / "bundle").glob("assets/*.js"))
    assert 'method:"research"' not in bundle_js
    assert 'method: "research"' not in bundle_js
    assert 'action:"advance"' not in bundle_js
    assert '"action":"advance"' not in bundle_js
    assert "app_create_research_job" in bundle_js
    assert "app_save_research_result" in bundle_js
