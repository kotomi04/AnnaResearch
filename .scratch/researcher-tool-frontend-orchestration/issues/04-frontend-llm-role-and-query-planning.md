Status: ready-for-agent
Labels: ready-for-agent

# Frontend LLM Role And Query Planning

## Parent

Frontend-Owned Anna Researcher With Standalone Researcher Tool PRD

## What to build

Move Adaptive Research Role and Bounded Query Planning into the Anna App Shell. The frontend should use direct `anna.llm.complete` calls for role selection and query planning, omit `maxTokens` from every LLM request, parse structured planning output, and persist planned metadata to the recoverable job.

This slice should stop before web search. It proves frontend-owned LLM orchestration and recovery of role/planning outputs.

## Acceptance criteria

- [ ] The Anna App manifest authorizes frontend `anna.llm.complete`.
- [ ] The frontend calls `anna.llm.complete` for Adaptive Research Role.
- [ ] The frontend calls `anna.llm.complete` for Bounded Query Planning.
- [ ] Frontend LLM calls do not include `maxTokens`.
- [ ] Role selection output is parsed into app-owned job metadata.
- [ ] Query planning output is parsed into a bounded list of search queries.
- [ ] The original user query is always retained in the search query list.
- [ ] Invalid query planning JSON falls back to the original user query.
- [ ] Planned role and search query metadata are persisted through the job update method.
- [ ] Stage and progress move through `select_role` and `plan_queries` under frontend control.
- [ ] The frontend does not use Anna Agent session for this flow.
- [ ] Frontend tests verify LLM call shapes, absence of `maxTokens`, successful parsing, invalid JSON fallback, original query retention, and persisted metadata updates.

## Blocked by

- 03-recoverable-research-job-shell

