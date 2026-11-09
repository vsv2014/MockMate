# MockMate Personal Preview v1.6.12 — OAuth and ARCH integration candidate

Status: **Unsigned, isolated Windows Personal Preview**. The feature implementation was merged from PR #138. Automated Linux and Windows CI tests passed on that PR, including packaged smoke. **Not a certified real-provider OAuth or 90-minute Live release.**

## New visible features
- Sources & ARCH can initiate GitHub OAuth device authorization with a separately registered GitHub OAuth App client ID. GitHub must have Device Authorization Flow enabled. Public-repository identity scope by default; private-repository access asks for broad repo permission only after explicit opt-in.
- Google Drive and Google Calendar support desktop-browser OAuth using PKCE and loopback callback, with an OAuth Desktop client ID (and secret if provided) registered in the user's Google Cloud project. Supported read scopes can cover many resources at the provider level; MockMate selects one document/event at a time.
- Several external accounts can be stored per MockMate account, switched, disconnected and used to browse selected sources.
- Account-owned OAuth tokens are kept encrypted by Electron safeStorage; account deletion purges corresponding credentials. There is no plaintext fallback.
- Selected-source review and explicit approval before local import. Optional per-import automatic checks every 15 minutes while the application is running outside Live. Imported text remains excluded from AI retrieval unless deliberately selected.
- Source changes update the same local document, invalidate embeddings and record prior hash/revision metadata.
- ARCH Professional v2 displays evidence-linked self-entered claims, goals, self-recorded outcomes, stale evidence and unresolved conflicts; it does not make up career facts or automatically rewrite a résumé.

## Important limitations — do not confuse this with finished enterprise integration
- **Real OAuth requires external app registration and consent on the user's accounts**. No shared GitHub/Google OAuth Client ID, production provider verification, or consent success was supplied to CI. Synthetic tests are not live provider proof.
- Local authenticated BYOK MockMate accounts only; the native gateway explicitly does not support unverified hosted-mode JWTs. There is no implemented Composio/Activepieces cloud connector gateway.
- Google Drive supports Google Docs plain-text exports and text/plain; Google Calendar browses upcoming primary-calendar events; GitHub supports selected repository Markdown/text files.
- ARCH v2 adds a provenance graph, but **does not yet implement** all requirements from docs/PROFESSIONAL_MODEL.md, such as multi-version résumé/job requirement matching, confirmed corrections/supersession, practice demonstrations, full cross-workflow recommendations and consented post-session learning.
- No real 90-minute audio/interview soak, OAuth tokens across restart on the user's Windows machine, or real Google/GitHub account-switching acceptance test has been completed.

## Required acceptance
1. Register OAuth clients and configure Google consent/test users and API access.
2. Install this preview side by side with the stable app, sign into a **local MockMate account**, connect one account each to GitHub and Google, then connect a second identity and switch safely.
3. Select source, inspect preview, approve, verify RAG is unselected. Update source externally, opt into per-source sync, verify same local document ID/revision history and no duplicate.
4. Verify disconnect and Delete Account cleanup, offline/rate-limit behavior, and 90-minute Live run with connector syncing paused.

Read `docs/TRACK_B_CONNECTED_ACCOUNTS_OAUTH.md` for provider setup, permissions and limitations. Do not place secrets in GitHub Actions, source code, or issue comments.
