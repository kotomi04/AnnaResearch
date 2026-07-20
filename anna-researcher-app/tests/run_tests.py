from __future__ import annotations

import json
import hashlib
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
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
from researcher_tool.embedding import anna_embed as anna_embed_module  # noqa: E402
from researcher_tool.errors import NotFoundError, ValidationError  # noqa: E402
from researcher_tool.hybrid_context_selector import HybridContextSelector  # noqa: E402
from researcher_tool.job_store import JobStore  # noqa: E402
from researcher_tool.outline_discovery import generate_outline_draft  # noqa: E402
from researcher_tool.attachment_summary import select_attachment_context  # noqa: E402
from researcher_tool.settings import SettingsStore  # noqa: E402
from researcher_tool.sources.executor import SourceCallResult  # noqa: E402
from researcher_tool.sources.extraction.models import ExtractedPage  # noqa: E402
from researcher_tool.sources.extraction.tavily import TAVILY_PREFETCH_MIN_CHARS, enrich_tavily_items  # noqa: E402
from researcher_tool.sources.native import duckduckgo as duckduckgo_native  # noqa: E402
from researcher_tool.web_documents import WebDocumentStore  # noqa: E402


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def make_dispatcher(tmp_path: Path) -> AppDispatcher:
    root = tmp_path / ".research"
    return AppDispatcher(settings=SettingsStore(root=root), jobs=JobStore(root=root), selector=LexicalContextSelector(max_sources=4, context_budget=4000), transfers=MemoryTransfers())


class MemoryTransfers:
    def __init__(self):
        self.payloads = {}
        self.deleted = []

    def upload(self, *, prefix, kind, payload):
        return self.put(prefix=prefix, kind=kind, payload=payload)

    def put(self, *, prefix, kind, payload):
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        path = f"{prefix}/transfers/{kind}-{uuid.uuid4().hex}.json"
        descriptor = {
            "path": path,
            "content_type": "application/json",
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "delete_after_read": True,
        }
        self.payloads[path] = payload
        return descriptor

    def read(self, descriptor):
        return self.payloads[descriptor["path"]]

    def download_json(self, descriptor, *, expected_prefix):
        assert descriptor["path"].startswith(expected_prefix + "/transfers/")
        return self.read(descriptor)

    def delete_best_effort(self, descriptor):
        path = descriptor.get("path")
        self.deleted.append(path)
        self.payloads.pop(path, None)


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


class FakeOutlineSampling:
    def __init__(self):
        self.calls = []
        self.replies = [
            {"anchor_query": "NVIDIA recent decline outlook 2026", "facets": [{"task": "Explain decline and outlook"}]},
            {"queries": [
                {"text": "NVIDIA decline catalysts 2026", "covers": ["f1"]},
                {"text": "NVIDIA company actions 2026", "covers": ["f1"]},
                {"text": "NVIDIA valuation outlook 2026", "covers": ["f1"]},
            ]},
            {"sections": [
                {"title": "Decline", "outline": "Explain catalysts.", "covers": ["f1"]},
                {"title": "Actions", "outline": "Review actions.", "covers": []},
                {"title": "Valuation", "outline": "Assess valuation.", "covers": []},
                {"title": "Outlook", "outline": "Develop scenarios.", "covers": []},
            ]},
        ]

    def create_message(self, **kwargs):
        self.calls.append(kwargs)
        return {"content": {"type": "text", "text": json.dumps(self.replies.pop(0))}}


