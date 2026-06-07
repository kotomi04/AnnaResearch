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

**Sectioned Research Job**:
An Async Research Job whose final Research Result is assembled from multiple user-confirmed report sections. The job remains one user-facing research run; sections are parts of that run rather than independent jobs.
_Avoid_: Multiple jobs per report, separate report jobs, backend-owned section runs

**Report Section**:
A user-visible part of a Sectioned Research Job, with a title, outline content, allowed Research Sources, and its own research iteration limit. Each Report Section produces section-level evidence and markdown that later contributes to the final Research Result.
_Avoid_: Independent research job, hidden subtask, generic paragraph

**Report Section Set**:
The user-confirmed collection of Report Sections in a Confirmed Research Outline. Outline planning defaults to four to six sections, while the user may confirm one to eight sections; each section has a user-adjustable iteration limit from one to ten, defaulting to five.
_Avoid_: Unlimited outline, fixed single-section report, global-only iteration limit

**Serial Section Research**:
The Sectioned Research Job behavior where Report Sections are researched one at a time in the user-confirmed outline order. The Anna Research Orchestrator completes one section's evidence gathering and section markdown before moving to the next section.
_Avoid_: Parallel section research, background section fan-out, unordered section runs

**Section Failure Stops Job**:
The failure behavior where a Report Section that cannot produce section markdown causes the containing Sectioned Research Job to fail and stops later sections from running. Individual Research Source call errors may still be recorded inside a section before the section itself fails.
_Avoid_: Partial success report, skipped failed section, silent incomplete report

**Section Summary**:
A compact summary of a completed Report Section used for final report framing. It captures the section's key findings without replacing the section markdown or becoming a new evidence source.
_Avoid_: Full section rewrite, hidden final context, raw evidence dump

**Section Writer Output**:
The structured section-generation output that contains both section markdown and a Section Summary from one Frontend LLM Completion call. If structured parsing fails, the app may fall back to treating the model text as section markdown and deriving a minimal summary.
_Avoid_: Separate required summary call, markdown-only section contract, final-report rewrite input

**Report Framing**:
The final Frontend LLM Completion step that generates a report title, introduction, and conclusion from the original query, confirmed focuses, outline titles, and Section Summaries. It does not receive or rewrite all section markdown.
_Avoid_: Final full-report rewrite, second research pass, section content regeneration

**Assembled Research Report**:
The final Research Result markdown produced by code-level assembly of Report Framing output and section markdown in the Confirmed Research Outline order.
_Avoid_: LLM-rewritten final report, unordered section bundle, template-only report

**Allowed Research Sources**:
The strict Report Section-level whitelist of Research Sources that the Anna Research Orchestrator may use while researching that section. It is not a soft recommendation; sources outside the whitelist are unavailable for that section's Research Step Decisions.
_Avoid_: Recommended sources, preferred sources, global enabled sources

**Executa Local Job Store**:
The local storage owned by the Researcher Tool Backend for recoverable Async Research Job data and Research Results under `~/anna-workspace/.research`. The Anna App Shell reads and writes it only through App Tool Methods, not by accessing files directly.
_Avoid_: Anna App Storage, browser storage, FastAPI report store

**Research Tool Dispatcher**:
The previous MVP term for a single action-dispatching tool method. For the refactored adapter, use App Tool Methods because the Researcher Tool Backend exposes explicit app-facing methods instead of an action parameter.
_Avoid_: app-facing method contract, endpoint-style tool methods

**App Tool Methods**:
The explicit `app_*` tool methods exposed by the Researcher Tool Backend for the Anna App Shell. The refactored method set covers settings, research job creation and metadata updates, web search, context selection, result persistence, and single job retrieval; the old `research` action dispatcher is not part of the refactored contract.
_Avoid_: action dispatcher, research endpoint, backend route

**Sectioned Research App Tool Methods**:
The explicit App Tool Methods used to persist and process Sectioned Research Job data such as the confirmed research plan, section iterations, section context selection, and section results. They avoid turning generic job metadata updates into an arbitrary write surface.
_Avoid_: Generic section blob update, frontend-owned file schema writes, action-style section dispatcher

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

