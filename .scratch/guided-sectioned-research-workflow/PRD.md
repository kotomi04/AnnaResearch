Status: ready-for-agent
Labels: ready-for-agent

# PRD: Guided Sectioned Research Workflow

## Problem Statement

The current Anna Researcher app turns a user query into a completed research report in one automatic flow. The Anna App Shell asks Anna LLM for one research role, runs one report-level Iterative Research Loop, selects one context bundle, writes one markdown report, and stores one Minimal Research Result.

The user needs more control over the research direction before the app spends time and source quota. They want to review and edit multiple candidate research roles, choose multiple Research Focus entries, confirm a sectioned outline, strictly control which Research Sources each Report Section may use, and then let the app research each section. The final report should read as one assembled report with a title, introduction, section bodies, conclusion, and source evidence, without letting a final LLM pass rewrite all section content.

## Solution

Introduce a guided Sectioned Research Job workflow owned by the Anna App Shell. One user request still creates one Async Research Job, but the job now contains user-confirmed planning data and multiple Report Sections. The app guides the user through role selection, focus brainstorming, outline confirmation, serial section research, and final report assembly.

The role stage asks Frontend LLM Completion for three Research Role candidates. The user reviews card options, edits `server` and `agent_role_prompt` if needed, chooses exactly one Confirmed Research Role, or regenerates the candidate set with an optional regeneration instruction.

The brainstorming stage asks Frontend LLM Completion for five Research Focus candidates. The user reviews card options, edits candidates if needed, selects one to five Research Focus entries, or regenerates the set with an optional instruction.

The outline stage uses Two-Step Outline Planning. First, Frontend LLM Completion drafts four to six Report Sections from the query, Confirmed Research Role, and confirmed Research Focus entries. Second, another Frontend LLM Completion assigns Allowed Research Sources to all sections using the configured Research Sources. The user can edit section titles and outline content, add or remove allowed sources, add or delete sections, regenerate the outline with an optional instruction, and set each section's `max_iterations` from one to ten, defaulting to five. The final Confirmed Research Outline may contain one to eight sections.

After outline confirmation, the app researches Report Sections serially in outline order. Each section runs its own Iterative Research Loop. Each Research Step Decision may only choose from that section's Allowed Research Sources, and duplicate source/query prevention is scoped to the section. The Researcher Tool Backend executes source calls, persists section iterations, and performs per-section Lexical Context Selector. The section writer asks Frontend LLM Completion for structured Section Writer Output containing both `section_markdown` and a Section Summary, with a fallback when structured parsing fails.

Section failure stops the whole Sectioned Research Job. Individual source call errors remain soft evidence-loop outcomes, but if a section cannot produce section markdown, later sections do not run and the job fails rather than producing a silent partial report.

After all sections complete, the app runs Report Framing. Frontend LLM Completion receives the original query, confirmed focuses, outline titles, and Section Summaries only, then generates a report title, introduction, and conclusion. The app assembles the final markdown from the framing output plus section markdown in Confirmed Research Outline order, then persists the Assembled Research Report as the Research Result.

## User Stories

