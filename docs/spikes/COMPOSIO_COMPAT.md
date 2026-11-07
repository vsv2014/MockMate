# Composio compatibility and scope spike

Status: **security primitives committed; real OAuth/SDK compatibility NOT TESTED**.

## Implementation completed in this branch

- Pure helper in backend/src/connectors/spike.js, with no external Composio dependency.
- Account-owner access checks (caller identity must come from trusted authenticated backend; never from an untrusted renderer field).
- Read-only allowlist for calendar/list_events, drive/read_selected_text, github/read_selected_file.
- Explicit source identifier required for Drive and GitHub.
- Deterministic HTML-escaped title/excerpt, maximum 500 source characters.
- Normalized-text SHA-256 and source revision to reject stale import approval.
- No model-synthesized import previews, email actions, autonomous agents or Live runtime hooks.
- Focused unit tests in backend/src/connectors/spike.test.js.

This code does not authenticate anyone and MUST NOT be mounted as an HTTP route before an authenticated user identity is injected. The preview helper has no external side effects. Caller must independently fetch source content again at approval and compare revision+digest.

## Phase 0 compatibility questions — all remain open until independently verified

1. Install/pin a supported Composio SDK compatible with package.json Node >=24 <25.
2. Validate Connect Link creation, browser OAuth and connected-account ownership from a packaged Windows preview build.
3. Verify where the Composio project key lives: for a public multi-user build, it MUST stay on a trusted backend. For owner-only BYOK, assess electron safeStorage and explicit threat model, with no embedded shared key.
4. Record actual toolkit/operation OAuth scopes. Distinguish data Composio may access, fields transmitted to MockMate, and fields saved locally. Do not imply per-event or per-file OAuth scoping merely because UI imports selected items.
5. Review Calendar visibility for full-event listing versus selected event IDs; consider confidentiality of attendee names and meeting links.
6. For Drive, verify whether drive.file, drive.readonly, Picker selection or known file IDs are supported by the actual auth config. No broad account scan by default.
7. For GitHub, verify repository permissions and whether fine-grained token or GitHub App restrictions are viable; never ingest full org repositories by default.
8. Verify Composio tool allowlisting at execution time, key custody, rate limiting, connect-link identity rebinding and token revocation.
9. Run account-switch, connection-revoked-upstream, 429, very-large-source and source-changed-between-preview-and-approval tests.
10. Review pricing, retention/zero-data-retention, app verification and user-visible data disclosure.

## Scope of normalized content (proposed, not yet implemented)

- Calendar: selected event metadata, no HTML bodies or invitee roster unless explicitly approved.
- Drive: plain Google Docs text only; PDF/DOCX/Sheets deferred until parser benchmark.
- GitHub: selected README or Markdown document, length-bounded; arbitrary code and entire repositories deferred.
- Each import retains provider, external source ID, external revision, normalized-text hash, local document ID, and deletion/sync semantics; no background sync until explicit user request.

## Exit criteria

1. Real SDK and OAuth lifecycle demonstrated (not merely mocked).
2. Scope disclosure written from actual provider permission pages.
3. Packaged Windows browser-connect workflow demonstrated without exposing project credentials.
4. User A cannot execute or approve User B connection.
5. Deterministic preview and stale revision tests pass.
6. Explicit default-off rollback confirmed; existing Kits continue working offline.
7. No connector call on Live critical path and no paid service enabled by default.

Until all pass, Phase 1 is **not approved**. This branch should remain a draft PR.

No source code was imported and no accounts or external services were connected.
