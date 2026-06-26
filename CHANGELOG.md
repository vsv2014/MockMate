# Changelog

## v1.4.0 — 2026-06-26

The SaaS foundation: accounts, a redesigned Home, and a more reliable Solo voice flow.

### Added
- **Full auth system** — Welcome, Signup, Login, and a 2-step Onboarding (role setup + optional resume upload), gating the app behind sign-in.
- **Account screen** — avatar, plan badge (Free/Pro), monthly usage bars (AI responses + live transcription), an *Upgrade to Pro* CTA (disabled until billing ships), a *Use my own API keys* toggle, and Sign out.
- **Job match in the Career suite** — Matching Jobs is now a tab inside Career (Home → Career → Jobs), reusing the existing job-match logic unchanged.

### Changed
- **Home overlay redesigned** to the new design system — Kanit, `#0c0c0c` surfaces, accent-gradient Live hero, 2-column Practice grid, single Career row, and a quiet Settings / API keys / Shortcuts footer. Keyboard shortcuts now live behind the ⌨ button instead of cluttering the main surface.
- **Kanit is self-hosted** (woff2 bundled in `public/fonts`) — no Google Fonts CDN call on launch (privacy + offline-safe).
- **Icons** on the redesigned Home are inline SVG (no Unicode-glyph fallbacks, which render as empty boxes on Linux).
- **Backend (auth/SaaS)** — JWT (7-day) auth with bcrypt (12 rounds); **file-backed store by default** (offline-safe, zero infra) with **MongoDB opt-in** via `MONGO_URI`; API base URL is env-configurable (`MOCKMATE_API_BASE`) so it can point at a hosted backend with no code change. Forked from the Electron main process; JWT stored encrypted via `safeStorage` (never localStorage).
- **Solo Practice — full redesign** (purple design system): a structured session builder (interview type / level / target company), a count-up **timer** (sessions are time-based, not question-counted), and a new **results screen** (score ring + rubric dimensions + improvements). The **setup screen** is migrated to the design system, and the old **question-count selector was removed**.
- **Live Companion — red-theme visual redesign**: a dominant **Suggested answer card** (eyebrow + confidence badge + bullet points), a full-width **Copy answer** action (no Insert), and a persistent **listening bar** with an honest, mic-state-bound indicator. Red (`#ef4444`) throughout — never purple — to signal "live / real-time."
- **Live Companion — screen-capture path discoverable**: a persistent **Analyze screen** button (same trigger as `Ctrl+Shift+U`) plus an idle prompt after 30s. Added a **"Coding question detected"** banner and a **"Get code solution"** button for verbally-asked coding questions (tight phrase trigger, suppressed on behavioral/culture/company answers).

### Fixed
- **Solo voice reliability** — Solo now uses **Deepgram as the only voice engine** and **never falls back to the browser Web Speech API** (which silently fails inside Electron). When no Deepgram key is set, Solo shows a clear gate before starting (*Add Deepgram key* / *Use text mode*); if Deepgram hits its quota or drops mid-session, Solo switches to **text mode** and the session continues uninterrupted. The question flow and scoring are unchanged.
- **Auto-update CI hardening** — the release workflow now **fails loudly** if the git tag doesn't match `package.json` version (the #1 silent "no update offered" cause) or if `latest*.yml` update metadata is missing from the build, instead of shipping a release that can never auto-update.
- **Live Companion — duplicate suggestions no longer feel frozen** — a re-surfaced answer now shows a brief, fading *"Similar question · showing same answer"* signal, and the near-duplicate threshold was tightened from ≤2 to **≤1 word** so a genuine follow-up gets a fresh answer.

### Platform notes
- **Windows / Linux:** auto-update is silent (downloads in the background, installs on next launch).
- **macOS:** updates remain **manual** — the build is not yet code-signed/notarized, so re-download the `.dmg` from the releases page. (No Apple signing secrets added in this release.)
