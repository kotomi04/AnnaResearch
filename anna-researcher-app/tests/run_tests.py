from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = APP_ROOT.parent
TOOL_DIR = REPO_ROOT / "researcher-tool"
sys.path.insert(0, str(TOOL_DIR))

from researcher_tool.context_selector import LexicalContextSelector  # noqa: E402
from researcher_tool import attachment_embeddings as attachment_embeddings_module  # noqa: E402
from researcher_tool.dispatcher import AppDispatcher  # noqa: E402
from researcher_tool.attachment_embeddings import embed_attachment_chunks  # noqa: E402
from researcher_tool.embedding import MAX_PARALLEL_EMBEDDING_BATCHES, AnnaEmbeddingsClient, EmbeddingBatchOutcome, EmbeddingsError  # noqa: E402
from researcher_tool.errors import NotFoundError, ValidationError  # noqa: E402
from researcher_tool.job_store import JobStore  # noqa: E402
from researcher_tool.attachment_summary import select_attachment_context  # noqa: E402
from researcher_tool.settings import SettingsStore  # noqa: E402
from researcher_tool.sources.native import duckduckgo as duckduckgo_native  # noqa: E402


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def make_dispatcher(tmp_path: Path) -> AppDispatcher:
    root = tmp_path / ".research"
    return AppDispatcher(settings=SettingsStore(root=root), jobs=JobStore(root=root), selector=LexicalContextSelector(max_sources=4, context_budget=4000))


class FakeEmbeddings:
    def __init__(self):
        self.wave_sizes = []

    def create(self, *, texts, model="anna-managed-v1", timeout=30.0):
        return {"data": [{"embedding": [1.0, float(index + 1)]} for index, _ in enumerate(texts)], "_meta": {"dimensions": 2}}

    def create_batches(self, *, batches, model="anna-managed-v1", timeout=30.0):
        return [self.create(texts=batch, model=model, timeout=timeout) for batch in batches]

    def create_batches_settled(self, *, batches, model="anna-managed-v1", timeout=30.0):
        self.wave_sizes.append(len(batches))
        return [EmbeddingBatchOutcome(result=self.create(texts=batch, model=model, timeout=timeout)) for batch in batches]


def test_settings(tmp_path: Path):
    dispatcher = make_dispatcher(tmp_path)
    settings = dispatcher.dispatch("app_get_settings", {})["settings"]
    assert_true(settings["tavily"]["configured"] is False, "settings should start unconfigured")
    assert_true(settings["research_root"] == str(tmp_path / ".research"), "settings should expose actual research root")


def test_job_shell(tmp_path: Path):
    dispatcher = make_dispatcher(tmp_path)
    created = dispatcher.dispatch("app_create_research_job", {"query": "Anna App"})
    job = created["job"]
    assert_true(job["research_id"].startswith("research_"), "job should have id")
    assert_true(
        dispatcher.jobs.path_for(job["research_id"]).name == "job.json",
        "job store should use directory-backed job.json",
    )
    assert_true(
        dispatcher.jobs.path_for(job["research_id"]).exists(),
        "job directory should contain job.json",
    )
    assert_true(
        not (dispatcher.jobs.jobs_dir / f"{job['research_id']}.json").exists(),
        "job store should not write legacy flat job json",
    )
    assert_true(
        not (dispatcher.jobs.job_dir_for(job["research_id"]) / "section_results.json").exists(),
        "job directory should not write empty split section result store",
    )
    assert_true(
        not (dispatcher.jobs.root / "latest_research_id").exists(),
        "job store should not maintain a latest_research_id file",
    )
    loaded_status = dispatcher.dispatch("app_get_research_job", {})["job"]
    assert_true(loaded_status["schema_version"] == 4, "get job without id should return the most recently updated compact job")
    assert_true(all("raw_results" not in it for it in loaded_status["iterations"]), "compact stdio job should not expose raw_results")
    loaded = get_json(loaded_status["job_transfer"]["url"])["job"] if loaded_status.get("job_transfer") else loaded_status
    assert_true(loaded["research_id"] == job["research_id"], "latest job should load")
    assert_true(loaded["schema_version"] == 4, "loaded job should advertise v4")
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
    second = dispatcher.dispatch("app_create_research_job", {"query": "Second research"})["job"]
    listed = dispatcher.dispatch("app_list_research_jobs", {"limit": 10})["jobs"]
    assert_true(len(listed) == 2, "job list should include created jobs")
    listed_ids = {job["research_id"] for job in listed}
    assert_true(second["research_id"] in listed_ids and job["research_id"] in listed_ids, "job list should include both ids")
    assert_true(any(item["query"] == "Second research" for item in listed), "job list should include compact query")
    dispatcher.dispatch(
        "app_update_research_job",
        {"research_id": job["research_id"], "updates": {"progress": 33}},
    )
    recent = dispatcher.dispatch("app_get_research_job", {})["job"]
    assert_true(recent["research_id"] == job["research_id"], "get job without id should return most recently updated job")
    try:
        dispatcher.dispatch("app_update_research_job", {"research_id": job["research_id"], "updates": {"tavily_api_key": "leak"}})
        raise AssertionError("secret-like field should be rejected")
    except ValidationError:
        pass
    empty = AppDispatcher(settings=SettingsStore(root=tmp_path / "empty"), jobs=JobStore(root=tmp_path / "empty"))
    assert_true(empty.dispatch("app_get_research_job", {})["job"] is None, "empty recent job should be null")
    try:
        dispatcher.dispatch("app_get_research_job", {"research_id": "missing"})
        raise AssertionError("missing explicit id should fail")
    except NotFoundError:
        pass


