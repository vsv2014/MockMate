# Desktop SQLite pilot

Status: implemented behind MOCKMATE_SQLITE_PILOT=1, disabled by default. Stacked on session-preservation PR #103. No hosted service, sync, release or version bump is included.

## Implemented boundary

Electron main owns the database path and encryption key. An allowlisted asynchronous IPC bridge sends operations to a worker thread so SQLite's synchronous API does not block the main event loop. Session/turn payloads and legacy source backups use AES-256-GCM; identifiers, account scopes, timestamps and byte counters are not encrypted. A random key is wrapped with Electron safeStorage. Missing/unavailable secure storage, a missing key beside an existing DB, unsupported schemas and failed writes produce errors; there is no plaintext SQLite fallback. This is not whole-file SQLCipher encryption or proof of a complete security review.

Main accepts the main window's top frame only. Account namespace is selected against the subject in main's already-stored token; this is local namespace isolation, not hosted token signature verification. Hosted auth remains the backend's responsibility. Guest is a separate local namespace. No sign-in upload or remote session write is introduced.

History callers use acknowledged async writes. The original localStorage implementation remains the browser/default non-pilot path. Once pilot SQLite is selected, failed DB writes do not fall back to localStorage. Start commits a provisional row before capture begins; a failed pilot Start commit blocks Live entry. End commits captured material before evaluation; failed preservation suppresses evaluation. Failed final writes retain recovery and an explicit retry/copy route.

Live subscribes to the authoritative committed interview state, journals interviewer/candidate turns incrementally, and acknowledges batches only after transaction commit. This is not every raw STT utterance: rejected/uncommitted utterances and raw audio are outside this journal. Renderer/OS crashes can still lose changes not yet acknowledged. Interrupted committed capture appears in History and opens with a recovered transcript; recording is not automatically resumed. Interviewer corrections may update a provisional local turn; hosted immutable turn sync is separate work.

## Schema and pilot limits

SQLite schema user_version=1: sessions(owner scope + stable run ID), turns(owner + run + turn ID, unique sequence), imports(owner + source key, hash and encrypted original bytes). Sessions and batches use transactions, WAL and synchronous=FULL. New Live runs use UUID when supported; existing legacy/P0 run IDs are preserved for correlation instead of silently reassigned. History is paginated 100 summaries at a time; full private content is fetched only when opening a row.

| Policy | Pilot value / behavior |
|---|---|
| Sessions per account scope | 10,000; reject new rows at limit |
| Session logical bytes | 16 MiB including journal + final row; reject oversize writes |
| Account logical bytes | 512 MiB for session/turn payloads; no automatic deletion |
| Turn / batch | 64 KiB UTF-8 text per turn, 100 turns per batch |
| Legacy import / IPC payload | 32 MiB per source/request; oversize import remains untouched |
| Retention | no age filter or automatic 60-row pruning in SQLite |
| Physical disk | explicit write failure; existing committed rows retained; not a disk reservation guarantee |

Encrypted source backup adds up to 32 MiB per imported scope outside the session/turn logical budget. Database indexes, encryption overhead and WAL consume additional physical space. These are configurable pilot policy constants, not cloud-plan quotas or claims of guaranteed free disk. Copy/export and user-confirmed deletion are available; automatic retention is not implemented. Deleting a History row does not erase retained original localStorage migration copies. Account deletion purges live SQLite rows/import receipts and scoped browser data, but is not a secure-erasure guarantee for old WAL pages or external backups.

## Import and rollback

On the first async History access/write in each authorized account scope, read the raw scoped legacy array without invoking the age/pruning reader. Import all valid rows and an encrypted exact source backup in one transaction. Verify canonical content for each row, then commit a SHA-256 source receipt. Same-source retries are idempotent. Changed sources, duplicate/missing IDs, malformed data or any failed write roll back the batch and leave localStorage untouched. No source cleanup or automatic upload occurs.

When import fails, existing SQLite rows remain readable; otherwise parseable legacy rows are shown read-only. Raw legacy export is available even for malformed JSON. New SQLite writes remain blocked while import is unresolved. Earlier account migration now preserves malformed array bytes rather than replacing them with []; global-to-scoped copies are verified before cleanup. A prior version's already-deleted content cannot be recovered by this importer.

Disable the flag to halt the pilot, but the old localStorage view will not contain new SQLite captures. Do not treat flag-off as a data rollback. Preserve DB/key/source files and export new SQLite rows before downgrading. A newer unsupported DB schema is refused, never reset. Backup/restore tooling, automatic SQLite schema upgrade beyond v1 and outbox/cloud sync are not implemented in this pilot.

## Evidence and release gates

Unit tests cover transaction rollback, physical SQLITE_FULL-style capacity failure using max_page_count, reopen recovery, encryption of private payload bytes, account separation, unscored import >60 old rows, duplicate replay, changed source, quotas, pagination and schema refusal. Renderer adapter tests cover raw source import, no silent fallback and account changes during async writes.

Linux packaged Electron 44.5.1 / Node 24.21.0 smoke test loaded node:sqlite and exercised worker write -> close -> reopen -> candidate recovery. Its key wrapper was synthetic; this does not validate the Windows OS keychain or a Windows UI journey. Packaged Windows Start/End/History, crash/restart, account switch, upgrade/import, real disk-full and secure-storage/key recovery tests remain mandatory before enabling the flag in production. ARCH state graph/coaching and Mongo sync are not implemented by this PR.
