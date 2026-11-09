# Session observability v1

Status: proposed contract. Current metrics allocate a separate ID in src/lib/sessionMetrics.js:20-21; Live controller uses sessionIdRef in src/LiveCompanion.jsx:622. P0 must join those identities; telemetry is not session storage.

Generate runId at Start and carry it through controller, checkpoints, History, evaluator config, local DB, sync requests and report attempts. operationId identifies a mutation; evaluationAttemptId identifies an evaluator attempt. Never substitute provider request IDs for runId. Record explicit acknowledgement events, not optimistic success.

Event envelope: {eventVersion:1, runId, event, timestamp, source, captureStatus, evaluationStatus, syncStatus, durationMs, bytes, errorCode, operationId?, evaluationAttemptId?, serverRevision?}. Allowlist fields. No transcript, résumé, prompt, answer, API key, arbitrary raw error body or account email. Opaque server user IDs remain restricted support data, not public analytics. Hashing private text does not make it safe to collect.

Required events: session_created, capture_commit_started/succeeded/failed, capture_finalized, evaluation_started/succeeded/failed/cancelled, history_commit_started/succeeded/failed, checkpoint_clear_succeeded/failed, sync_queued/attempted/acknowledged/failed, conflict_detected, session_deleted, migration_started/verified/failed. Log failures with bounded error codes and byte counts. Do not call a provider attempt cancellation proof that remote computation or billing stopped.

Authenticated support tooling must answer: sessions for an authorized account by state; run timeline; pending outbox age; last ack; missing commit. Server query returns server-known runs only. Local-only guest runs are not queryable remotely unless user explicitly exports diagnostics. Display one copyable run ID and storage/sync status in support UI.

Measure preservation failures, oldest unacknowledged outbox age, evaluation success, migration conflicts and sync duplicate/conflict rates. Do not equate heard utterances with answerable questions or successful requests with rendered answers. Alert owners on lost-commit signals; privacy policy and diagnostic retention must be approved before shipping collection.

Acceptance: deliberate disk failure emits failed not succeeded; replay yields one ack; abort records cancelled not provider hard failure; account-switch logs cannot leak other account identifiers/content. Validate telemetry against the actual persisted row, not only emitted events.
