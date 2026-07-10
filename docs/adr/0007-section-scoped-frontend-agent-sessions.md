# Section-Scoped Frontend Agent Sessions

The Anna App Shell will use one frontend `anna.agent.session({ submode: "auto" })` for each unfinished Report Section. The section's Research Step Decision runs and final section-writing run share that session. Sessions are process-local, are never persisted in the Research Job, and are deleted on both success and failure.

This decision changes only the model interaction boundary described by ADR-0006. The App Shell still owns the iterative section loop, iteration accounting, progress events, source whitelist enforcement, and failure propagation. Research Source calls and context selection remain explicit calls to the Researcher Tool Backend; prompts instruct the Agent not to invoke tools or search directly.

Planning calls for role, focuses, outline, and source assignment continue to use frontend LLM Completion. Report Framing and semantic rewrite flows also continue to use frontend LLM Completion. The app therefore retains both `llm.complete` and Agent auto-session grants.

Agent stream frames are normalized by one shared frontend collector. A final or complete response takes precedence over accumulated token or delta text so the same model response is not duplicated. Tool frames are ignored, and an empty model response is a section failure. There is no fallback from the section Agent path to `llm.complete`, because fallback would hide runtime incompatibilities and make execution logs ambiguous.

Completed sections reused during recovery do not create sessions. Every unfinished section creates a fresh session, so conversational state cannot leak between sections and an expired session cannot affect a later resume.
