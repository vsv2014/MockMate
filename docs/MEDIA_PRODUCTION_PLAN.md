# MockMate Media Production Plan

This document defines the repeatable production path for MockMate landing and campaign media.

## Goals

- Keep landing media reproducible from repository assets.
- Use truthful product language: no undetectable/guaranteed capture claims.
- Keep Win/macOS share-preview verification and Linux content-protection limitations visible.
- Label campaign visuals as illustrative when they are not literal application screenshots.
- Prefer native browser video controls for accessible playback.
- Keep landing copy and SEO metadata static in `public/landing.html`; do not rely on client-side copy replacement for public claims.

## Batch 1 assets

- `marketing/card-solo-practice.png`
- `marketing/card-live-mode.png`
- `marketing/voiceover-solo.mp3`
- `marketing/voiceover-live.txt`
- `marketing/captions-solo.srt`
- `marketing/captions-live.srt`

The closed Arena session's original Live brand-voice MP3 did not survive the handoff. Do not substitute the Solo MP3 under a Live filename. Live rendering therefore synthesizes a deterministic narration from `voiceover-live.txt`; its captions are distinct and match the Live script. A future brand-voice recording may replace that generated narration after audio/caption QA.

Landing-serving copies live under `public/media/`; landing HTML must reference `/media/...`, never repository-only `marketing/` paths or raw-GitHub hotlinks.

## Render pipeline

Run:

```bash
bash scripts/render-promo-video.sh solo
bash scripts/render-promo-video.sh live
```

The script uses ffmpeg to combine a campaign card, narration, and captions with a restrained Ken Burns treatment. Solo uses the committed voice MP3. Live synthesizes its distinct narration from the committed text source before rendering. Output is written under `marketing/rendered/` and is not required for local application builds.

The manual `.github/workflows/render-promo.yml` workflow verifies the runner's ffmpeg and installs `espeak` only when a Live render needs it.

## Landing usage

`public/landing.html` is the single canonical public landing surface. It owns the hero, static public copy, canonical/OG/Twitter metadata, Solo/Live sections, native-controls explainer, auth markup, and OS-aware download labels. Shared `public/auth-web.js` stays auth-only.

The explainer uses native browser controls, captions, transcript access, and audio-only fallback. Do not cover the browser volume control with a custom overlay.

## Landing regression contract

Keep these identifiers and behaviors stable unless the corresponding integration is changed intentionally:

- Auth overlay and `auth-web.js` integration.
- `theme-toggle`.
- Download CTA IDs: `nav-download`, `hero-download`, `cta-download`.
- Platform detection and qualified macOS/Linux release wording.
- `hero-stealth-chip` with verify-share-preview wording.
- Native video controls.
- `noscript` reveal fallback.
- Skip-to-content link.
- Explicit labels/`aria-label`s for the five auth inputs.
- `prefers-reduced-motion` handling.
- Static canonical, OG, and Twitter metadata with an absolute self-hosted social image.
- Signup supports both immediate-token and `verificationRequired` responses and must have only one submit handler.

## Accessibility and performance

- Keep content visible when JavaScript is unavailable.
- Respect `prefers-reduced-motion` and disable animated card movement/crossfade when requested.
- Provide intrinsic image dimensions.
- Preload only the hero asset that materially affects LCP.
- Keep media under `public/media/` for same-origin delivery.
- Keep explicit labels on authentication inputs.
- Keep a skip-to-content link.

## Compliance guardrails

- Never claim the overlay is "undetectable" or guaranteed hidden.
- Windows/macOS content protection must be described as a supported OS capture-protection path and users must verify the real Zoom/Meet/Teams share preview.
- Linux content protection is not supported.
- BYOK credentials stay local to the device; prompts/audio/content still go to the providers the user selects.
- Managed AI/STT uses hosted MockMate services and plan quotas where configured.
- Do not advertise macOS/Linux as current v1.5.2 public downloads unless release artifacts actually exist.
- No fake testimonials, fabricated user counts, or invented latency guarantees.