1. As an Anna user, I want the app to show multiple research role candidates, so that I can choose the perspective that best fits my research.
2. As an Anna user, I want each role candidate shown as a card, so that I can compare roles quickly.
3. As an Anna user, I want each role candidate to include `server` and `agent_role_prompt`, so that I can see what will guide the rest of the research.
4. As an Anna user, I want to edit a role candidate's `server`, so that the selected role name reflects my intent.
5. As an Anna user, I want to edit a role candidate's `agent_role_prompt`, so that the selected role behaves the way I want.
6. As an Anna user, I want to select exactly one role candidate, so that the app has one clear Confirmed Research Role.
7. As an Anna user, I want to regenerate role candidates, so that I can get better options when the first set is not useful.
8. As an Anna user, I want a regeneration dialog where I can optionally type requirements, so that I can steer the next role candidate set.
9. As an Anna user, I want to regenerate role candidates without typing requirements, so that I can quickly ask Anna LLM for another set.
10. As an Anna user, I want role candidate drafts to be replaceable before confirmation, so that the UI stays focused on the latest options.
11. As an Anna user, I want only my final Confirmed Research Role persisted, so that unchosen draft roles do not become part of the research record.
12. As an Anna user, I want a brainstorming page after role selection, so that I can shape the research before the outline is generated.
13. As an Anna user, I want the app to generate multiple Research Focus candidates, so that I can choose the areas that matter most.
14. As an Anna user, I want Research Focus candidates shown as cards, so that I can review them without reading a long prompt transcript.
15. As an Anna user, I want to edit Research Focus candidate text, so that I can tune a focus before selecting it.
16. As an Anna user, I want to select more than one Research Focus, so that the report can cover multiple priorities.
17. As an Anna user, I want to select at least one Research Focus, so that the outline has a clear direction.
18. As an Anna user, I want to select up to five Research Focus entries, so that the report does not become unfocused.
19. As an Anna user, I want to regenerate Research Focus candidates with optional requirements, so that I can steer brainstorming without starting over.
20. As an Anna user, I want only my confirmed Research Focus entries persisted, so that discarded brainstorming drafts do not pollute the job.
21. As an Anna user, I want the app to generate a sectioned outline from my query, role, and focuses, so that the report has a structure I can approve.
22. As an Anna user, I want the outline to default to four to six sections, so that the first draft is useful without being too long.
23. As an Anna user, I want to confirm an outline with one to eight Report Sections, so that short and long reports are both possible.
24. As an Anna user, I want each Report Section to have a title, so that I can understand the final report structure.
25. As an Anna user, I want each Report Section to have outline content, so that the app knows what that section should cover.
26. As an Anna user, I want to edit section titles directly, so that section headings match my vocabulary.
27. As an Anna user, I want to edit section outline content directly, so that each section covers the right angle.
28. As an Anna user, I want to add a section, so that I can cover a missing topic before research begins.
29. As an Anna user, I want to delete a section, so that irrelevant outline parts do not consume source quota.
30. As an Anna user, I want the app to assign Allowed Research Sources to each section, so that each section uses appropriate evidence sources.
31. As an Anna user, I want source assignment to happen after outline generation, so that source choices match the actual section topics.
32. As an Anna user, I want each section's Allowed Research Sources to be editable, so that I can override LLM source assignment.
33. As an Anna user, I want to add a Research Source to a section's allowed list, so that the section can use a source I trust.
34. As an Anna user, I want to remove a Research Source from a section's allowed list, so that the section cannot use an unsuitable source.
35. As an Anna user, I want Allowed Research Sources to be a strict whitelist, so that the LLM cannot call sources outside the section's allowed set.
36. As an Anna user, I want the app to prevent confirming a section with no allowed configured source, so that the section can actually run.
37. As an Anna user, I want to set each section's maximum iterations from one to ten, so that I can control depth and cost section by section.
38. As an Anna user, I want each section's maximum iterations to default to five, so that the default stays close to the existing research depth.
39. As an Anna user, I want to regenerate the outline with optional requirements, so that I can ask for a different structure.
40. As an Anna user, I want regeneration to replace the current outline draft before confirmation, so that I am not forced to merge several drafts manually.
41. As an Anna user, I want the final Confirmed Research Outline persisted, so that the app can recover the approved structure after refresh.
42. As an Anna user, I want unconfirmed candidate drafts not to be restored after refresh, so that recovery focuses on decisions I actually confirmed.
43. As an Anna user, I want the research page to show which Report Section is currently running, so that I understand progress through the outline.
44. As an Anna user, I want sections researched serially in outline order, so that the app's progress is predictable.
45. As an Anna user, I want each section to run its own evidence loop, so that the app can gather evidence specifically for that section.
46. As an Anna user, I want a section's Research Step Decisions to see only that section's allowed sources, so that the strict whitelist is enforced before source calls.
47. As an Anna user, I want a section's source calls rejected if they try to use a source outside the allowed list, so that backend validation protects the workflow.
48. As an Anna user, I want duplicate source/query calls rejected within one section, so that a section does not waste iterations repeating itself.
49. As an Anna user, I want the same source/query to be allowed in another section, so that separate sections can use the same evidence when it is relevant.
50. As an Anna user, I want source call errors recorded inside the section, so that the app can explain what happened.
51. As an Anna user, I want individual source call errors to be soft where possible, so that the section can continue when another query or source may work.
52. As an Anna user, I want a section failure to stop the whole job, so that the app does not produce a silent partial report.
53. As an Anna user, I want the app to make clear which section failed, so that I know where the research stopped.
54. As an Anna user, I want per-section Lexical Context Selector, so that each section writer receives only evidence relevant to that section.
55. As an Anna user, I want each section writer to produce section markdown, so that the final report has real body content for that section.
56. As an Anna user, I want each section writer to produce a Section Summary at the same time, so that final report framing can be generated without re-reading all section text.
57. As an Anna user, I want malformed structured section output to fall back gracefully, so that a useful markdown section is not discarded only because JSON parsing failed.
58. As an Anna user, I want section markdown ordered according to the Confirmed Research Outline, so that the final report reflects my approved structure.
59. As an Anna user, I want the final report to include a generated title, so that the result reads like a complete report.
60. As an Anna user, I want the final report to include an introduction, so that readers understand the purpose and scope.
61. As an Anna user, I want the final report to include a conclusion, so that readers get a synthesized ending.
62. As an Anna user, I want the final LLM framing step to use Section Summaries rather than full section markdown, so that it is faster and less likely to rewrite section facts.
63. As an Anna user, I want section bodies assembled by code rather than rewritten by a final LLM pass, so that section-level evidence and wording stay stable.
64. As an Anna user, I want final source URLs preserved across all sections, so that I can inspect evidence after reading the report.
65. As an Anna user, I want the final report stored as one Research Result, so that the reading experience remains a single markdown report.
66. As an Anna App developer, I want one Sectioned Research Job per user research request, so that latest-job recovery and final result persistence stay coherent.
67. As an Anna App developer, I want Report Sections represented as parts of a job rather than independent jobs, so that progress, failures, and final assembly share one boundary.
68. As an Anna App developer, I want confirmed planning state saved through explicit App Tool Methods, so that `app_update_research_job` does not become an arbitrary nested write surface.
69. As an Anna App developer, I want role/focus/outline candidate drafts held in frontend state, so that backend job schema contains only user-confirmed research state.
70. As an Anna App developer, I want section iteration records stored separately from the legacy report-level `iterations[]`, so that section evidence remains attributable.
71. As an Anna App developer, I want section-level selected contexts stored separately, so that a future context selector can be changed without rewriting the whole job model.
72. As an Anna App developer, I want section results to include markdown, summary, source URLs, and failure details, so that final assembly and recovery are deterministic.
73. As an Anna App developer, I want final report persistence to reuse the existing large-result transfer pattern where appropriate, so that large markdown does not bloat JSON-RPC frames.
74. As an Anna App developer, I want Frontend LLM Completion calls to omit `maxTokens`, so that they stay consistent with existing Anna LLM guidance.
75. As an Anna App developer, I want prompts to request strict JSON for candidate generation, outline planning, source assignment, Research Step Decision, Section Writer Output, and Report Framing, so that parsing and fallback behavior can be tested.
76. As an Anna App developer, I want parsing fallback rules for every structured LLM stage, so that malformed model output results in predictable UI behavior.
77. As an Anna App developer, I want explicit stage names for role review, focus review, outline review, section research, section writing, report framing, and completed, so that status UI can localize them.
78. As an Anna App developer, I want Bilingual App Shell UI copy for the new workflow, so that Chinese and English users see localized controls and errors.
79. As an Anna App developer, I want the Research Source Panel to remain usable from the guided workflow, so that users can configure missing sources before confirming an outline.
80. As an Anna App developer, I want tests to prove the static bundle no longer drives the old one-click report flow, so that implementation follows the new guided workflow.

