# GPT Researcher Anna Adaptation

This context describes the language for adapting GPT Researcher into an Anna App while preserving the research engine as a reusable capability.

## Language

**Anna App Adapter MVP**:
The first migration slice: a minimal Anna App shell and Executa wrapper around the existing GPT Researcher engine, proving the end-to-end Anna invocation path before replacing deeper internals. It intentionally does not mean a full feature-equivalent rewrite of the original FastAPI/WebSocket app.
_Avoid_: Full migration, rewrite, final Anna-native app

**GPT Researcher Engine**:
The existing Python research core that plans research, gathers sources, builds context, and writes a report. One Anna App Adapter MVP uses one engine invocation to produce one research result.
_Avoid_: Backend, server

**Executa Wrapper**:
The previous MVP term for an Anna stdio tool process that wrapped research execution. For the refactored adapter, use Researcher Tool Backend when referring to the app's backend tool boundary.
_Avoid_: FastAPI backend, web server

**Anna App Shell**:
The static SPA bundle loaded by Anna App Runtime to collect user input, orchestrate frontend-owned research reasoning, and display research results. It communicates through Anna host APIs rather than directly calling GPT Researcher's original HTTP/WebSocket endpoints.
_Avoid_: Original frontend, FastAPI static site

**Researcher Tool Backend**:
The independent Executa tool backend for the Anna Researcher App. It provides app-facing tool methods for local or large non-LLM work, and it is not the owner of LLM or Agent reasoning.
_Avoid_: Executa Wrapper, FastAPI backend, GPT Researcher backend

**Researcher Tool Protocol**:
The Executa v2 stdio protocol boundary implemented by the Researcher Tool Backend. It supports v2 initialization for app tool calls but does not declare LLM sampling or Agent capabilities.
_Avoid_: v1-only tool, backend sampling protocol, Agent-capable backend

**Researcher Tool Project**:
The standalone project directory that contains the Researcher Tool Backend source, tests, and packaging metadata. It is developed as an independent tool project rather than as source embedded inside an Anna App `executas` directory.
_Avoid_: app executa source folder, copied backend, embedded tool implementation

**App Executa Reference**:
The minimal Anna App `executas` entry that points the app runtime at the Researcher Tool Project. It is a reference for discovery and launch, not the backend source of truth.
_Avoid_: duplicated tool source, symlinked source tree, generated backend copy

**Async Research Job**:
A frontend-owned research run identified by a research identifier and backed by recoverable persisted data. The Researcher Tool Backend stores key backend step outputs, but it does not own the research advancement loop.
_Avoid_: Backend-owned run, blocking report generation

**Research Result**:
The completed output of an Async Research Job, including the report text and selected metadata such as source URLs and costs. It is the user-facing product of Anna Researcher.
_Avoid_: Raw logs, internal context

**Executa Local Job Store**:
The local storage owned by the Researcher Tool Backend for recoverable Async Research Job data and Research Results under `~/anna-workspace/.research`. The Anna App Shell reads and writes it only through App Tool Methods, not by accessing files directly.
_Avoid_: Anna App Storage, browser storage, FastAPI report store

**Research Tool Dispatcher**:
The previous MVP term for a single action-dispatching tool method. For the refactored adapter, use App Tool Methods because the Researcher Tool Backend exposes explicit app-facing methods instead of an action parameter.
_Avoid_: app-facing method contract, endpoint-style tool methods

**App Tool Methods**:
The explicit `app_*` tool methods exposed by the Researcher Tool Backend for the Anna App Shell. The refactored method set covers settings, research job creation and metadata updates, web search, context selection, result persistence, and single job retrieval; the old `research` action dispatcher is not part of the refactored contract.
_Avoid_: action dispatcher, research endpoint, backend route

**Single Active Job**:
The MVP concurrency rule that one Executa Wrapper runs at most one Async Research Job at a time. A new start request while another job is running reports the current job instead of launching another.
_Avoid_: Unlimited jobs, parallel research runs

**Anna Sampling LLM**:
The Anna-hosted LLM path used by the Anna App Shell for research reasoning. It makes Anna responsible for model routing, billing, and quota instead of requiring the Researcher Tool Backend to own an external LLM API key.
_Avoid_: External LLM, plugin-owned OpenAI key, tool-owned sampling path

**Frontend LLM Completion**:
The Anna App Shell's direct LLM completion path for bounded research reasoning. It is the preferred refactored path for role selection, query planning, and report writing when a multi-turn Agent session is not needed.
_Avoid_: backend sampling, Agent session, external model key

**Research Report Only**:
The MVP report-type boundary where the adapter supports only the standard research report and excludes detailed, deep, resource, outline, and multi-agent reports. It keeps the first Anna Sampling LLM integration on the main report path.
_Avoid_: Full report type parity

**Web Research Sources**:
The MVP source boundary where research uses web search plus optional domain filtering. It excludes user-provided source URLs, local documents, hybrid document search, Azure storage, and Anna file ingestion.
_Avoid_: Source URL ingestion, local documents, hybrid sources, Azure sources