class ConcurrentSourceExecutor:
    def __init__(self):
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def call(self, definition, query):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(0.03)
            return SourceCallResult(
                source_id=str(definition.get("id") or "tavily"),
                source_name=str(definition.get("name") or "Tavily"),
                query=query,
                items=[{"url": f"https://example.test/{query.replace(' ', '-')}", "title": query, "content": "evidence " * 80}],
                duration_ms=30,
            )
        finally:
            with self.lock:
                self.active -= 1


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
    assert_true(loaded_status["schema_version"] == 5, "get job without id should return the most recently updated compact job")
    assert_true(all("raw_results" not in it for it in loaded_status["iterations"]), "compact stdio job should not expose raw_results")
    assert_true("job_transfer" not in loaded_status and "result_transfer" not in loaded_status, "compact job reads must not create APS transfers")
    loaded_descriptor = dispatcher.dispatch("app_get_research_job_payload", {"research_id": job["research_id"]})["transfer"]
    loaded = dispatcher.transfers.read(loaded_descriptor)["job"]
    assert_true(loaded["research_id"] == job["research_id"], "latest job should load")
    assert_true(loaded["schema_version"] == 5, "loaded job should advertise v5")
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
                "research_options": {"source_curation_mode": "llm", "source_curation_version": "upstream-v1"},
                "section_source_curations": {
                    "section-1": {"status": "completed", "candidate_count": 2, "included_count": 1}
                },
            },
        },
    )
    assert_true(updated["job"]["stage"] == "search_next_query", "metadata should update")
    assert_true(updated["job"]["progress"] == 25, "progress should update")
    assert_true(updated["job"]["iteration"] == 1, "iteration should update")
    assert_true(updated["job"]["max_iterations"] == 5, "max_iterations should update")
    updated_job = dispatcher.dispatch("app_get_research_job", {"research_id": job["research_id"]})["job"]
    assert_true(updated_job["research_options"]["source_curation_mode"] == "llm", "research options should update")
    assert_true(
        updated_job["section_source_curations"]["section-1"]["included_count"] == 1,
        "source curation audit should update",
    )
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
    assert_true(client.max_active == MAX_PARALLEL_EMBEDDING_BATCHES, "embedding batches should honor the configured concurrency cap")
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
        def __init__(self):
            super().__init__()
            self.rounds = 0

        def create_batches_settled(self, *, batches, model="anna-managed-v1", timeout=30.0):
            self.rounds += 1
            return [
                EmbeddingBatchOutcome(result={"data": []})
                if self.rounds == 1 and "chunk 3" in batch
                else EmbeddingBatchOutcome(result=self.create(texts=batch, model=model, timeout=timeout))
                for batch in batches
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
    assert_true(wave_embeddings.wave_sizes == [8, 8, 2], "eighteen chunks should checkpoint as two eight-batch waves then two batches")
    attachment_embeddings_module.EMBEDDING_RETRY_DELAY_SECONDS = original_retry_delay


def test_embedding_fetch_failed_retry(tmp_path: Path):
    del tmp_path
    original_delay = anna_embed_module.FETCH_FAILED_RETRY_DELAY_SECONDS
    anna_embed_module.FETCH_FAILED_RETRY_DELAY_SECONDS = 0
    try:
        frames: list[dict] = []
        holder: dict[str, AnnaEmbeddingsClient] = {}

        def transient_writer(frame: dict):
            frames.append(frame)
            if len(frames) <= 2:
                response = {"id": frame["id"], "error": {"code": -32603, "message": "fetch failed"}}
            else:
                response = {"id": frame["id"], "result": {"data": [{"embedding": [1.0, 2.0]}]}}
            holder["client"].dispatch_response(response)

        transient = AnnaEmbeddingsClient(write_frame=transient_writer)
        holder["client"] = transient
        result = transient.create(texts=["retry me"])
        assert_true(len(frames) == 3, "fetch failed should retry twice before succeeding")
        assert_true(len({frame["id"] for frame in frames}) == 3, "each embedding retry must use a fresh reverse-RPC id")
        assert_true(result["data"][0]["embedding"] == [1.0, 2.0], "retry should return the successful embedding response")

        exhausted_frames: list[dict] = []
        exhausted_holder: dict[str, AnnaEmbeddingsClient] = {}

        def exhausted_writer(frame: dict):
            exhausted_frames.append(frame)
            exhausted_holder["client"].dispatch_response({"id": frame["id"], "error": {"code": -32603, "message": "Fetch Failed"}})

        exhausted = AnnaEmbeddingsClient(write_frame=exhausted_writer)
        exhausted_holder["client"] = exhausted
        try:
            exhausted.create(texts=["still failing"])
            raise AssertionError("fetch failed should be raised after finite retries")
        except EmbeddingsError as exc:
            assert_true(exc.message == "Fetch Failed", "final fetch failure should preserve the host error")
        assert_true(len(exhausted_frames) == 3, "fetch failed must stop after two retries")

        denied_frames: list[dict] = []
        denied_holder: dict[str, AnnaEmbeddingsClient] = {}

        def denied_writer(frame: dict):
            denied_frames.append(frame)
            denied_holder["client"].dispatch_response({"id": frame["id"], "error": {"code": -32003, "message": "permission denied"}})

        denied = AnnaEmbeddingsClient(write_frame=denied_writer)
        denied_holder["client"] = denied
        try:
            denied.create(texts=["do not retry"])
            raise AssertionError("non-transport embedding errors should fail")
        except EmbeddingsError:
            pass
        assert_true(len(denied_frames) == 1, "non-fetch embedding errors must not retry")
    finally:
        anna_embed_module.FETCH_FAILED_RETRY_DELAY_SECONDS = original_delay



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
    section_context = dispatcher.transfers.read(selected["context_transfer"])
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
    section_transfer = dispatcher.transfers.put(
        prefix=f"research-jobs/{research_id}", kind="section-result-input", payload={
            "research_id": research_id,
            "section_id": "section-1",
            "section_markdown": "## Section One\n\n" + ("large section. " * 200),
            "section_summary": "large section summary",
            "subsection_headers": ["Evidence basis", "Risk analysis"],
            "source_urls": section_context["source_urls"],
            "status": "completed",
        }
    )
    section_saved = dispatcher.dispatch("app_save_section_result", {"research_id": research_id, "section_id": "section-1", "payload_transfer": section_transfer})
    assert_true(section_saved["section_result"]["section_markdown"].startswith("## Section One"), "section result transfer should save markdown")
    assert_true(section_saved["section_result"]["subsection_headers"] == ["Evidence basis", "Risk analysis"], "section result transfer should save subsection headers")
    framing_transfer = dispatcher.transfers.put(
        prefix=f"research-jobs/{research_id}", kind="framing-input", payload={
            "research_id": research_id,
            "framing": {
                "title": "Final",
                "introduction": "Intro " + ("large intro. " * 200),
                "conclusion": "Conclusion " + ("large conclusion. " * 200),
            },
        }
    )
    framing_saved = dispatcher.dispatch("app_save_report_framing", {"research_id": research_id, "payload_transfer": framing_transfer})
    assert_true(framing_saved["job"]["stage"] == "assemble_report", "report framing transfer should update stage")
    assert_true(framing_saved["job"]["report_framing"]["title"] == "Final", "report framing transfer should save framing")
    loaded_immediate = dispatcher.dispatch("app_get_research_job", {"research_id": research_id})["job"]
    assert_true("job_transfer" not in loaded_immediate, "compact section status refresh should not create APS transfers")
    loaded_payload = dispatcher.transfers.read(dispatcher.dispatch("app_get_research_job_payload", {"research_id": research_id})["transfer"])
    loaded = loaded_payload["job"]
    assert_true("section_markdown" in loaded["section_results"]["section-1"], "full APS job view should include section markdown")
    assert_true(loaded["section_results"]["section-1"]["subsection_headers"] == ["Evidence basis", "Risk analysis"], "compact job should retain subsection headers")
    assembled_transfer = dispatcher.transfers.put(
        prefix=f"research-jobs/{research_id}", kind="assembled-input", payload={"research_id": research_id, "report_markdown": "# Final\n\n" + ("assembled report. " * 200), "source_urls": section_context["source_urls"]},
    )
    assembled = dispatcher.dispatch("app_save_assembled_research_result", {"research_id": research_id, "payload_transfer": assembled_transfer})
    assert_true(assembled["result"]["report_markdown"].startswith("# Final"), "assembled result transfer should save final report")
    final_immediate = dispatcher.dispatch("app_get_research_job", {"research_id": research_id})["job"]
    final_payload = dispatcher.transfers.read(dispatcher.dispatch("app_get_research_job_payload", {"research_id": research_id})["transfer"])
    final_job = final_payload["job"]
    assert_true("report_markdown" not in final_job["result"], "final job view should not include full report")
    assert_true(final_payload["result"]["report_markdown"].startswith("# Final"), "one APS payload should include the complete report")
    assert_true("job_transfer" not in final_immediate and "result_transfer" not in final_immediate, "completed compact reads must remain APS-free")


def test_section_context_can_filter_one_deep_research_iteration(tmp_path: Path):
    class CapturingSelector:
        def __init__(self):
            self.calls = []

        def select(self, **kwargs):
            self.calls.append(kwargs)
            return {"selected_sources": [], "source_urls": [], "selected_context": ""}

    root = tmp_path / ".research"
    jobs = JobStore(root=root)
    selector = CapturingSelector()
    dispatcher = AppDispatcher(settings=SettingsStore(root=root), jobs=jobs, selector=selector, transfers=MemoryTransfers())
    job = jobs.create(query="deep section")
    research_id = job["research_id"]
    jobs.save_confirmed_outline(
        research_id,
        [{"id": "section-1", "title": "One", "outline": "Research one.", "allowed_source_ids": ["tavily"], "max_iterations": 2}],
    )
    for iteration in (1, 2):
        jobs.append_section_iteration(
            research_id,
            section_id="section-1",
            iteration=iteration,
            source_id="tavily",
            source_name="Tavily",
            queries=[f"query-{iteration}"],
            source_calls=[{"query": f"query-{iteration}", "results_count": 1}],
            raw_results=[{"url": f"https://example.com/{iteration}", "content": f"evidence-{iteration}"}],
        )

    dispatcher.dispatch(
        "app_select_section_context",
        {"research_id": research_id, "section_id": "section-1", "iteration": 2, "search_queries": ["query-2"]},
    )

    assert_true(selector.calls[0]["search_queries"] == ["query-2"], "iteration selector should use the active depth query")
    assert_true(
        [item["url"] for item in selector.calls[0]["search_results"]] == ["https://example.com/2"],
        "intermediate deep-research selection should exclude earlier iterations",
    )


def test_outline_discovery_backend_orchestration(tmp_path: Path):
    os.environ["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
    dispatcher = make_dispatcher(tmp_path)
    job = dispatcher.dispatch("app_create_research_job", {"query": "NVIDIA recent decline and outlook"})["job"]
    research_id = job["research_id"]
    dispatcher.dispatch(
        "app_save_confirmed_research_role",
        {"research_id": research_id, "role": {"server": "Analyst", "agent_role_prompt": "Use current evidence."}},
    )
    dispatcher.jobs.update_metadata(research_id, {"attachment_context": {
        "summary": "Uploaded earnings memo",
        "files": [{
            "id": "file-1",
            "name": "earnings-memo.pdf",
            "status": "ready",
            "analysis": {
                "summary": "The memo says Blackwell shipment timing remains uncertain.",
                "key_points": ["Shipment timing needs independent confirmation."],
                "relevance": "Directly relevant to recent company actions.",
                "relevance_score": 0.9,
                "payload": {"private_detail": "must not enter search planning"},
            },
        }],
    }})
    sampling = FakeOutlineSampling()
    generated = generate_outline_draft(
        dispatcher=dispatcher,
        sampling=sampling,
        research_id=research_id,
        source_ids=["tavily"],
        invoke_id="outline-test",
    )
    assert_true(len(generated["outline"]) == 4, "backend discovery should return a compact outline")
    assert_true("selected_context" not in generated and "context_transfer" not in generated, "discovery evidence must stay in the backend")
    assert_true(len(sampling.calls) == 3, "backend discovery should sample anchor, sub-queries, and outline")
    assert_true(
        "Blackwell shipment timing remains uncertain" in sampling.calls[0]["messages"][0]["content"]["text"],
        "anchor planning should receive the compact attachment evidence baseline",
    )
    assert_true(
        "prioritize missing context, independent corroboration" in sampling.calls[1]["messages"][0]["content"]["text"],
        "sub-query planning should use attachments to target external evidence gaps",
    )
    assert_true("private_detail" not in json.dumps(sampling.calls), "attachment payload must not enter outline search prompts")
    loaded = dispatcher.jobs.load(research_id)
    discovery = loaded["outline_discovery"]
    assert_true(discovery["status"] == "completed", "full discovery should be persisted")
    assert_true("formal_queries" not in discovery, "formal queries should be derived rather than duplicated")
    assert_true(discovery["seed"]["query_ids"] == ["anchor"], "seed should reference the anchor query by id")
    assert_true("queries" not in discovery["seed"], "seed should not duplicate query text")
    assert_true(not loaded["section_iterations"], "outline discovery must not create fake section iterations")
    assert_true((dispatcher.jobs.job_dir_for(research_id) / "outline_discovery.json").exists(), "outline discovery should use a split store")


def test_outline_discovery_parallel_queries(tmp_path: Path):
    os.environ["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
    root = tmp_path / ".research"
    executor = ConcurrentSourceExecutor()
    dispatcher = AppDispatcher(
        settings=SettingsStore(root=root),
        jobs=JobStore(root=root),
        selector=LexicalContextSelector(max_sources=4, context_budget=4000),
        executor=executor,
    )
    research_id = dispatcher.dispatch("app_create_research_job", {"query": "parallel outline"})["job"]["research_id"]
    dispatcher.jobs.save_outline_query_plan(
        research_id,
        anchor_query="parallel outline anchor",
        facets=[{"id": "f1", "task": "cover task"}],
        sub_queries=[
            {"id": f"sub_{index}", "text": f"parallel query {index}", "covers": ["f1"]}
            for index in range(1, 4)
        ],
    )
    dispatcher._call_outline_discovery_source(
        {"research_id": research_id, "source_id": "tavily", "phase": "research", "query_ids": ["sub_1", "sub_2", "sub_3", "anchor"]},
    )
    discovery = dispatcher.jobs.load(research_id)["outline_discovery"]
    assert_true(executor.max_active == 3, "outline queries should respect the source max_parallel setting")
    assert_true(
        discovery["research_calls"][0]["query_ids"] == ["sub_1", "sub_2", "sub_3", "anchor"],
        "parallel query results should preserve input order",
    )


def test_source_test_transfer(tmp_path: Path):
    os.environ["ANNA_RESEARCHER_FAKE_TAVILY"] = "1"
    dispatcher = make_dispatcher(tmp_path)
    result = dispatcher.dispatch(
        "app_test_research_source",
        {"id": "tavily", "definition": dispatcher.registry.get_definition("tavily"), "query": "anna"},
    )
    assert_true("test" not in result, "source test should not return debug payload through stdio")
    transfer = result["test_transfer"]
    assert_true(transfer["path"].startswith("research-source-tests/"), "source test should return APS transfer")
    test = dispatcher.transfers.read(transfer)["test"]
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


def test_hybrid_selector_per_query_top_eight_and_threshold(tmp_path: Path):
    class OrthogonalEmbeddings:
        def create_batches(self, *, batches, model="anna-managed-v1", timeout=30.0):
            return [
                {
                    "data": [
                        {
                            "embedding": [
                                1.0 if "alpha" in str(text).casefold() else 0.0,
                                1.0 if "beta" in str(text).casefold() else 0.0,
                            ]
                        }
                        for text in batch
                    ],
                    "_meta": {"dimensions": 2},
                }
                for batch in batches
            ]

    root = tmp_path / ".research"
    jobs = JobStore(root=root)
    job = jobs.create(query="alpha beta")
    selector = HybridContextSelector(embeddings=OrthogonalEmbeddings(), documents=WebDocumentStore(jobs))
    results = [
        {"url": f"https://alpha.example/{index}", "title": f"Alpha {index}", "source_id": "tavily", "source_name": "Tavily", "content": f"alpha evidence {index}"}
        for index in range(10)
    ] + [
        {"url": f"https://beta.example/{index}", "title": f"Beta {index}", "source_id": "tavily", "source_name": "Tavily", "content": f"beta evidence {index}"}
        for index in range(10)
    ] + [{"url": "https://neutral.example/item", "title": "Neutral", "source_id": "tavily", "source_name": "Tavily", "content": "unrelated neutral material"}]
    selected = selector.select(
        research_id=job["research_id"],
        query="alpha beta",
        search_queries=["alpha", "beta"],
        search_results=results,
    )
    chunks = [chunk for source in selected["selected_sources"] for chunk in source["selected_chunks"]]
    assert_true(len(chunks) == 16, "each query should independently contribute up to eight chunks")
    assert_true(abs(max(chunk["rrf_score"] for chunk in chunks) - (2 / 61)) < 1e-8, "RRF should use k=60")

    class BelowThresholdEmbeddings:
        def create_batches(self, *, batches, model="anna-managed-v1", timeout=30.0):
            return [
                {
                    "data": [
                        {"embedding": [1.0, 0.0] if str(text).strip() == "target" else [0.3, 0.9539392014]}
                        for text in batch
                    ],
                    "_meta": {"dimensions": 2},
                }
                for batch in batches
            ]

    threshold_selector = HybridContextSelector(embeddings=BelowThresholdEmbeddings(), documents=WebDocumentStore(jobs))
    threshold_selected = threshold_selector.select(
        research_id=job["research_id"],
        query="target",
        search_queries=["target"],
        search_results=[{
            "url": "https://example.com/unrelated",
            "title": "Unrelated",
            "source_id": "tavily",
            "source_name": "Tavily",
            "content": "orthogonal material without matching vocabulary",
        }],
    )
    assert_true(not threshold_selected["selected_sources"], "embedding similarity below 0.35 should be excluded")


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
        assert_true(init["result"].get("client_capabilities") == {"embeddings": {}, "storage": {}}, "tool should negotiate embeddings and APS storage clients")
        assert_true(init["result"].get("capabilities") == {"sampling": {}}, "tool should declare host sampling capability")
        describe = plugin.call("describe")
        tools = [tool["name"] for tool in describe["result"]["tools"]]
        assert_true(describe["result"]["name"] == "tool-xhz-researcher-python-e7k8xa3s", "describe should advertise tool")
        assert_true(describe["result"]["version"] == "0.3.0", "describe should advertise the current tool version")
        assert_true("research" not in tools, "legacy research method should be absent")
        assert_true("app_search_web" not in tools, "legacy app_search_web must be removed")
        assert_true("app_call_section_research_source" in tools, "section source method must be advertised")
        assert_true("app_get_section_result" in tools, "section result APS read method must be advertised")
        assert_true("app_get_research_job_payload" in tools, "full job APS read method must be advertised")
        assert_true("app_generate_outline_draft" in tools, "backend outline orchestration method must be advertised")
        assert_true("app_call_outline_discovery_source" not in tools, "internal outline search must not be advertised")
        assert_true("app_select_outline_discovery_context" not in tools, "outline context HTTP method must be removed")
        assert_true("app_save_outline_query_plan" not in tools, "internal outline plan persistence must not be advertised")
        assert_true("app_save_confirmed_research_focuses" not in tools, "removed focus method must not be advertised")
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


def test_bundle_contract():
    bundle_js = "\n".join(path.read_text(encoding="utf-8") for path in (APP_ROOT / "bundle").glob("assets/*.js"))
    manifest = json.loads((APP_ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert_true(manifest["required_executas"][0]["tool_id"] == "bundled:researcher", "manifest should reference bundled researcher tool")
    assert_true(manifest["required_executas"][0]["min_version"] == "0.3.0", "manifest should require tool 0.3.0")
    assert_true(manifest["ui"]["host_api"]["llm"] == ["complete", "embed"], "manifest should authorize completion and Executa-backed embeddings")
    assert_true(manifest["ui"]["host_api"]["agent"]["session"]["auto"] is True, "manifest should authorize agent auto sessions")
    assert_true(manifest["ui"]["host_api"]["agent"]["tools"] == [], "section sessions should not receive researcher tools")
    assert_true("host.agent" not in manifest["permissions"], "agent access should be granted through ui.host_api.agent")
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


def test_tavily_prefetch_threshold(tmp_path: Path):
    calls = []

    def browser_extractor(urls, **kwargs):
        calls.append((urls, kwargs))
        return [
            ExtractedPage(
                url=url,
                raw_content="Crawled article with varied research evidence, dates, organizations, and supporting details. " * 3,
                content_type="html",
            )
            for url in urls
        ]

    long_summary = "x" * (TAVILY_PREFETCH_MIN_CHARS + 1)
    enriched = enrich_tavily_items(
        [
            {"url": "https://long.example", "content": long_summary},
            {"url": "https://short.example", "content": "x" * TAVILY_PREFETCH_MIN_CHARS},
        ],
        browser_extractor=browser_extractor,
    )

    assert_true(enriched[0]["raw_content"] == long_summary, "long Tavily content should be treated as prefetched")
    assert_true(enriched[0]["content_type"] == "tavily_summary", "prefetched Tavily content should retain its origin")
    assert_true(enriched[1]["content_type"] == "html", "short Tavily content should use Crawl4AI output")
    assert_true(calls == [(["https://short.example"], {"timeout": 15.0})], "only short Tavily content should be crawled")


def test_tavily_short_summary_fallback(tmp_path: Path):
    enriched = enrich_tavily_items(
        [{"url": "https://short.example", "content": "short evidence summary"}],
        browser_extractor=lambda urls, **kwargs: [
            ExtractedPage(url=url, content_type="html", status="failed", error="timeout") for url in urls
        ],
    )

    assert_true(enriched[0]["extraction_status"] == "success", "short summary fallback should remain usable")
    assert_true(enriched[0]["content_type"] == "tavily_summary_fallback", "fallback origin should be explicit")
    assert_true(enriched[0]["raw_content"] == "short evidence summary", "fallback should preserve Tavily summary")


def test_tavily_prefetch_persists_web_document(tmp_path: Path):
    class FakeTavilyExecutor:
        def call(self, definition, query):
            return SourceCallResult(
                source_id="tavily",
                source_name="Tavily",
                query=query,
                items=[{"url": "https://example.com/tavily", "title": "Tavily", "content": "summary " * 20}],
                error=None,
            )

    root = tmp_path / ".research"
    jobs = JobStore(root=root)
    dispatcher = AppDispatcher(settings=SettingsStore(root=root), jobs=jobs, executor=FakeTavilyExecutor())
    dispatcher.credentials.set_token("tavily", "tvly-test-token")
    job = jobs.create(query="anna")
    jobs.save_confirmed_outline(
        job["research_id"],
        [{"id": "section-1", "title": "One", "outline": "Research one.", "allowed_source_ids": ["tavily"], "max_iterations": 1}],
    )

    dispatcher.dispatch(
        "app_call_section_research_source",
        {"research_id": job["research_id"], "section_id": "section-1", "iteration": 1, "source_id": "tavily", "queries": ["anna"]},
    )

    stored = jobs.load(job["research_id"])["section_iterations"]["section-1"][0]["raw_results"][0]
    assert_true(bool(stored.get("document_id")), "prefetched Tavily content should be detached into the Web Document Store")
    assert_true("raw_content" not in stored, "Tavily full content should not remain inline in the job")
    document = dispatcher.web_documents.get(job["research_id"], stored["document_id"])
    assert_true(document and document["content"] == ("summary " * 20).strip(), "Web Document Store should contain the Tavily prefetched text")


def test_tavily_reports_only_usable_results(tmp_path: Path):
    class FakeTavilyExecutor:
        def call(self, definition, query):
            return SourceCallResult(
                source_id="tavily",
                source_name="Tavily",
                query=query,
                items=[{"url": "https://example.com/failed", "title": "Failed", "content": ""}],
                error=None,
            )

    root = tmp_path / ".research"
    jobs = JobStore(root=root)
    dispatcher = AppDispatcher(
        settings=SettingsStore(root=root),
        jobs=jobs,
        executor=FakeTavilyExecutor(),
        tavily_enricher=lambda items, **kwargs: [
            {**item, "extraction_status": "failed", "extraction_error": "timeout"} for item in items
        ],
    )
    dispatcher.credentials.set_token("tavily", "tvly-test-token")
    job = jobs.create(query="anna")
    jobs.save_confirmed_outline(
        job["research_id"],
        [{"id": "section-1", "title": "One", "outline": "Research one.", "allowed_source_ids": ["tavily"], "max_iterations": 1}],
    )

    response = dispatcher.dispatch(
        "app_call_section_research_source",
        {"research_id": job["research_id"], "section_id": "section-1", "iteration": 1, "source_id": "tavily", "queries": ["anna"]},
    )

    assert_true(response["source_call"]["results_count"] == 0, "failed extraction should not count as usable evidence")
    assert_true(response["source_call"]["candidate_count"] == 1, "candidate count should remain observable")
    stored_call = jobs.load(job["research_id"])["section_iterations"]["section-1"][0]["source_calls"][0]
    assert_true(stored_call["results_count"] == 0, "persisted source call should use the usable result count")
    assert_true(stored_call["candidate_count"] == 1, "persisted source call should preserve candidate count")


def main():
    tests = [
        ("settings", test_settings),
        ("job_shell", test_job_shell),
        ("image_attachment_analysis", test_image_attachment_analysis_context),
        ("concurrent_attachment_embeddings", test_concurrent_attachment_embeddings),
        ("embedding_fetch_failed_retry", test_embedding_fetch_failed_retry),
        ("section_large_payload_transfer", test_section_large_payload_transfer),
        ("section_context_iteration_filter", test_section_context_can_filter_one_deep_research_iteration),
        ("outline_discovery_backend_orchestration", test_outline_discovery_backend_orchestration),
        ("outline_discovery_parallel_queries", test_outline_discovery_parallel_queries),
        ("source_test_transfer", test_source_test_transfer),
        ("selector", lambda tmp: test_selector()),
        ("hybrid_per_query_top_eight", test_hybrid_selector_per_query_top_eight_and_threshold),
        ("duckduckgo_native", test_duckduckgo_native_search_adapter),
        ("tavily_prefetch_threshold", test_tavily_prefetch_threshold),
        ("tavily_short_summary_fallback", test_tavily_short_summary_fallback),
        ("tavily_prefetch_web_document", test_tavily_prefetch_persists_web_document),
        ("tavily_usable_result_count", test_tavily_reports_only_usable_results),
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