## Implementation Decisions

- Preserve the frontend-owned orchestration boundary from the current architecture. The Anna App Shell owns role candidate generation, focus brainstorming, outline planning, section-level Research Step Decisions, section writing, Report Framing, and final assembly.
- Keep the Researcher Tool Backend as a non-LLM backend boundary. It owns settings, Research Source execution, source credential access, per-section context selection, job persistence, section result persistence, and final result persistence.
- Represent the new flow as one Sectioned Research Job, not multiple jobs. Report Sections are user-visible parts of one Async Research Job.
- Persist only user-confirmed planning state: Confirmed Research Role, confirmed Research Focus entries, Confirmed Research Outline, section progress, section evidence, section results, Report Framing output, and the Assembled Research Report.
- Keep LLM-generated role candidates, Research Focus candidates, and unconfirmed outline drafts in frontend draft state. MVP recovery does not restore unconfirmed drafts.
- Generate three Research Role candidates by default. Each candidate contains `server`, `agent_role_prompt`, and may include a UI-only rationale. The user confirms exactly one role.
- Generate five Research Focus candidates by default. The user confirms one to five Research Focus entries.
- Use Two-Step Outline Planning. The first LLM call drafts Report Sections from query, Confirmed Research Role, and confirmed Research Focus entries. The second LLM call assigns Allowed Research Sources to all sections using the available configured Research Sources.
- Default outline generation should produce four to six sections. The user may confirm one to eight sections.
- Each Report Section contains a title, outline content, Allowed Research Sources, and `max_iterations`.
- Each section's `max_iterations` is user-adjustable from one to ten and defaults to five.
- Allowed Research Sources are strict section-level whitelists. They are not recommendations.
- Research sections serially in Confirmed Research Outline order.
- Scope Research Step Log and duplicate prevention to the current Report Section. The same source/query pair may be used in different sections.
- Keep individual source call failures soft inside a section when possible. The section loop may continue and feed the error into the next Research Step Decision.
- Stop the whole Sectioned Research Job when a Report Section cannot produce section markdown.
- Run Lexical Context Selector per section over that section's evidence.
- Change section writer prompts from whole-report generation to section generation. The section writer should produce Section Writer Output containing `section_markdown` and Section Summary in one Frontend LLM Completion call.
- If Section Writer Output parsing fails, treat the model text as section markdown and derive a minimal Section Summary, rather than immediately failing when useful markdown exists.
- Use Report Framing after all sections complete. The framing LLM call receives the original query, confirmed focuses, outline titles, and Section Summaries. It generates only title, introduction, and conclusion.
- Assemble final markdown in code from Report Framing output and section markdown in Confirmed Research Outline order.
- Do not send all section markdown through a final rewrite LLM call.
- Add explicit Sectioned Research App Tool Methods rather than stuffing complex section data into the generic job metadata update method.
- Keep generic job metadata updates limited to lightweight fields such as status, stage, progress, active section index, and high-level errors.
- Add backend validation for section source calls so a section cannot call a Research Source outside its Allowed Research Sources.
- Update job store schema to support confirmed planning data, section-level iterations, section-level selected context, section-level results, section summaries, report framing, and assembled result metadata.
- Preserve the existing local result transfer pattern for large final report payloads where it remains useful.
- Keep stdout reserved for JSON-RPC frames and keep debug logs on stderr.
- Keep Tavily and User-Configured Research Sources under the existing unified Research Source abstraction.
- Keep the app limited to Web Research Sources for this PRD.
- Keep the generated Research Result as markdown plus source URL evidence.
- Update ADR 0005's old single-loop/five-iteration model by following ADR 0006's guided Sectioned Research Job model.