**Tavily Required Credential**:
The search boundary where web retrieval depends on a Tavily API key configured by the app user and stored as local Researcher Tool Settings. Without that key, web search is a user-resolvable configuration error.
_Avoid_: Anonymous search fallback, retriever picker, job-scoped Tavily key

**Researcher Tool Settings**:
Local per-machine settings owned by the Researcher Tool Backend under `~/anna-workspace/.research`. They may hold user-provided service keys such as Tavily, but they are not job records or frontend bundle state.
_Avoid_: Anna platform credentials, job store data, browser storage

**Masked Tool Setting**:
A user-visible settings value that confirms local configuration without exposing the full secret. The Anna App Shell may display masked service-key previews, but complete keys should only flow from user input into an App Tool Method.
_Avoid_: full credential echo, secret in UI state, secret in result data

**LLM Boundary Adapter**:
The MVP integration point where Anna Sampling LLM is connected at the GPT Researcher Engine's chat-completion boundary, keeping the original report flow mostly intact while replacing external model calls. It is narrower than a full LangChain provider and broader than an environment-variable proxy.
_Avoid_: Full LLM provider rewrite, OpenAI-compatible proxy

**Minimal Research Result**:
The shape of a Research Result persisted by the Researcher Tool Backend: the completed markdown report, source URL evidence, job status, failure summary when relevant, and basic timestamps. It excludes generated document exports, full internal research context, and full history management from the default user-facing result.
_Avoid_: File export bundle, debug context dump

**Polling Job Observation**:
The previous MVP communication pattern where the Anna App Shell repeatedly invoked a backend dispatcher to advance or read a backend-owned job. In the refactored adapter, frontend-owned orchestration should use App Tool Methods for specific persisted data and backend work instead.
_Avoid_: WebSocket progress stream, server-sent events, direct file reads from the app

**Invoke-Advanced Research Job**:
The previous MVP behavior where a backend-owned Async Research Job progressed through repeated short tool invocations. For the refactored adapter, do not use this term for frontend-owned research orchestration.
_Avoid_: frontend-owned research orchestration, detached background research run

**Context Selector**:
The research boundary that turns collected search results into the bounded context passed to frontend report generation. It is deterministic backend data processing, not LLM or Agent reasoning.
_Avoid_: Hard-coded embedding compressor, prompt-level result dumping

**Lexical Context Selector**:
The Context Selector implementation that ranks and trims web search results using deterministic lexical signals such as keyword overlap, title matches, URL deduplication, source limits, and context budget. It avoids external embedding credentials and local model dependencies.
_Avoid_: OpenAI embedding requirement, local embedding runtime

**Anna Research Orchestrator**:
The frontend-owned research flow in the Anna App Shell. It coordinates Anna LLM or Agent calls with App Tool Methods instead of advancing a backend-owned research state machine.
_Avoid_: backend orchestrator, direct GPTResearcher runtime invocation, full backend port

**Adaptive Research Role**:
The research behavior where Frontend LLM Completion chooses a research role for the query before planning searches and writing the report. It remains an explicit frontend orchestration stage rather than hidden inside backend work.
_Avoid_: Fixed-only researcher role, implicit role selection

**Bounded Query Planning**:
The planning behavior where Frontend LLM Completion may generate a small structured set of search queries, while the original user query is always retained and invalid planning output falls back to the original query. It excludes iterative deep-research planning.
_Avoid_: Unbounded query expansion, deep research planning

**Tavily Summary Retrieval**:
The retrieval behavior where the Researcher Tool Backend uses Tavily search results as the source text for context selection, without independently scraping each result URL. It may merge results from multiple frontend-planned search queries, and source URLs are preserved as evidence while full-page extraction is deferred.
_Avoid_: Browser scraping, full-page extraction, image scraping

**Core Research Actions**:
The previous MVP action set for the Research Tool Dispatcher. For the refactored adapter, use App Tool Methods and avoid modeling frontend-owned research orchestration as backend actions.
_Avoid_: app method set, backend route set, full job management API

**Single-Page Research Workbench**:
The MVP Anna App Shell experience: one page for entering a research query, optionally constraining domains, observing job progress, and reading the markdown report with source URLs. It excludes report-type switching, exports, follow-up chat, history, and multi-job management.
_Avoid_: Original frontend parity, multi-report dashboard

**Engineered Anna App Shell**:
An Anna App Shell maintained as structured frontend source and compiled into the static SPA bundle that Anna loads. It preserves the static-bundle runtime contract while avoiding direct long-term editing of generated HTML and script files.
_Avoid_: Hand-maintained bundle script, server-rendered app shell

**Bilingual App Shell UI**:
The MVP language scope where the Anna App Shell's controls, labels, status messages, and user-facing errors support Chinese and English. It does not require the Research Result or Anna Research Orchestrator prompts to follow the UI language.
_Avoid_: Report language policy, backend prompt localization

**App Shell Locale Preference**:
The frontend-only language preference for Bilingual App Shell UI. It is inferred from the browser language on first load, can be changed by the user in the app shell, and is remembered locally without requiring Anna host storage permissions.
_Avoid_: Backend language setting, Anna storage-backed preference

