from __future__ import annotations

import json
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[2]


def test_manifest_uses_refactored_tool_contract():
    manifest = json.loads((APP_ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["required_executas"][0]["tool_id"] == "tool-test-researcher-12345678"
    assert manifest["required_executas"][0]["min_version"] == "0.2.0"
    assert manifest["ui"]["host_api"]["llm"] == ["complete"]
    assert manifest["ui"]["views"][0]["default_size"] == {"w": 1040, "h": 760}
    assert manifest["ui"]["views"][0]["max_size"] == {"w": 1080, "h": 960}


def test_bundle_does_not_contain_legacy_research_action_contract():
    bundle_js = "\n".join(path.read_text(encoding="utf-8") for path in (APP_ROOT / "bundle").glob("assets/*.js"))
    assert 'method:"research"' not in bundle_js
    assert 'method: "research"' not in bundle_js
    assert 'action:"advance"' not in bundle_js
    assert '"action":"advance"' not in bundle_js
    # Legacy tavily-bespoke surfaces must be gone after Slice 1
    assert "app_search_web" not in bundle_js
    assert "query_domains" not in bundle_js
    # New unified Research Source surface must be present
    assert "app_create_research_job" in bundle_js
    assert "app_save_research_result" in bundle_js
    assert "app_call_research_source" in bundle_js
    assert "app_list_research_jobs" in bundle_js
    assert "app_list_research_sources" in bundle_js
    assert "app_update_research_source_credential" in bundle_js
    assert "uploadResearchResult" in bundle_js
    assert "selected_sources" not in bundle_js
    # Slice 2: iterative loop is owned by the frontend
    assert "decide_next_action" in bundle_js
    assert "max_iterations" in bundle_js
    # Slice 3: user-source CRUD surface is wired in the bundle
    assert "app_upsert_research_source" in bundle_js
    assert "app_delete_research_source" in bundle_js
    assert "app_set_research_source_enabled" in bundle_js
    assert "app_test_research_source" in bundle_js