Major modules to build or modify:

- A guided workflow state module in the Anna App Shell that separates draft candidate state, confirmed planning state, section execution state, and final result state.
- LLM prompt/parser helpers for role candidates, Research Focus candidates, outline sections, source assignment, section Research Step Decisions, Section Writer Output, and Report Framing.
- UI components for role cards, focus cards, outline editing, section source whitelists, section iteration controls, regeneration dialogs, and section research progress.
- Research API wrappers for new sectioned App Tool Methods.
- Backend job store methods for confirmed research plans, section iterations, section contexts, section results, and assembled result records.
- Backend dispatcher methods for sectioned research persistence and processing.
- Views that return compact sectioned job state without exposing raw evidence unless a method explicitly needs it.
- Localized messages and status mappings for the new stages and user-facing errors.

## Testing Decisions

- Tests should assert external behavior and stable contracts, not private implementation details.
- Frontend workflow tests should cover role candidate generation, role selection/editing, role regeneration, focus candidate generation, multi-select confirmation, focus regeneration, outline generation, source assignment, outline editing, and outline confirmation.
- Frontend section orchestration tests should cover serial section execution, section-level max iteration limits from one to ten, section-level allowed source filtering, section-level duplicate prevention, section writer output parsing, section writer fallback, Report Framing, and final markdown assembly order.
- Backend contract tests should cover all new sectioned App Tool Methods through JSON-RPC `invoke`, including invalid parameters and stable error payloads.
- Job store tests should cover creating a Sectioned Research Job, saving confirmed planning state, appending section iterations, replacing or reading section context, saving section result data, failing a section, and saving the assembled result.
- Research Source tests should cover strict Allowed Research Sources validation, rejection of outside-source calls, duplicate rejection within one section, and identical source/query acceptance across different sections.
- Context selector tests should cover per-section selection over section evidence and ensure one section's evidence does not leak into another section's selected context.
- LLM parser tests should cover valid JSON, JSON embedded in text, malformed JSON, missing fields, empty output, fallback behavior, and user-visible errors where fallback is not acceptable.
- Bundle contract tests should ensure the static bundle references the new guided workflow methods and does not rely on the legacy one-click report-level flow as the only path.
- Localization tests should cover new status values, stage labels, validation errors, and regeneration dialog labels in Chinese and English.
- Existing prior art includes the current frontend `useResearchJob` tests, app runtime tests, raw HTML regression tests, bundle contract tests, plugin contract tests, job store tests, Research Source tests, and Lexical Context Selector tests.
- Normal verification should remain offline and should not require live Tavily, live Anna Sampling, real network access, or real LLM output.