**Local Result Transfer Server**:
A local transfer boundary used by the Anna App Shell and Researcher Tool Backend when a research payload is too large for the Researcher Tool Protocol. It covers completed Research Results, selected context, Section Writer Output, and assembled sectioned reports. It keeps App Tool Methods for control messages while leaving the Executa Local Job Store as the owner of persisted job records and results.
_Avoid_: public web API, replacement backend, direct file access from the app shell

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

**Confirmed Research Role**:
The user-selected and optionally edited Adaptive Research Role that becomes part of the Async Research Job. LLM-generated role candidates are draft UI options until the user confirms one.
_Avoid_: Role candidate, automatic role, hidden role choice

**Research Role Candidate Set**:
The draft set of Adaptive Research Role options generated by Frontend LLM Completion for user review. The default set contains three candidates, and the user confirms exactly one role before Research Focus generation.
_Avoid_: Multiple active roles, persisted role candidates, hidden automatic role

**Research Focus**:
A user-confirmed emphasis for a Sectioned Research Job. Research Focus entries guide outline generation and section research, while LLM-generated focus candidates remain draft UI options until confirmed.
_Avoid_: Query plan, search query, hidden brainstorming note

**Research Focus Candidate Set**:
The draft set of Research Focus options generated by Frontend LLM Completion for user review. The default set contains five candidates, and the user confirms one to five entries before outline planning.
_Avoid_: Persisted focus record, unlimited brainstorming list, hidden prompt-only focus

**Editable Draft Review Card**:
The user-facing review pattern for LLM-generated draft planning items where the card first supports quick comparison and selection, while direct editing remains available on demand before confirmation. It applies to Research Role candidates, Research Focus candidates, and draft Report Sections.
_Avoid_: read-only generated option, always-expanded raw form, persisted unconfirmed draft

**Confirmed Research Outline**:
The user-confirmed set of Report Sections for a Sectioned Research Job. It is the report structure that section-level research follows after the user has edited or accepted it.
_Avoid_: Draft outline, generated-only outline, final report markdown

**Confirmed-Only Recovery**:
The recovery boundary where a Sectioned Research Job restores only user-confirmed role, focus, outline, section progress, and result data from persisted state. Unconfirmed LLM-generated candidate sets are draft UI state and may be regenerated after refresh.
_Avoid_: Persisted candidate drafts, backend-owned draft recovery, hidden autosaved brainstorm

**Two-Step Outline Planning**:
The outline planning behavior where Frontend LLM Completion first drafts Report Sections from the confirmed role and Research Focus entries, then assigns Allowed Research Sources to those sections in a separate completion using the available Research Sources.
_Avoid_: One-shot outline/source generation, per-section source prompt loop, backend outline planner

**Bounded Query Planning**:
The planning behavior where Frontend LLM Completion may generate a small structured set of search queries, while the original user query is always retained and invalid planning output falls back to the original query. It excludes iterative deep-research planning.
_Avoid_: Unbounded query expansion, deep research planning
_Deprecated_: Superseded by Iterative Research Loop. Kept here so historical references stay readable. New design replaces a single upfront query plan with one Research Step Decision per loop iteration.

**Iterative Research Loop**:
The frontend-owned multi-turn orchestration where the Anna Research Orchestrator alternates a Research Step Decision call against Anna Sampling LLM with one Research Source call, accumulating a Research Step Log until the LLM decides the evidence is sufficient or a safety cap of five iterations is reached. It replaces a single upfront query plan and remains own-orchestrated rather than handed off to Anna Agent.
_Avoid_: Anna Agent session, single-shot planning, backend-owned research loop

**Research Step Decision**:
The per-iteration structured output from Frontend LLM Completion inside the Iterative Research Loop: either a call decision naming one enabled Research Source and one or more queries for it, or a finish decision with a short reason. The decision excludes free-form tool calls and excludes calling multiple Research Sources in one iteration.
_Avoid_: Multi-source per-iteration call, free-form LLM tool call

**Research Step Log**:
The compact running summary of completed Research Step Decision calls fed back into the next decision prompt. Each entry records the iteration index, the Research Source identifier, the query, the result count, and the top result titles, so the LLM can avoid duplicate calls without re-reading raw results. It is not the persisted Research Result and is not exposed as user copy.
_Avoid_: Raw retrieval payload, full LLM transcript

**Section Research Step Log**:
The Research Step Log scoped to one Report Section. Duplicate Research Step Decisions are prevented within a section, while the same Research Source and query may be valid in another section.
_Avoid_: Job-wide duplicate log, cross-section query ban, global research log

