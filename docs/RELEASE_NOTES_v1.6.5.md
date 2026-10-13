# MockMate v1.6.5 Release Notes

**Release Date:** 2026-10-13
**Type:** Unsigned Personal Preview (v1.6.4 hotfix)
**Platform:** Windows x64 NSIS installer only

## Summary

v1.6.5 fixes three regressions that shipped in v1.6.4, without reverting the features v1.6.4 added.

If you installed v1.6.4, the Ready Room had no visible way to continue into Live setup and an
OpenRouter key could not be saved. Both are fixed here. Existing screens also render with their
original typography again.

## Fixes

### Ready Room action button restored (could not start Live)

The v1.6.4 linear-layout conversion placed the session summary, the Live readiness rail and the only
primary action button inside a container marked `display: none`. The screen looked complete, but the
"Continue to Live setup" action — and the checklist that explains what is still missing — was never
rendered visibly.

The Ready Room is now one visible linear column in the documented order:

1. **This session** — Kit title, role/company, interview type.
2. **Four pre-flight checks** — interview context, AI answer service, voice/Deepgram, screen-share privacy.
3. **Live readiness** — the four OK/TODO states.
4. **The action button** — "Continue to Live setup →" once every check passes, otherwise the single next action
   (run the AI test, test audio, complete the privacy check, open Settings).

No pre-flight state changed: the existing Live start gate and privacy confirmations still apply.

### OpenRouter keys are saved and appear (key was dropped)

OpenRouter support was added to the Settings UI and the server, but not to the desktop key plumbing.
The hardened `write-env` handler only accepts an explicit allowlist, so `OPENROUTER_API_KEY` was
silently discarded before it reached the encrypted key store. Three further consequences:

- `hasApiKeys()` did not count an OpenRouter key, so an OpenRouter-only user was sent back to the
  first-run setup screen on every launch — and that screen had no OpenRouter field at all.
- Settings' **Remove** action reported "Unknown provider".
- Model overrides (`OPENROUTER_MODEL`) were dropped the same way.

Fixed across `electron/bootstrap.cjs`, `electron/main.cjs`, `setup.html`, `backend/src/hostedConfig.js`,
`backend/src/arch.js` and `src/lib/modelPicker.js`. The same audit found `ANTHROPIC_SONNET_MODEL`
suffering the identical silent drop; it is now accepted and cleared with the Anthropic key.

### Screens render with their intended typography (global Tailwind reset removed)

v1.6.4 imported Tailwind as `@import "tailwindcss";` in `src/styles.css` — the stylesheet every screen
loads. That included Tailwind's Preflight reset, which:

- made `h1`–`h6` inherit body size and weight,
- removed list markers, list indentation, paragraph and heading margins,
- zeroed default borders on form controls.

`src/styles.css` now imports only `tailwindcss/theme.css` and `tailwindcss/utilities.css`, so utility
classes keep working without restyling screens that were never migrated. The unused duplicate entry
`src/index.css` was deleted: the app has exactly one stylesheet entry point. Settings now uses the
shared `mm-content-medium` container instead of Tailwind utilities for its own layout.

## Regression tests added

Each fix has a contract test that fails against v1.6.4 and passes here:

- `src/journey/ReadyRoom.render.test.js` — the Live action must exist, must not sit inside a hidden
  container, and must keep the documented order.
- `electron/provider-key-plumbing.test.js` — every provider key and model override in the shared model
  catalog must be present in the bootstrap allowlist, key detection, removal map, first-run setup
  screen, hosted config and ARCH provider map.
- `src/designSystem.test.js` — the shared stylesheet must not import Tailwind Preflight, must be the
  only stylesheet entry, and must define every token its own classes consume.

## Known issues

- This is an unsigned build — Windows SmartScreen will show a warning.
- No auto-update feed; download manually.
- macOS/Linux builds are not included in this release.
- The latest signed stable installer remains v1.5.3.
- v1.6.4 remains available as a historical preview; its tag was not moved.
- Open in `docs/RELEASE_CHECKLIST.md` §4b: real-provider answer/timing/usage checks on the packaged
  build, the Settings key flow on the packaged build, and the physical Windows collapse/drag/resize pass.

## Installation

1. Download the Windows x64 installer from the releases page.
2. Run the installer (expect a SmartScreen warning for unsigned builds).
3. Launch MockMate and configure your API keys in Settings, or on the first-run setup screen
   (which now includes OpenRouter).

## Verification

- [ ] Ready Room shows the session summary, four checks, readiness rail and action button in one column
- [ ] "Continue to Live setup →" opens the Live setup/overlay
- [ ] An OpenRouter key can be pasted, saved, tested and removed in Settings
- [ ] An OpenRouter-only setup keeps showing keys detected on this device (no setup-screen loop)
- [ ] Headings, lists and spacing look the same as v1.6.3 in Home, Jobs, Resume Studio and Documents
- [ ] Settings width/save button unchanged from v1.6.4

## Resources

- [Full Changelog](../CHANGELOG.md)
- [Release Process](RELEASE.md)
- [Release Checklist](RELEASE_CHECKLIST.md)
- [Signing Setup](../SIGNING.md)

---

**Note:** This is an unsigned personal preview build. It is not code-signed and has no auto-update feed.
For production use, wait for a signed stable release.