## Out of Scope

- Do not implement Anna Agent session orchestration.
- Do not move LLM reasoning into the Researcher Tool Backend.
- Do not create one backend job per Report Section.
- Do not run Report Sections in parallel.
- Do not preserve unconfirmed role, focus, or outline drafts across refresh in the MVP.
- Do not add cancellation, retry orchestration, job history, or multi-job management.
- Do not add follow-up chat over the report.
- Do not add PDF, DOCX, or markdown file exports.
- Do not support local documents, PDF ingestion, Anna file ingestion, hybrid document search, or arbitrary source URL ingestion.
- Do not add OpenAI embeddings or local embedding models.
- Do not add browser scraping or full-page extraction beyond current Tavily Summary Retrieval and configured Research Source summaries.
- Do not let the final LLM pass rewrite all section markdown.
- Do not make Allowed Research Sources a soft recommendation.
- Do not add report type switching beyond the existing research report path.
- Do not add external CDN assets or remote static resources.
- Do not hand-edit the committed bundle; frontend changes must come from source and build output.

## Further Notes

This PRD follows ADR 0006, which supersedes the original single report-level Iterative Research Loop from ADR 0005. The core architectural boundary remains unchanged: the Anna App Shell owns research orchestration and Frontend LLM Completion, while the Researcher Tool Backend provides explicit App Tool Methods for non-LLM backend work.

The largest implementation risk is scope growth. The feature touches UI navigation, prompt contracts, parser fallback, job schema, backend methods, source validation, context selection, final assembly, localization, and tests. Implementation should be split into vertical slices that keep the app runnable after each slice.

The second major risk is cost and latency. A maximum outline of eight sections with ten iterations each can be expensive. The UI should make section count and max iteration settings visible before the user starts section research.

The third major risk is schema compatibility. Existing completed jobs should remain readable where possible, while incomplete legacy jobs may be treated as legacy and not continued through the new guided workflow.
