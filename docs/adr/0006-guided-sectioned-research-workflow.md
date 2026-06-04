# Guided Sectioned Research Workflow Owned By Anna App Shell

The Anna Researcher app will replace the one-click report-level loop with a guided Sectioned Research Job: the Anna App Shell generates draft role candidates, research focus candidates, and a two-step outline for user confirmation before researching each Report Section serially. The Researcher Tool Backend remains a non-LLM backend boundary; it persists confirmed planning data, executes allowed Research Sources, performs section context selection, stores section results, and stores the final assembled result through explicit App Tool Methods.

**Consequences**

One user research request remains one Async Research Job. Report Sections are parts of that job rather than independent jobs, so the final Research Result can preserve one user-facing run, one latest-job identity, and one assembled markdown report.

Only user-confirmed planning state is persisted. LLM-generated role candidates, Research Focus candidates, and outline drafts are front-end draft UI state until the user confirms them. Recovery after refresh restores confirmed role, confirmed focuses, confirmed outline, section progress, section results, and the final result; unconfirmed candidates may be regenerated.

The role stage generates three Research Role candidates and the user confirms exactly one. The brainstorming stage generates five Research Focus candidates and the user confirms one to five. Outline planning is two-step: Frontend LLM Completion first drafts four to six Report Sections, then a separate completion assigns Allowed Research Sources to all sections using the available Research Sources.

The Confirmed Research Outline may contain one to eight Report Sections. Each section has a user-adjustable `max_iterations` from one to ten, defaulting to five. Sections are researched serially in outline order because parallel section research would complicate rate-limit behavior, progress accounting, duplicate-call prevention, and final report assembly.

Allowed Research Sources are a strict section-level whitelist. A section's Research Step Decision prompt may only expose that section's allowed sources, and backend section methods should validate that section source calls stay inside the whitelist. The same `(source_id, normalized_query)` may be repeated in different sections, but duplicate calls are rejected within the same Section Research Step Log.

Each section runs the existing iterative evidence loop shape against its own section prompt: Research Step Decision calls alternate with Research Source calls until the section reaches a finish decision or its section-level iteration limit. Lexical Context Selector runs per section over that section's evidence, and the section writer produces both `section_markdown` and a Section Summary in one structured Frontend LLM Completion call. If structured parsing fails, the app may treat the model text as section markdown and derive a minimal summary.

Section failure stops the whole Sectioned Research Job. Individual Research Source errors can be recorded and fed back into the section's Research Step Log, but if a section cannot produce section markdown, later sections do not run and the job fails rather than producing a silent partial report.

Final report generation uses Report Framing rather than a full-report rewrite. The final LLM completion receives the original query, confirmed focuses, outline titles, and Section Summaries, then generates only the report title, introduction, and conclusion. Code assembles the final markdown from that framing output plus the section markdown in Confirmed Research Outline order, avoiding a second LLM pass over all section text.

The generic `app_update_research_job` method must not become an arbitrary write surface for complex section data. Sectioned research should use explicit App Tool Methods for saving the confirmed plan, appending section iterations, selecting section context, saving section results, and saving or transferring the assembled result.
