# Track B — Connected account OAuth, selected-source synchronization and ARCH graph

**Implementation status:** code exists on feature branch PR #138. The packaged Windows app and real third-party consents have NOT yet been certified. This document is setup and verification guidance, not a declaration that production OAuth works everywhere.

## Architecture and trust boundary

- Electron main owns the OAuth flow, source network calls and OS-encrypted `connected-accounts.v1.bin` vault. It refuses connection setup when Electron `safeStorage` is unavailable; it never falls back to plaintext storage.
- Every connector IPC operation is restricted to the main trusted window and a signature-verified local MockMate JWT. The current session is additionally validated with the local account service (including revocation/token version). Hosted backend JWTs require a separate trusted hosted connector service and are **not supported** by this local gateway.
- The renderer receives sanitized account labels, source metadata, selected source text, provider error categories and never OAuth access/refresh tokens.
- Each connection is owned by the signed-in MockMate account. Switching account A/B cannot reuse A's vault, selected imported documents or pending OAuth flows.
- A provider grant can cover more resources than an individual selected source. Only user-approved source IDs are read/imported/synchronized by MockMate. This does **not** make broad OAuth scopes magically narrower.
- Automatic checks happen every 15 minutes only for sources separately opted in, never from the Live hint generation pipeline; Live mode pauses connector checks. Manual sync is available from Sources & ARCH. Imported source text is unselected for AI retrieval by default.
- Source updates are hash-verified, applied in place, preserve the same document/Kit scope, invalidate RAG embeddings, retain previous revision metadata and are acknowledged only after local persistence.

## Setup: GitHub

1. Create a GitHub OAuth App in GitHub Developer settings. Enable the **Device Authorization Flow**.
2. Enter that OAuth App's **Client ID**, not a token, in Sources & ARCH → GitHub → Authorize.
3. Open `https://github.com/login/device` and approve the one-time code.
4. Default permission is `read:user` (suitable for public repository materials). For private repositories, explicitly check the broad `repo` permission option before connecting. That OAuth permission extends beyond selected files: review it before authorizing.
5. In the connected GitHub account, enter a single `owner/repo` under Browse, then choose Markdown/text material to review and approve.
6. The selected source's revision/content is verified again before local import. Opt into source-specific sync only if wanted.
7. Disconnect removes local credentials/subscriptions. To revoke the OAuth App's upstream grant, use GitHub Settings → Applications → Authorized OAuth Apps.

## Setup: Google Drive and Google Calendar

1. Create a Google Cloud project and configure its OAuth consent screen, test users, application verification where required and the Drive/Calendar API enabled as appropriate.
2. Create a **Desktop app OAuth client**. Enter its Client ID and its generated desktop client secret if provided. Never commit the client configuration to source control.
3. Select Google Drive or Google Calendar in Sources & ARCH. A system-browser authorization window opens, using PKCE S256 and a short-lived `http://127.0.0.1:<random-port>/oauth/callback` receiver.
4. Google Drive requests `openid email profile` and `drive.readonly`. Calendar requests `openid email profile` and `calendar.events.readonly`. **These are broad upstream read-only scopes.** They may require Google verification for public use. MockMate does not secretly sync every file or event.
5. Choose an authenticated Google account, browse recent Docs/text files or upcoming events on the primary calendar, select one source, review content and approve local import.
6. Optional sync checks only that approved source ID. Disconnect removes its local credential. Revoke upstream access in Google Account → Security → Third-party connections if desired.

Google Drive support currently covers Google Docs exported as plain text and native text/plain files, not arbitrary scanned PDFs, Sheets or binary media. Google Calendar source selection currently browses the primary calendar. GitHub source selection targets Markdown/text files in a chosen repository. These supported types must be broadened only with explicit handling and tests.

## ARCH professional graph v2

Account-scoped, versioned graph built from professional goals, approved source revisions, verbatim evidence quotations, user-entered claims and user-recorded interview/project outcomes. Relations include `quoted_from`, `supported_by`, `claims`, `targets`, `observes` and `conflicts_with`. Conflicting claims are shown rather than silently reconciled; quotations absent from their current source are flagged as stale. It does not infer verified employment or skill achievements from untrusted prompts; it does not silently modify the résumé or Live answers.

**Not yet a complete autonomous professional state graph:** auto-ingestion of session feedback and job outcomes, reviewable cross-workflow recommendations, external provider verification, automated competency scoring and hosted multi-device synchronization are still future engineering work. These must not be described as implemented.

## Required acceptance before marking OAuth production-ready

- Real Windows packaged OAuth start/callback for both GitHub and Google with separately registered, user-consented clients.
- Two connected Google accounts and two GitHub accounts: switch, restart, reauthorize, refresh token, disconnect, revoke and verify account isolation.
- Source read selection, deterministic preview and approval; external source update -> one sync -> same local document ID -> RAG index invalidation -> revision history -> no duplicate.
- Network offline, OAuth denied, 401/403/429, expired token, callback timeout, storage-full and OS keychain unavailable; no credential loss or plaintext fallback.
- Delete Account securely removes encrypted connector vault entry, document imports and evidence graph; other MockMate accounts untouched.
- Sync remains paused throughout a 90-minute Live session and must not interfere with capture/answers.
- Packaged Windows CI plus physical installation, 100%/125%/150% display scaling and UI keyboard/accessibility checks.

No third-party client credentials are checked into the source tree. A working OAuth connection can only be completed after the user/maintainer registers the external application and consents on the provider's site.