def test_image_attachment_analysis_context(tmp_path: Path):
    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "image evidence"})["job"]
    result = dispatcher.dispatch(
        "app_prepare_attachments",
        {
            "research_id": job["research_id"],
            "attachments": [
                {
                    "name": "chart.png",
                    "path": "research-jobs/test/uploads/chart.png",
                    "content_type": "image/png",
                    "size_bytes": 1024,
                    "download_url": "data:image/png;base64,iVBORw0KGgo=",
                    "image_analysis": {
                        "summary": "A line chart comparing quarterly revenue.",
                        "visible_text": "Revenue Q1 Q2",
                        "key_observations": ["Revenue rises across the chart."],
                        "chart_or_table": "Line chart",
                        "research_relevance": {"relevance": "Useful as visual evidence for the report.", "relevance_score": 0.8},
                        "uncertainties": ["Exact axis values are too small to read."],
                    },
                }
            ],
        },
    )

    loaded = dispatcher.jobs.load(job["research_id"])
    context = loaded["attachment_context"]
    assert_true(result["job"]["attachment_context_summary"]["chunk_count"] == 0, "image analysis should not become text chunks")
    assert_true(context["files"][0]["status"] == "ready", "image attachment should be ready when analysis exists")
    assert_true(context["files"][0]["analysis"]["type"] == "image", "image attachment should keep analysis type")
    assert_true(context["files"][0]["chunk_count"] == 0, "image attachment should stay at file-summary level")
    assert_true(context["files"][0]["local_path"].startswith("attachment-files/file-1-"), "image attachment should record local artifact path")
    assert_true((dispatcher.jobs.job_dir_for(job["research_id"]) / context["files"][0]["local_path"]).exists(), "image attachment should be downloaded locally")
    assert_true(context["files"][0]["analysis"]["summary"] == "A line chart comparing quarterly revenue.", "image planning summary should be concise")
    assert_true(context["files"][0]["analysis"]["payload"]["visible_text"] == "Revenue Q1 Q2", "image analysis JSON should be persisted")
    selected = select_attachment_context(
        jobs=dispatcher.jobs,
        embeddings=FakeEmbeddings(),
        research_id=job["research_id"],
        query="quarterly revenue trend",
        top_k=4,
    )
    assert_true(selected["selected_item_count"] == 1, "relevant image summary should enter selected context")
    assert_true(selected["selected_items"][0]["kind"] == "image_analysis", "image should enter selection as an image analysis item")
    assert_true(selected["selected_items"][0]["quote"] == "", "image citation cards should not show JSON text")
    assert_true("Image analysis JSON for chart.png" in selected["selected_context"], "image should enter writing context as JSON")
    assert_true("file-1:image-summary" not in selected["selected_context"], "image virtual chunk id should stay internal")
    assert_true('"visible_text": "Revenue Q1 Q2"' in selected["selected_context"], "selected image context should include visible text")
    assert_true("Revenue rises across the chart." in selected["selected_context"], "selected image summary should include observations")


