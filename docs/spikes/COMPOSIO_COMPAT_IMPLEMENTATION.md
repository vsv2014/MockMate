# Connector compatibility — evidence ledger (implementation started)

**Baseline:** MockMate main commit 42034a280bc72f00833c7c31e1bd61091fea6503.

This branch implements ONLY inert source-preview normalization and tests at `spikes/composio-compat/`.

| Gate | Status | Evidence |
|---|---|---|
| Source normalization / 500-char escaped preview | Implemented; CI result pending | preview.mjs, preview.test.mjs |
| 250 KiB source cap; no silent truncation | Implemented; CI result pending | preview.mjs |
| Version/hash race detection | Implemented; CI result pending | preview.test.mjs |
| MockMate account ID precheck | Prototype only; **not production auth** | preview.mjs |
| Composio current SDK and Node compatibility | PENDING | Requires real SDK experiment |
| Provider-level OAuth scopes per action | PENDING | Requires actual consent and configuration |
| Connect Link on packaged Windows | PENDING | Requires real Windows test |
| Project key safeStorage / hosted secret | PENDING | No credential connected |
| A/B user isolation through authenticated gateway | PENDING | No gateway integrated |
| Real account disconnection/revocation | PENDING | No SDK connected |
| Provider retention and quota | PENDING | Needs legal / pricing review |
| Live p95 unchanged | Design only | No Live files modified |

**STOP:** Do not start authenticated Phase 1 until all mandatory scope, security, compatibility and packaged-Windows evidence is collected. No automatic sending, applying, or mutations.

This branch deliberately does not modify ARCH/ABL or renderer document storage. It is separate from the Promptfoo branch; do not merge production connectors without renewed review.
