# Session contract v1

Status: proposed; not implemented by this document. Baseline: cleanup/debris-166. No hosting, SQLite migration, or upload is enabled here.

## Product and ownership decisions

Desktop is local-first. SQLite in Electron main owns the local working copy and durable outbox. Mongo owns the acknowledged shared representation for accounts that explicitly enable sync. Mobile reads/writes that representation through the same versioned API. These are replicas with defined ownership, not two competing sources of truth. Guest BYOK remains local-only; sign-in alone never uploads history. Provider credentials are not session fields. Direct BYOK keys remain local; managed service secrets remain server-side.

The preservation contract is: create a local session at Start, commit captured material incrementally, finalize capture before evaluation, and attach evaluation to that same run. Failed evaluation never gates preservation. The UI must distinguish local commit, server acknowledgement, and backup; none implies the others. Disk-full or unavailable storage must produce an explicit failure and export/retry route, not a claim that data is saved.

## Wire schema

JSON schemaVersion = 1. Reject unsupported fields/versions and oversize writes with machine-readable errors; do not silently truncate. Limits below are proposed launch defaults, not current API limits.

| Field | Type and constraint | Ownership |
|---|---|---|
| runId | UUID generated once at Start; immutable | originating device |
| schemaVersion | integer 1 | protocol |
| owner | authenticated server principal; never trusted from body | server |
| originatingDeviceId | random installation UUID, not hardware identity | device |
| mode | live, solo, mock, coding | creator |
| source | desktop, mobile, web | creator |
| title/company/role | strings, max 160 Unicode code points each | editable with revision check |
| startedAt/endedAt | client UTC ISO timestamps, nullable endedAt | display evidence, not ordering authority |
| createdAt/updatedAt/deletedAt | server UTC ISO timestamps | server |
| captureStatus | provisional, capturing, captured, interrupted | lifecycle |
| evaluationStatus | not_requested, not_applicable, pending, scored, failed, cancelled | lifecycle |
| serverRevision | nonnegative integer, increment on committed mutation | server |
| report | null or versioned JSON object; max 256 KiB UTF-8 | evaluation mutation |
| notes | string, max 32 KiB UTF-8 | editable with revision check |
| contextSnapshot | explicit selected context; max 512 KiB UTF-8 | consent-controlled, versioned |
| turns | paginated immutable records, not one unbounded embedded array | originating stream |

Turn: {turnId: UUID, streamId: UUID, sequence: integer >= 0, role: interviewer/candidate/assistant/hint, text: string, capturedAt: ISO timestamp}. Hint is never candidate evidence. Maximum text 64 KiB UTF-8 per turn; larger capture is split into linked ordered fragments, not clipped. Batch maximum 256 KiB and 100 turns. Reject oversize batches (413) without acknowledging them. Preserve local data while resplitting. Session list never contains transcript/context bodies.

## Independent state axes

| Axis | Allowed transitions and trigger | Failure/retry | UI |
|---|---|---|---|
| capture | provisional -> capturing after local Start commit; capturing -> captured after End commit; capturing -> interrupted on restart recovery | retain committed turns; user chooses resume/finalize | Recording / Captured / Interrupted |
| evaluation | not_requested -> pending after captured commit; pending -> scored/failed/cancelled; failed/cancelled -> pending by explicit Retry; not_applicable when no candidate evidence | preserve transcript; no automatic repeated billed evaluation | Evaluating / Scored / Retry evaluation / Not scored |
| sync (local only) | local_only; queued -> syncing -> synced; syncing -> queued on transient error or failed on terminal error | persistent outbox, bounded retry; never discard local capture | Local only / Waiting to sync / Synced / Sync needs attention |

A scored session can still be queued for sync. Sync must never overwrite evaluation state. Interrupted recovery does not invent an endedAt or a candidate score. No candidate speech means captured + not_applicable, not an unsaved session.

## Protocol and concurrency

Endpoints: GET /v1/session-capabilities; PUT /v1/sessions/:runId (idempotent create); GET /v1/sessions/:runId; GET /v1/sessions?cursor=... (summaries); POST /v1/sessions/:runId/turn-batches; GET /v1/sessions/:runId/turns?cursor=...; PATCH /v1/sessions/:runId (metadata/report); DELETE /v1/sessions/:runId; GET /v1/session-changes?cursor=... (including tombstones).

Each mutation carries operationId (UUID persisted in outbox), schemaVersion, and canonical payload hash. runId identifies the session, not an individual retry. Unique (owner, runId) and (owner, operationId) constraints are mandatory. Same operationId and same hash returns its original committed acknowledgement; same ID with different payload returns 409 idempotency_conflict. Ack includes runId, operationId, serverRevision, committedAt and next change cursor. Client marks an outbox item acknowledged only after validating that acknowledgement and committing it locally.

Create, metadata, report and delete use required expectedRevision; create expects absence. Conflicts return 409 with current revision, never last-write-wins. Append batches may merge disjoint immutable turn IDs: exact duplicate is accepted, same turnId with different content is 409 turn_conflict. One originating stream writes its own sequence; another device cannot replace its transcript. Notes/report conflicts retain both local pending content and server content for explicit resolution. Partial transcript upload remains committed if report upload fails; they are separate mutations.

Mongo uses metadata, turn-batch, operation receipt and change-log collections. A mutation and its receipt/change entry commit together using transactions on a replica set; deployment must support this. Acknowledgement requires configured majority/journal durability, verified in deployment tests. This is not a backup guarantee. No unbounded transcript in a Mongo document. Quotas reject new server writes explicitly without deleting local copies or prior acknowledged material.

Server clock governs retention and change ordering. A monotonic server change sequence orders sync; client timestamps are evidence only. Cursor expiry returns full_resync_required. Delete removes content and creates a minimal tombstone; deletion wins against stale edits. Retain tombstones/operation receipts for the supported offline window (proposed 90 days). Every writer needs a server-validated sync lease bound to its device and cursor epoch; an expired lease blocks writes with full_resync_required. Older clients must full-resync before uploading. Recreation requires a new runId and explicit user action, never replay of an old create.

Retry only network/408/429/5xx, with exponential jitter 1s to 5min, Retry-After respected, no concurrent mutation for one run. Pause on 401 for sign-in; 403/409/413/quota errors need explicit resolution. Resume on network recovery and launch. Background sync is not required for local capture to work.

Capabilities advertises supported schema versions, minimum client version, payload limits, cursor/receipt retention. Incompatible clients retain local sessions and show update-required for sync. Versioned additive changes do not require a new storage engine; schema migrations remain automatic, tested and backward-compatible where practical.

## Release gates

Guest/offline start -> capture -> End -> restart preserves all committed turns. No-candidate session persists without evaluator. Evaluator failure/cancel preserves capture. Crash before/after local commit is recoverable. Lost ack replay creates no duplicate. Two-device metadata conflict loses neither draft. Delete plus stale replay does not resurrect content. Oversize batch remains local. Account switching cannot read or sync another account. Old-version import preserves all eligible raw rows. These run against packaged Windows, including disk-full and upgrade fixtures; unit tests alone are insufficient.
