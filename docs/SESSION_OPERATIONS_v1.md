# Session operations and rollout v1

Status: proposed deployment gate, not a commitment to spend or launch hosting. Guest/local-only desktop must work without the hosted session service. Opt-in signed-in sync and mobile require it. Sign-in does not equal consent to upload.

## Decisions that must be owned before launch

| Decision | Safe default now | Launch requirement |
|---|---|---|
| Operator and incident owner | no new service assumed | name primary/backup owner and response process |
| Funding | no subscription or infrastructure purchase | approve monthly cap, alert thresholds and pilot size |
| Hosting/Mongo | existing configured routes are not proof of deployment | select region, replica-set support, indexes, monitoring and restore-tested backups |
| Retention | preserve local data; no new automatic upload | publish hosted retention, quota, tombstone window and deletion policy |
| Privacy | private documents stay local absent consent | explain what sync includes, processors, residency and deletion; security review |
| Availability | local capture never waits for sync | choose measurable SLO, incident communication and degraded-mode UI |

Do not promise free disaster recovery: replicated Mongo is not backup, and backups need funding, retention, restore tests and access control. An outage must queue local sync and show status; it cannot make desktop discard capture. Provider API availability is separate from session-store availability. BYOK and managed billing policies must remain separate.

Security gates: server derives tenant from authenticated principal; auth revocation/account deletion handled; least-privilege DB roles; secret rotation; request size/rate limits; per-tenant quotas enforced atomically; no client-shipped managed keys; allowlisted CORS; dependencies patched; export/delete workflows tested. Local SQLite encryption/key recovery needs a specific design and device test before claiming encrypted-at-rest protection.

## Sequenced stabilization plan

1. P0 preservation: stable runId; unscored and failed-evaluation History records; provisional write before evaluation; retain checkpoint on failed write; propagate cancellation. Ship separately with restart/error tests. This does not claim SQLite durability.
2. Contract and adapter: approve these five documents, implement the local persistence interface and SQLite transactions, import fixtures and real privately supplied export. No remote upload.
3. Packaged local pilot: Windows resize/start/end/restart/upgrade/disk-full tests, guest/account isolation, recovery/export and rollback. Halt on preservation failure.
4. Hosted v1 pilot: deploy only after owner/budget/privacy/backup gates; verify server transaction/receipt semantics and legacy mobile compatibility. Sync opt-in, limited pilot.
5. Broader rollout: expand only after measured preservation, sync recovery and restore evidence. Large user pools require capacity/load tests and incremental scaling, not another client-store replacement.

No calendar promise replaces evidence. One deliberate store migration is desirable; ongoing schema migrations are unavoidable and should be automated. Keep persistence/sync/provider policies behind owned interfaces so future changes do not touch every UI component.

## Release evidence

Core gates: system-audio/no-candidate saved unscored; candidate scoring success; evaluator timeout/cancel saved with retry state; mid-session close recovers; disk-full explicit warning plus export; import preserves raw legacy rows; lost-ack retry no duplicate; stale delete no resurrection; account switch no leakage. Run against signed packaged Windows release candidate, record artifact hash/version and results. Linux build or hundreds of unit tests are not substitutes for those device journeys.
