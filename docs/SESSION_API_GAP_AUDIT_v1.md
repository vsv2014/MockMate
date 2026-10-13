# Session API gap audit v1

Baseline: cleanup/debris-166; source references describe existing implementation, not the proposed contract. No runtime hosted configuration or Mongo deployment was inspected.

| Contract concern | Current evidence | Gap |
|---|---|---|
| Tenant access | backend/src/routes/sessions.js:19-38,45,64,102 uses requireAuth and user filters | retain and test object ownership; body owner must remain untrusted |
| Stable run identity | create calls Session.create at routes/sessions.js:56; get requires ObjectId at :35 | no client runId uniqueness/idempotent create |
| Revision conflicts | routes/sessions.js:85-95 applies optional expectedRevision and atomic revision increment | concurrency exists, but callers can omit it; require it in v1 |
| Transcript durability/size | sessionDraft.js normalizeTranscript; models/Session.js embedded transcript | first-200 and string truncation; v1 needs explicit limits and append batches, not replacement clipping |
| Pagination | routes/sessions.js:21-26 sorts createdAt only and uses before timestamp | equal timestamps can be skipped; no incremental change/tombstone feed |
| Deletion | routes/sessions.js:102-107 hard deletes | no tombstone; replay protection absent |
| Quotas | routes/sessions.js:47-50 counts then creates, cap 500 | racy admission; no durable reservation/explicit plan policy |
| Report | routes/sessions.js:74-77 permits score object up to 32,000 JSON characters | no independent evaluation lifecycle/attempt linkage |
| Session states | backend/src/models/Session.js schema | revision exists; runId/schemaVersion/capture/evaluation states absent |
| Sync receipts | entire routes/sessions.js:1-114 | no operation receipt, ack hash, outbox protocol or version negotiation |
| Desktop save | src/LiveCompanion.jsx:2473-2494 clears checkpoint before scored-only save | no desktop call to these Mongo session routes in this End handler |
| Local quota | src/history.js:13-31,125-132 | age/cap filtering and quota pruning; not transactional checkpoint + History |
| Legacy account migration | src/lib/accountScope.js:35-55 copies installation-global rows and normalizes invalid arrays to [] | import must preserve raw bytes before the existing normalizer runs |
| Evaluation abort | api/_lib/interview.js:676-696; api/_lib/core.js:784-900 | evaluator/JSON SDK path does not accept the injected signal in this baseline |

## Existing server rows

Do not drop or bulk replace existing sessions. Add nullable runId/version/state fields initially; map each legacy ObjectId to a persisted UUID once. Preserve legacy score and transcript as stored, label historical evaluation state conservatively (a score is not proof of every proposed lifecycle transition). Retain legacy endpoints while mobile clients upgrade. Backfill in bounded restartable batches with a ledger and content checks. Build unique (user,runId) index only after validation. Existing truncated content cannot be recovered from Mongo by migration.

Introduce /v1 independently; do not silently change legacy response shapes. Enforce versioned validation and required revisions in v1. Test parallel creates, duplicate operation replay, stale patch, tenant isolation, cursor ties, deleted replay, transaction interruption and report failure after transcript ack.

## Deployment blockers, not assumed services

Replica-set transactions, indexes, authentication, CORS, managed credentials and actual hosted URL require deployment validation. Existing routes are not evidence that a production backend is running. The cleanup packaging check also found Mongo-mode upload dependencies missing from the packaged artifact; see CLEANUP_EXECUTION_v1.6.6.md. Resolve packaged managed-mode startup before claiming it supports these APIs.
