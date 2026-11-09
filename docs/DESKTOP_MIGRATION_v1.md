# Desktop migration v1

Status: proposed design, not an implemented migration. Depends on SESSION_CONTRACT_v1.md. SQLite is the target local store; localStorage P0 fixes are transitional safety work, not equivalent durability.

## Store and process boundary

Electron main owns one SQLite database under userData, partitioned by ownerScope in every primary/foreign key. Renderer uses an allowlisted typed IPC persistence interface; it does not choose arbitrary paths or SQL. Guest installation scope and each authenticated account are distinct. WAL, foreign_keys=ON and an explicitly tested synchronous policy are required; WAL alone is not a durability promise. Select and package a SQLite binding only after testing the Electron runtime/ABI on Windows. Do not assume node:sqlite availability or package compatibility.

| Table | Primary key / contents |
|---|---|
| sessions | (owner_scope, run_id); version, state axes, metadata, report, local_revision, acknowledged_server_revision |
| turns | (owner_scope, run_id, turn_id); stream_id, sequence, role, captured_at, text; unique stream sequence |
| outbox | (owner_scope, operation_id); run_id, payload_hash, immutable payload, expected_revision, retry_at, attempts |
| sync_state | owner_scope; cursor, sync opt-in, last acknowledged change |
| migration_ledger | source_scope, source_key, legacy_id, source_hash; target_run_id, imported_at |
| tombstones | owner_scope, run_id; delete operation and acknowledgement |

Local mutation and outbox insertion share a transaction. Final capture commit precedes evaluation. Checkpoint removal occurs only after verified destination commit. Incremental capture acknowledges batches to renderer only after commit. SQLite failures retain in-memory pending material, stop claiming persistence and offer retry/export; no database guarantees writes when the disk cannot accept them. Backups use the SQLite backup API/consistent snapshot, not copying a live WAL database file alone. Encrypt sensitive session content at rest using a reviewed key strategy before general availability; SQLite itself is not encryption.

## Legacy import: selected decision

Import-on-first-launch with a read-only legacy fallback. Read raw mm-sessions::<scope> and checkpoint bytes through the same authorized renderer origin. Do not call loadSessions() to import: it filters by age/cap and can prune the source (src/history.js:25-31). Do not enumerate/export other accounts' content into the current account.

1. Back up exact source bytes and record hash; corrupt data is preserved for recovery, not overwritten.
2. Parse and validate every raw row, retaining unscored/error records and original timestamps. Unknown fields are retained in legacy_payload for export; hint is never remapped to candidate.
3. In one SQLite transaction insert sessions/turns and migration-ledger records. Preserve valid existing run IDs through the ledger; allocate a UUID once only for a record that needs a new identity, retaining its source identity for support. Identical retries do not duplicate. Changed legacy payload is a conflict requiring preservation, not silent overwrite.
4. Read back counts and canonical content hashes. Only after verification mark source imported. Keep original localStorage bytes through the compatibility window; do not clear as part of import.
5. SQLite History becomes the write path. Read-through legacy rows remain visible when import is incomplete, labelled with retry/export. Imported data is local-only until explicit sync consent.

Test real exported profiles plus corrupt JSON, missing IDs, duplicate IDs, >60 rows, >90-day rows, disk-full, interrupted transaction, different account scopes/origins and older checkpoints. Never use a fixture containing real private data in the repository.

## Guest, sign-in and offline

Guest remains BYOK + SQLite only. Sign-in offers sync for that account's future sessions; guest transfer is a separate explicit selection/confirmation. Copy selected guest runs into account scope with provenance and a stable mapping; do not silently reassign guest ownership or expose them to another account. Sign-out pauses sync and clears authentication, not the local database. Switching accounts changes the visible namespace and active outbox. Offline capture/evaluation availability are separate: local storage works offline; cloud LLM/STT may not.

## Sync implementation

Use the contract's operation IDs, receipt validation and required revisions. Persist pending work before sending it. Apply server updates and cursor in a local transaction. Never clear local turns after upload. No credentials in the outbox. Desktop sync is user-controlled; mobile continues authenticated server access, updated to the same v1 contract. Server availability, retention and account deletion policy must be approved before enabling opt-in sync in production.

## Rollout and rollback

Phase 0: ship preservation/cancellation P0 independently, retaining existing store. Phase 1: implement DB adapter and import behind a disabled rollout flag; fixture/device validation. Phase 2: small opt-in local-store pilot with export and recovery tools. Phase 3: enable local DB after packaged upgrade/restart gates pass. Phase 4: add hosted sync pilot only after operations gates. Each phase has an owner, evidence and a halt condition; calendar dates are not promises.

DB schema uses monotonically increasing user_version and transactional migrations with backups and fixture tests. An older executable must refuse unsupported DB schemas and offer export/update; it must not overwrite a newer database. Rollback disables sync/new feature behavior while preserving DB and queued operations. Downgrading to an old localStorage-only build cannot display new SQLite sessions; export/compatibility tooling is required before such a downgrade. Restoring an old backup is never an automatic substitute for preserving newer sessions.

Large user counts do not require repeatedly replacing storage. They require stable interfaces, additive schema evolution and controlled deployments. Database schema migrations will still exist; the promise is automatic, tested migrations rather than recurring user-led data transfers.


## Local retention and quota decision

Initial pilot defaults: 10,000 sessions per account scope, 16 MiB logical content per session including its local journal/final row, 512 MiB logical session/turn content per account. History pages contain 100 summaries. No automatic 60-row cap or 90-day deletion applies in SQLite. At a policy limit, reject the new transaction with a clear error; offer export and user-confirmed deletion. Do not erase old sessions to make a new capture look successful. Disk-full remains a possible explicit failure even below logical limits; WAL/index/encryption overhead and backups use additional space. Legacy source import is bounded to 32 MiB per request in the pilot; larger/corrupt sources remain unchanged for export/recovery.

These are documented pilot limits, not a guaranteed disk reservation or permanent commercial plan. Automatic pruning is disabled. Any later retention/pruning feature must require explicit policy, exclude active/pending/unsynced runs, and delete session+turns in one transaction.