**Progressive Research Run View**:
The user-visible running-state presentation for a Sectioned Research Job where the app incrementally reveals completed orchestration events such as active section changes, Research Source calls, selected context, section writer completion, Report Framing, and final assembly. It includes an active run indicator so the user can tell the job is still progressing, but it is not token-level LLM streaming.
_Avoid_: token streaming, raw LLM transcript, final-only loading spinner

**Tavily Summary Retrieval**:
The retrieval behavior where the Researcher Tool Backend uses Tavily search results as the source text for context selection, without independently scraping each result URL. It may merge results from multiple frontend-planned search queries, and source URLs are preserved as evidence while full-page extraction is deferred.
_Avoid_: Browser scraping, full-page extraction, image scraping

**Research Source**:
A named retrieval capability that the Anna Research Orchestrator can call to gather evidence for a research job. Each Research Source produces a stream of result items normalized to the shape consumed by the Lexical Context Selector, so Tavily and user-added external APIs participate in the same downstream pipeline.
_Avoid_: Retriever (backend-only term), data source (too generic), API connector (too implementation-flavored)

**Built-in Research Source**:
A Research Source whose configuration, request shape, and response mapping are owned by the Researcher Tool Backend and ship as part of the tool. Tavily Summary Retrieval is the first Built-in Research Source.
_Avoid_: Default retriever, hardcoded search backend

**User-Configured Research Source**:
A Research Source defined by the app user — a remote API endpoint plus the request, authentication, response mapping, pagination, and natural-language description needed for the Anna Research Orchestrator to invoke it. The user adds, edits, and removes these without changes to the Researcher Tool Backend or Anna App Shell source.
_Avoid_: Custom retriever (sounds like a code-level extension), plugin source

**Configurable Research Source Envelope**:
The supported request/response shape for User-Configured Research Source: JSON over HTTP using GET or POST, with the API key carried in either a request header or a query parameter, a flat response item array reachable by a fixed path, and at most one of page-number, offset, or cursor pagination. It intentionally excludes OAuth flows, request signing such as HMAC, non-JSON responses, multipart or streaming bodies, and user-supplied request/response transformation scripts.
_Avoid_: Generic HTTP client, full Postman parity, scripted pre/post-processing

**Research Source Panel**:
The unified Anna App Shell surface that lists every Built-in Research Source and User-Configured Research Source together so the user manages all retrieval capabilities from one place. The panel marks each entry as built-in or user-added, lets the user edit credentials for both kinds, lets the user fully edit and remove only User-Configured entries, and merges its content from separate backend methods rather than exposing the backend split.
_Avoid_: Settings page (too generic), data sources tab (loses the built-in/user distinction)

**Research Source Configuration Gate**:
The workflow boundary where users configure Research Sources before starting guided research. Once the user leaves the research need step, the guided flow no longer presents Research Source configuration entry points so source changes cannot disturb draft review or Serial Section Research.
_Avoid_: mid-workflow source editing, running-job source reconfiguration, hidden source mutation

**Core Research Actions**:
The previous MVP action set for the Research Tool Dispatcher. For the refactored adapter, use App Tool Methods and avoid modeling frontend-owned research orchestration as backend actions.
_Avoid_: app method set, backend route set, full job management API

**Single-Page Research Workbench**:
The MVP Anna App Shell experience: one page for entering a research query, choosing which Research Sources to use, observing job progress, and reading the markdown report with source URLs. It excludes report-type switching, exports, follow-up chat, history, and multi-job management.
_Avoid_: Original frontend parity, multi-report dashboard

**Guided Research Step Pages**:
The staged presentation of the Single-Page Research Workbench where the user sees one research step at a time: research need, role confirmation, focus confirmation, outline confirmation, Progressive Research Run View, and final report reading. Before the research run starts, users may return to earlier draft steps; once the run starts, the Confirmed Research Role, Research Focus entries, and Confirmed Research Outline are locked.
_Avoid_: multi-job dashboard, route-level app sections, editing confirmed planning during Serial Section Research

**Workflow Stepper**:
The top-level progress indicator for Guided Research Step Pages. It shows the user's position in the planning-and-report flow and may support returning to earlier draft steps before research starts, but it is not the running job progress meter.
_Avoid_: job progress bar, section iteration counter, source-call timeline

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