def test_concurrent_attachment_embeddings(tmp_path: Path):
    original_retry_delay = attachment_embeddings_module.EMBEDDING_RETRY_DELAY_SECONDS
    attachment_embeddings_module.EMBEDDING_RETRY_DELAY_SECONDS = 0
    class TrackingEmbeddingsClient(AnnaEmbeddingsClient):
        def __init__(self):
            self.lock = threading.Lock()
            self.first_wave = threading.Barrier(MAX_PARALLEL_EMBEDDING_BATCHES)
            self.active = 0
            self.max_active = 0

        def create(self, *, texts, model="anna-managed-v1", timeout=30.0):
            batch_index = int(texts[0].removeprefix("batch-"))
            with self.lock:
                self.active += 1
                self.max_active = max(self.max_active, self.active)
            try:
                if batch_index < MAX_PARALLEL_EMBEDDING_BATCHES:
                    self.first_wave.wait(timeout=2)
                    time.sleep((MAX_PARALLEL_EMBEDDING_BATCHES - batch_index) * 0.002)
                return {"batch_index": batch_index, "data": [{"embedding": [float(batch_index)]}]}
            finally:
                with self.lock:
                    self.active -= 1

    client = TrackingEmbeddingsClient()
    batches = [[f"batch-{index}"] for index in range(MAX_PARALLEL_EMBEDDING_BATCHES + 1)]
    results = client.create_batches(batches=batches)
    assert_true(client.max_active == MAX_PARALLEL_EMBEDDING_BATCHES, "embedding batches should cap concurrency at eight")
    assert_true([result["batch_index"] for result in results] == list(range(len(batches))), "embedding batch results should preserve input order")
    assert_true(client.create_batches(batches=[]) == [], "empty embedding batches should not start workers")

    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "embedding concurrency"})["job"]
    context = {
        "version": 1,
        "prepared_at": "now",
        "files": [],
        "summary": "",
        "chunks": [
            {"chunk_id": f"file-1:{index + 1:04d}", "file_id": "file-1", "file_name": "brief.md", "index": index + 1, "text": f"chunk {index + 1}"}
            for index in range(3)
        ],
    }
    dispatcher.jobs.update_metadata(job["research_id"], {"attachment_context": context})

    class ShortResultEmbeddings(FakeEmbeddings):
        def create_batches_settled(self, *, batches, model="anna-managed-v1", timeout=30.0):
            return [
                EmbeddingBatchOutcome(result=self.create(texts=batch, model=model, timeout=timeout))
                if index == 0
                else EmbeddingBatchOutcome(result={"data": []})
                for index, batch in enumerate(batches)
            ]

    transient = ShortResultEmbeddings()
    embed_attachment_chunks(jobs=dispatcher.jobs, embeddings=transient, research_id=job["research_id"])
    loaded = dispatcher.jobs.load(job["research_id"])["attachment_context"]
    assert_true(loaded["embedding_status"] == "ready", "automatic retry should complete transiently failed chunks")
    assert_true(all(chunk.get("embedding") for chunk in loaded["chunks"]), "automatic retry should preserve prior vectors and fill missing vectors")

    persistent_job = dispatcher.dispatch("app_create_research_job", {"query": "persistent embedding failure"})["job"]
    persistent_context = {
        "version": 1,
        "prepared_at": "now",
        "files": [],
        "summary": "",
        "chunks": [
            {
                "chunk_id": f"file-2:{index + 1:04d}",
                "file_id": "file-2",
                "file_name": "persistent.md",
                "index": index + 1,
                "text": f"chunk {index + 1}",
            }
            for index in range(3)
        ],
    }
    dispatcher.jobs.update_metadata(persistent_job["research_id"], {"attachment_context": persistent_context})

    class PersistentFailureEmbeddings(FakeEmbeddings):
        def create_batches_settled(self, *, batches, model="anna-managed-v1", timeout=30.0):
            return [
                EmbeddingBatchOutcome(result={"data": []})
                if "chunk 3" in batch
                else EmbeddingBatchOutcome(result=self.create(texts=batch, model=model, timeout=timeout))
                for batch in batches
            ]

    try:
        embed_attachment_chunks(jobs=dispatcher.jobs, embeddings=PersistentFailureEmbeddings(), research_id=persistent_job["research_id"])
        raise AssertionError("persistent embedding failure should survive automatic retry")
    except EmbeddingsError:
        pass
    partial = dispatcher.jobs.load(persistent_job["research_id"])["attachment_context"]
    assert_true(all(chunk.get("embedding") for chunk in partial["chunks"][:2]), "successful batches should remain checkpointed after retry failure")
    assert_true(not partial["chunks"][2].get("embedding"), "persistently failed chunk should remain pending")
    assert_true(partial["embedding_status"] == "partial", "persistent retry failure should remain partial")

    wave_job = dispatcher.dispatch("app_create_research_job", {"query": "embedding waves"})["job"]
    wave_context = {
        "version": 1,
        "prepared_at": "now",
        "files": [],
        "summary": "",
        "chunks": [
            {"chunk_id": f"file-2:{index + 1:04d}", "file_id": "file-2", "file_name": "long.md", "index": index + 1, "text": f"long chunk {index + 1}"}
            for index in range(18)
        ],
    }
    dispatcher.jobs.update_metadata(wave_job["research_id"], {"attachment_context": wave_context})
    wave_embeddings = FakeEmbeddings()
    embed_attachment_chunks(jobs=dispatcher.jobs, embeddings=wave_embeddings, research_id=wave_job["research_id"])
    assert_true(wave_embeddings.wave_sizes == [8, 1], "eighteen chunks should checkpoint as eight batches then one batch")
    attachment_embeddings_module.EMBEDDING_RETRY_DELAY_SECONDS = original_retry_delay



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
    assert_true(bool(section_context["selected_sources"]), "section context transfer should return selected source metadata")
    assert_true(
        all("content" in source for source in section_context["selected_sources"]),
        "section selected_sources should keep content so selected_context can be rebuilt",
    )
    assert_true(
        all("index" in source and "source_label" in source and "content_chars" in source for source in section_context["selected_sources"]),
        "section selected_sources should retain rebuild metadata",
    )
    loaded_job = dispatcher.jobs.load(research_id)
    stored_context = loaded_job["section_selected_context"]["section-1"]
    assert_true("selected_context" not in stored_context, "stored section context should be derived from selected_sources")
    assert_true(stored_context["selected_context_format"] == "v1", "stored section context should record format")
    assert_true(
        all("content" in source for source in stored_context["selected_sources"]),
        "stored section selected_sources should include content for resume rebuild",
    )
    assert_true("section_selected_context" not in selected["job"], "section context stdio job should be status-only")
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
    framing_transfer = dispatcher.dispatch(
        "app_save_report_framing",
        {"research_id": research_id},
    )["transfer"]
    assert_true(framing_transfer["method"] == "POST", "report framing should return transfer descriptor")
    framing_saved = post_json(
        framing_transfer["url"],
        {
            "framing": {
                "title": "Final",
                "introduction": "Intro " + ("large intro. " * 200),
                "conclusion": "Conclusion " + ("large conclusion. " * 200),
            },
        },
    )
    assert_true(framing_saved["job"]["stage"] == "assemble_report", "report framing transfer should update stage")
    assert_true(framing_saved["job"]["report_framing"]["title"] == "Final", "report framing transfer should save framing")
    loaded_immediate = dispatcher.dispatch("app_get_research_job", {"research_id": research_id})["job"]
    loaded = get_json(loaded_immediate["job_transfer"]["url"])["job"]
    assert_true("section_markdown" not in loaded["section_results"]["section-1"], "job view should not include section markdown")
    assembled_transfer = dispatcher.dispatch("app_save_assembled_research_result", {"research_id": research_id})["transfer"]
    assembled = post_json(
        assembled_transfer["url"],
        {"report_markdown": "# Final\n\n" + ("assembled report. " * 200), "source_urls": section_context["source_urls"]},
    )
    assert_true(assembled["result"]["report_markdown"].startswith("# Final"), "assembled result transfer should save final report")
    final_immediate = dispatcher.dispatch("app_get_research_job", {"research_id": research_id})["job"]
    final_job = get_json(final_immediate["job_transfer"]["url"])["job"]
    assert_true("report_markdown" not in final_job["result"], "final job view should not include full report")
    assert_true(final_immediate["result_transfer"]["method"] == "GET", "final job should expose result read transfer")


