# Release notes — v1.4.9

MockMate 1.4.9 is an internal-owner/QA reliability release. It focuses on long screenshot questions,
latest-answer visibility, diagnosability, Windows updates, and release safety. Device-local accounts
and bundled team provider keys remain temporary for this test phase; hosted/shared accounts and
server-held keys remain roadmap work.

## Highlights

- Consecutive screenshots can form one bounded question: captures queue in order, related portions
  merge into one regenerated answer, and the user can explicitly Continue, start a New question, or
  Undo the last merge.
- Compact Live follows the newly rendered answer while respecting a user reading older content;
  Jump to latest targets the latest answer.
- Structured production diagnostics correlate session/request timelines across API, auth, Deepgram,
  screenshot continuation, provider/model attempts, latency/token metadata and updater state.
- Diagnostics are buffered, rotated and redacted twice. Settings can export or clear logs without
  affecting saved interviews. Standard logs exclude keys, tokens, passwords, résumé, transcripts,
  prompts, answers, screenshots and audio.
- Windows updater state survives dashboard/auth startup. Manual checks always report Checking,
  Up to date, Downloading, Ready, or an actionable error. Updates install only after Restart & install.
- Auth calls time out instead of hanging; local-only password recovery is hidden; crash recovery now
  performs an actual reload.
- The release workflow verifies version/tag consistency, tests, API smoke, production build and
  updater artifacts before publishing.

## Verification status

- 294 unit tests: passed locally.
- 3 API smoke tests: passed locally.
- Production renderer build and Electron syntax: passed locally.
- Packaged Windows Live/Solo, 120-minute soak, share-preview Stealth, diagnostic export and
  v1.4.8 → v1.4.9 auto-update: still require real installer verification.

Always verify Stealth in the actual meeting share preview before a real interview.
