# Composio compatibility spike — offline preview policy

**Status:** deterministic policy implementation + tests only. NOT a working Composio login, API adapter, desktop OAuth, or connected tool integration. Feature is not connected to MockMate runtime.

Current result: a normalizer and metadata preview for selected Calendar events, Google Docs text and GitHub Markdown; strict source hash/revision recheck before a hypothetical approved import; account-mismatch and race tests. This is reusable design code, not proof of secure server-side authorization.

## Run locally

`npx vitest run spikes/composio-compat/preview.test.mjs`

Zero dependencies; no keys, network calls or model charges. Existing ARCH, ABL, Live, document persistence, installer and auth modules remain untouched.

## Security and deployment gates still PENDING

1. Test supported Composio SDK against MockMate's declared Node 24 engine and Electron runtime.
2. Capture exact OAuth scopes displayed for each connector; distinguish what Composio can access versus what MockMate actually imports.
3. Verify hosted Connect Link and authenticated owner-only connection lifecycle in a packaged **Windows** build; developer browser proof is not sufficient.
4. Verify safeStorage credential behavior and fail closed when unavailable; **never** distribute a shared Composio project key in a public installer.
5. Prove account isolation and actual server-side permission checks; the `mockMateAccountId` field in this helper is not an authentication mechanism.
6. Verify provider retention/PII obligations, quota boundaries, and revocation.
7. Integrate with existing Kit documents only after the above gates; manual refresh, explicit review and RAG invalidation required.

Approval for user-selected import does NOT imply the upstream OAuth grant is restricted to one event or one file.

## Deployment decision

Remain disabled until all gates above pass. Never call connectors from Live answer generation. Retain existing manual Kit setup and offline document access.
