Status: ready-for-agent
Labels: ready-for-agent

# Recoverable Research Job Shell

## Parent

Frontend-Owned Anna Researcher With Standalone Researcher Tool PRD

## What to build

Add the recoverable Async Research Job shell used by frontend-owned orchestration. The frontend should create a research id before LLM or search work begins, update only approved job metadata as stages progress, and recover the latest job on app load without treating an empty workspace as an error.

This slice should not perform LLM calls or live search. It establishes the persisted job model and the frontend state plumbing that later slices build on.

## Acceptance criteria

- [ ] `app_create_research_job` creates a job record and returns a `research_id`.
- [ ] Created jobs store query, normalized domain filters, initial status, initial stage, progress, and timestamps.
- [ ] Creating a job records it as the latest job.
- [ ] `app_update_research_job` updates only approved app-owned metadata fields.
- [ ] Approved metadata includes status, stage, progress, agent role fields, planned search queries, and errors.
- [ ] `app_update_research_job` rejects secret-like fields, arbitrary paths, and arbitrary unapproved fields.
- [ ] `app_get_research_job` returns a specific job when a valid `research_id` is provided.
- [ ] `app_get_research_job` without `research_id` returns the latest job when one exists.
- [ ] `app_get_research_job` without `research_id` returns success with `job: null` when no job exists.
- [ ] `app_get_research_job` returns not found when an explicit missing `research_id` is provided.
- [ ] The frontend owns and displays stable stage names including `select_role`, `plan_queries`, `search_next_query`, `select_context`, `write_report`, and `completed`.
- [ ] The frontend can create a job and recover it on app reload in a fake runtime test.
- [ ] Backend tests cover create, update whitelist, latest recovery, null empty state, explicit not found, and malformed record behavior.
- [ ] Frontend tests cover create-job flow, local stage display, and latest-job recovery.

## Blocked by

- 01-standalone-tool-contract-cutover

