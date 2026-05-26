import asyncio

from researcher_adapter.context_selector import LexicalContextSelector
from researcher_adapter.job_store import JobStore
from researcher_adapter.orchestrator import AnnaResearchOrchestrator
from researcher_adapter.sampling_llm import DEFAULT_SAMPLING_TIMEOUT_SECONDS, SamplingClient
from researcher_adapter.tavily_retrieval import TavilySummaryRetriever


def make_orchestrator():
    return AnnaResearchOrchestrator(
        sampling=SamplingClient(fake=True),
        retriever=TavilySummaryRetriever(fake=True),
        selector=LexicalContextSelector(max_sources=4, context_budget=4000),
    )


def test_orchestrator_advances_to_completed(tmp_path):
    store = JobStore(root=tmp_path, jobs_id="test")
    job = store.create(query="anna app adapter", query_domains=["example.com"])
    orchestrator = make_orchestrator()

    for _ in range(10):
        job = asyncio.run(orchestrator.advance(job, invoke_id="invoke-test"))
        store.save(job)
        if job["status"] == "completed":
            break

    assert job["status"] == "completed"
    assert job["stage"] == "completed"
    assert job["report_markdown"].startswith("# Research Report")
    assert job["source_urls"]
    assert job["selected_context"]


def test_orchestrator_missing_tavily_credential_fails_when_not_fake(tmp_path, monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    store = JobStore(root=tmp_path, jobs_id="test")
    job = store.create(query="anna app adapter")
    job["stage"] = "search_next_query"
    job["search_queries"] = ["anna app adapter"]
    orchestrator = AnnaResearchOrchestrator(
        sampling=SamplingClient(fake=True),
        retriever=TavilySummaryRetriever(fake=False),
        selector=LexicalContextSelector(),
    )

    job = asyncio.run(orchestrator.advance(job, invoke_id="invoke-test"))

    assert job["status"] == "failed"
    assert job["error"]["code"] == "configuration_error"


def test_sampling_timeout_is_below_default_invoke_timeout():
    assert DEFAULT_SAMPLING_TIMEOUT_SECONDS < 45
