# MockMate Personal Preview v1.6.11 — Sources & ARCH (Track B v1 slice)

**UNSIGNED Windows Personal Preview**, not the signed production distribution. This release packages the tested Track B changes merged to `main` via PR #136.

## Visible changes

- New **Sources & ARCH** navigation item in desktop management view.
- Manual, user-reviewed import of one GitHub Markdown, Google Drive text or Google Calendar event source at a time.
- Explicit preview, SHA-256 verification, review confirmation, local document import and deletion.
- Kit-aware destinations, with all imported documents **unselected** by default so they do not silently affect Live or Solo answers.
- New ARCH professional profile panel with headline, role goals and exact source-verified quote evidence.
- Account isolation, source-revision/digest checks and regression tests.

## What is not connected

This does **not** add real Google/GitHub/Calendar OAuth connections, Composio/Activepieces account access, token custody, automatic sync, a professional state graph, or any claim of better Live quality. The screen prominently explains this. Composio compatibility work remains offline/testing-only until provider OAuth, account ownership, remote authorization scope and packaged Windows tests are proven.

## Test scope

The v1.6.11 CI is required to pass Linux Vitest, production build and packaged Windows smoke. No physical-device testing or 90-minute live session certification is implied by CI success. The v1.6.10 provider readiness changes are also included from the main history, but a test that passes once does not guarantee no future 429/502 failure.

Do not use the unsigned preview as proof that stealth or Live is always dependable on a real interview device. Keep the signed stable application available separately.

Implementation details: [Track B Sources & ARCH v1](TRACK_B_SOURCES_ARCH_V1.md).
