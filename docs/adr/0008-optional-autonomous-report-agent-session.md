# Optional Autonomous Report Agent Session

Anna Researcher provides an experimental `autonomous_agent` execution mode alongside the default `guided_sections` mode from ADR-0007. The user selects the mode while confirming the outline. Guided generation remains unchanged.

Autonomous generation creates one frontend `anna.agent.session({ submode: "auto" })` and makes one run with the full confirmed outline, role, focuses, attachment overview, and resume checkpoints. The session is granted the bundled Researcher Executa and may call only the dedicated `agent_*` methods. Existing `app_*` methods remain frontend-owned.

The Agent researches and writes sections in outline order. Each section is persisted through `agent_checkpoint_section`; global citations and canonical facts are maintained by the Executa. `agent_finalize_report` deterministically assembles the checkpointed sections and completes the job only after every section exists. The Agent's final text is a small completion JSON rather than the report body.

The frontend does not persist the Agent session id and deletes the session on success or failure. A failed run keeps completed checkpoints and does not fall back to guided generation. Resuming creates one new session and instructs it to continue the persisted autonomous workflow.
