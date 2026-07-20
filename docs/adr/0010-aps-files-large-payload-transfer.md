# APS Files For Large App–Executa Payloads

**Status: Accepted. Supersedes ADR-0002.**

The initial migration plan called this manifest capability `aps.files` and placed Files under the initialize response's server `capabilities`. The current Anna staging reference instead defines the negotiated contract as manifest capability `storage.app` plus `client_capabilities.storage = {}`. This ADR follows the reference contract; `aps.files` is not retained as a compatibility alias.

Large JSON payloads between the Anna App Shell and Researcher Executa use Anna APS Files with `scope="app"`. App Tool Methods remain the control plane and exchange an `ApsTransferDescriptor` containing a logical path, JSON content type, byte size, optional ETag, SHA-256 digest, and `delete_after_read: true`. Presigned upload and download URLs are short-lived transport details and are never persisted in jobs.

Executa declares `host_capabilities: ["storage.app"]`, advertises `client_capabilities.storage = {}` during protocol v2 initialization, and accesses APS through `files/upload_begin`, `files/upload_complete`, `files/download_url`, and `files/delete` reverse RPC. Responses share the plugin's single stdin reader and pending-response router with sampling and embedding calls. The iframe uses `anna.files.*` in the same App namespace.

Transfer objects are UTF-8 JSON, limited to 32 MiB, and stored only under:

```text
research-jobs/{research_id}/transfers/{kind}-{nonce}.json
research-source-tests/transfers/{test_id}-{nonce}.json
```

Consumers validate the byte count and SHA-256 before parsing. An input object is deleted only after the payload has been parsed, validated, and saved successfully; output objects are deleted after successful parsing by the App. Failed transfers remain available for retry. Cleanup is restricted to `transfers/` and must never delete `uploads/` attachments.

Routine `app_get_research_job` calls are control-plane snapshot reads and never create APS objects. Full recovery is explicit through `app_get_research_job_payload`, which combines the complete job, section markdown, and completed report into one transfer. This keeps progress polling APS-free and limits each deliberate open or resume operation to one temporary object.

The Researcher Tool's local job store remains the business data source. APS is only the large-payload bridge, so this decision does not provide cross-Executa-instance job persistence. Old localhost descriptors are intentionally unsupported, and no loopback fallback is retained. Real local integration requires APS storage, for example `anna-app dev --storage aps` started by the developer.