**Committed App Shell Bundle**:
The built static SPA output that Anna loads and that remains committed alongside the Engineered Anna App Shell source. It is not the normal editing surface; source changes should be made in the frontend source and then rebuilt into the committed bundle.
_Avoid_: Ignored runtime bundle, hand-edited generated bundle

**App Shell Build Workflow**:
The frontend build workflow for the Engineered Anna App Shell. It builds source-managed UI code into the Committed App Shell Bundle without making Anna runtime startup part of the default agent workflow.
_Avoid_: Anna runtime dev startup, manual bundle editing

**Typed App Shell Messages**:
The Bilingual App Shell UI message strategy where Chinese and English text live in local type-checked dictionaries keyed by stable message identifiers. It avoids introducing a full localization framework for the MVP app shell.
_Avoid_: Remote language packs, backend-owned UI copy

**Localized Status Mapping**:
The Bilingual App Shell UI behavior where frontend research statuses, frontend stages, and known backend error codes are translated from stable values. Raw backend messages remain available as fallback details but are not the primary localized copy.
_Avoid_: Backend-localized UI messages, locale-dependent tool contract

**App Shell Frontend Boundaries**:
The Engineered Anna App Shell source organization that separates Anna tool API access, research job state, bilingual messages, presentation components, and shared types. It keeps the UI from depending directly on JSON-RPC payload construction.
_Avoid_: Monolithic app script, component-owned tool protocol

**Safe Report Markdown Rendering**:
The frontend rendering boundary for Research Result markdown. The app shell renders markdown through a React-safe markdown component and does not build report HTML through string concatenation or raw HTML injection.
_Avoid_: Hand-written markdown-to-HTML, raw report HTML injection

## Example Dialogue

Developer: "Should the refactored Anna Researcher backend still own the research state machine?"

Domain expert: "No. The Anna Research Orchestrator is frontend-owned. The Researcher Tool Backend only performs app-facing backend work through App Tool Methods."

Developer: "Should the Researcher Tool Backend call Anna Sampling LLM or Anna Agent?"

Domain expert: "No. Use Frontend LLM Completion from the Anna App Shell for role selection, query planning, and report writing."

Developer: "Should the app keep the old `research` method with `action=start|advance|get_result`?"

Domain expert: "No. The refactored contract is explicit App Tool Methods such as settings, search, context selection, and result persistence."

Developer: "Where does the tool source live?"

Domain expert: "In the standalone Researcher Tool Project. The Anna App `executas` directory keeps only an App Executa Reference."

Developer: "Where should user-provided Tavily configuration live?"

Domain expert: "In Researcher Tool Settings under `~/anna-workspace/.research`; the UI can display only a Masked Tool Setting."

Developer: "Should search scrape every result page before context selection?"

Domain expert: "No. Use Tavily Summary Retrieval and pass those results through the Lexical Context Selector."

Developer: "Should the first refactored version support detailed and deep reports?"

Domain expert: "No. It is Research Report Only."

Developer: "Can the app research local PDFs?"

Domain expert: "No. It uses Web Research Sources only."

Developer: "Should the result contract preserve the original backend's PDF, DOCX, MD, and JSON file outputs?"

Domain expert: "No. Persist a Minimal Research Result: markdown report plus source URL evidence and job metadata."

Developer: "Should the first Anna App Shell port the original GPT Researcher frontend feature set?"

Domain expert: "No. Build a Single-Page Research Workbench for the Anna App Adapter MVP."

Developer: "Should the Anna App Shell continue to be maintained as hand-written files inside the runtime bundle?"

Domain expert: "No. Move to an Engineered Anna App Shell while preserving the static SPA bundle output."

Developer: "Should UI bilingual support also force the generated research report language?"

Domain expert: "No. Bilingual App Shell UI covers the frontend surface only; report language policy remains separate."

Developer: "Should the app request Anna storage permissions just to remember the UI language?"

Domain expert: "No. Use App Shell Locale Preference and keep it frontend-only."

Developer: "Should the engineered frontend stop committing the static Anna bundle?"

Domain expert: "No. Keep a Committed App Shell Bundle so the Anna runtime entry remains available."

Developer: "Should normal frontend build scripts start Anna runtime or bridge processes?"

Domain expert: "No. Use an App Shell Build Workflow that builds static assets without starting Anna runtime."

Developer: "Does the MVP need a full i18n framework for two UI languages?"

Domain expert: "No. Use Typed App Shell Messages for the Bilingual App Shell UI."

Developer: "Should the Executa Wrapper return localized error messages for the app shell?"

Domain expert: "No. Use Localized Status Mapping in the frontend and keep the tool contract language-neutral."

Developer: "Should the engineered frontend put tool calls, polling, i18n, and presentation into one component?"

Domain expert: "No. Use App Shell Frontend Boundaries so each concern remains testable."

Developer: "Should the app shell continue rendering LLM-produced report markdown through hand-built HTML strings?"

Domain expert: "No. Use Safe Report Markdown Rendering."
