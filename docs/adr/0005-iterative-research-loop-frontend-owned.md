# Iterative Research Loop Owned By Anna App Shell, Not Anna Agent

Status: superseded by ADR-0006

The Anna Research Orchestrator drives an Iterative Research Loop owned by the Anna App Shell, alternating one Research Step Decision call against `anna.llm.complete` with one Research Source call per iteration, accumulating a Research Step Log until the LLM emits a finish decision or a safety cap of five iterations is reached. The loop is implemented as plain frontend code rather than delegated to `anna.agent.session`. The decision is made now because the loop shape determines the structure of the progress UI, the failure-handling layer, the job store schema's `iterations[]` array, and the format of evidence assembly that flows into the Lexical Context Selector; switching to an Anna Agent session later would require rewriting all of those layers.

This decision described the original single-loop research flow. The frontend-owned, non-Agent boundary remains accepted, but the single report-level loop and global five-iteration cap are superseded by ADR-0006's guided Sectioned Research Job model.

**Consequences**

The Anna App Shell owns the loop state including `user_query`, `role`, `enabled_sources`, `research_log`, `raw_results`, `iteration`, and `max_iterations: 5`. The state is held in frontend code during execution and persisted incrementally to the Researcher Tool Backend through `app_update_research_job` after each iteration. The backend does not run a state machine of its own for this loop.

Each iteration's Research Step Decision is a single bounded `anna.llm.complete` call whose system prompt constrains the output to one of two shapes: `{ type: "call_source", source_id, queries: [...] }` or `{ type: "finish", reason: "..." }`. The decision excludes free-form tool calls and excludes calling multiple Research Sources in a single iteration; multi-source per-iteration would complicate progress display and rate-limit accounting without observable benefit.

Duplicate-call prevention is layered: the Research Step Decision prompt instructs the LLM to consult the Research Step Log before proposing a `(source_id, query)` pair, and the backend `app_call_research_source` rejects an exact `(source_id, normalized_query)` duplicate within the same research job. The two layers cover prompt drift and unintentional repetition without coupling the LLM to backend state.

Loop progress is rendered as a timeline in the Single-Page Research Workbench, appending one row per completed iteration with the source name, query, and result count. The frontend reads this directly from the Research Step Log and does not need a separate progress channel.

Failure inside an iteration is soft: a single `source_call.error` is recorded with one of the six error codes from the constrained envelope, fed back into the next Research Step Decision prompt as part of the Research Step Log, and the loop continues until finish or the safety cap. A single source failing does not terminate the job; the LLM can route around it.

Anna Agent is not used for this loop. The trade-off accepted is more frontend code now in exchange for full state control, simpler debugging, deterministic iteration accounting, and freedom from Anna Agent session lifecycle quirks. If a future requirement appears that genuinely needs Anna-side tool dispatch — for example multi-turn user clarification or long-running asynchronous tool steps — that requirement should be re-evaluated against this ADR rather than handled by silently switching execution paths.

Tests must lock the loop shape: a Research Step Decision returning a finish at iteration 1 produces a single-iteration job record; a decision returning calls for three different sources across three iterations produces three iteration entries with correct source attribution; the safety cap at five iterations terminates the loop with a deterministic completion path even if the LLM keeps emitting call decisions.