def test_source_test_transfer(tmp_path: Path):
    os.environ["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
    dispatcher = make_dispatcher(tmp_path)
    result = dispatcher.dispatch(
        "app_test_research_source",
        {"id": "tavily", "definition": dispatcher.registry.get_definition("tavily"), "query": "anna"},
    )
    assert_true("test" not in result, "source test should not return debug payload through stdio")
    transfer = result["test_transfer"]
    assert_true(transfer["method"] == "GET", "source test should return read transfer")
    test = get_json(transfer["url"])["test"]
    assert_true(test["source_id"] == "tavily", "source test transfer should return result")
    assert_true("pages" in test, "source test transfer should include debug pages")


def test_selector():
    selector = LexicalContextSelector(max_sources=2, max_per_domain=1, context_budget=1600)
    anna_context = "Anna app research context with source evidence and selector details. " * 8
    same_domain_context = "anna app same domain evidence and repeated context details. " * 8
    selector_context = "research context selector evidence for Anna app ranking and source selection. " * 8
    selected = selector.select(
        query="anna app research",
        search_queries=["anna app research"],
        search_results=[
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://example.com/a", "title": "Anna research", "content": anna_context},
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://example.com/a", "title": "Duplicate", "content": "duplicate"},
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://example.com/b", "title": "Same domain", "content": same_domain_context},
            {"query": "anna", "source_id": "tavily", "source_name": "Tavily", "url": "https://docs.example.org/c", "title": "Context selector", "content": selector_context},
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
        assert_true(init["result"].get("client_capabilities") == {"embeddings": {}}, "tool should declare embeddings")
        assert_true(init["result"].get("capabilities") == {"sampling": {}}, "tool should declare sampling capability")
        describe = plugin.call("describe")
        tools = [tool["name"] for tool in describe["result"]["tools"]]
        assert_true(describe["result"]["name"] == "tool-xhz-researcher-python-e7k8xa3s", "describe should advertise tool")
        assert_true(describe["result"]["version"] == "0.2.4", "describe should advertise the current tool version")
        assert_true("research" not in tools, "legacy research method should be absent")
        assert_true("app_search_web" not in tools, "legacy app_search_web must be removed")
        assert_true("app_call_section_research_source" in tools, "section source method must be advertised")
        assert_true("app_list_research_sources" in tools, "new app_list_research_sources must be advertised")
        assert_true("app_test_research_source" in tools, "source test method must be advertised")
        removed_methods = {
            "app_update_settings",
            "app_call_research_source",
            "app_select_context",
            "app_fail_section",
            "app_save_research_result",
            "app_embed_texts",
        }
        assert_true(removed_methods.isdisjoint(tools), "unused app methods must not be advertised")
        assert_true(all(name.startswith("app_") for name in tools), "all methods should be app methods")
        assert_true(not any(name.startswith("agent_") for name in tools), "legacy agent methods must be absent")
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
    manifest = json.loads((APP_ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert_true(manifest["required_executas"][0]["tool_id"] == "bundled:researcher", "manifest should reference bundled researcher tool")
    assert_true(manifest["required_executas"][0]["min_version"] == "0.2.4", "manifest should require tool 0.2.4")
    assert_true(manifest["ui"]["host_api"]["llm"] == ["complete", "embed"], "manifest should authorize completion and Executa-backed embeddings")
    assert_true(manifest["ui"]["host_api"]["agent"]["session"]["auto"] is True, "manifest should authorize agent auto sessions")
    assert_true(manifest["ui"]["host_api"]["agent"]["tools"] == [], "section sessions should not receive researcher tools")
    assert_true("host.agent" in manifest["permissions"], "manifest should request host.agent permission")
    assert_true('method:"research"' not in bundle_js and 'method: "research"' not in bundle_js, "bundle should not call legacy research method")
    assert_true('"action":"advance"' not in bundle_js and 'action:"advance"' not in bundle_js, "bundle should not contain legacy advance action")
    assert_true("app_search_web" not in bundle_js, "bundle should not reference legacy app_search_web")
    assert_true("query_domains" not in bundle_js, "bundle should not reference query_domains")


def test_duckduckgo_native_search_adapter(tmp_path: Path):
    class FakeDDGS:
        def text(self, query, *, region, max_results):
            return [
                {"href": "https://example.com/a", "title": "Alpha", "body": f"{query} body {region} {max_results}"},
                {"url": "https://example.com/b", "title": "Beta", "snippet": "snippet text"},
                {"title": "No useful content"},
            ]

    original = duckduckgo_native._create_client
    duckduckgo_native._create_client = lambda: FakeDDGS()
    try:
        results = duckduckgo_native.search_duckduckgo(" anna research ", max_results=50, region="us-en")
    finally:
        duckduckgo_native._create_client = original

    assert_true(len(results) == 2, "duckduckgo adapter should drop empty items")
    assert_true(results[0]["query"] == "anna research", "duckduckgo adapter should trim query")
    assert_true(results[0]["url"] == "https://example.com/a", "duckduckgo adapter should use href")
    assert_true("20" in results[0]["content"], "duckduckgo adapter should clamp max_results")
    assert_true(results[1]["content"] == "snippet text", "duckduckgo adapter should use snippet fallback")


def main():
    tests = [
        ("settings", test_settings),
        ("job_shell", test_job_shell),
        ("image_attachment_analysis", test_image_attachment_analysis_context),
        ("concurrent_attachment_embeddings", test_concurrent_attachment_embeddings),
        ("section_large_payload_transfer", test_section_large_payload_transfer),
        ("source_test_transfer", test_source_test_transfer),
        ("selector", lambda tmp: test_selector()),
        ("duckduckgo_native", test_duckduckgo_native_search_adapter),
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
