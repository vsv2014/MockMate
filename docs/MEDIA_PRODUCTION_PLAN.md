# MockMate Media Production Plan

This document defines the repeatable production path for MockMate landing and campaign media.

## Single source of truth

`public/media/` is the canonical source-controlled media tree for both the landing page and promo rendering. Do not keep binary/media copies under `marketing/`.

Canonical assets:

- `public/media/card-solo-practice.png`
- `public/media/card-live-mode.png`
- `public/media/mockmate-promotional-video.mp4`
- `public/media/mockmate-voiceover.mp3`
- `public/media/mockmate-video-captions.srt`
- `public/media/mockmate-video-transcript.txt`
- `public/media/live-voiceover.txt`
- `public/media/live-captions.srt`

`marketing/` is for campaign copy and publishing notes only. Generated renders and bundles go under `artifacts/marketing/` and are not committed.

The closed Arena session's original Live brand-voice MP3 did not survive the handoff. Do not substitute the Solo MP3 under a Live filename. Live rendering synthesizes deterministic narration from `public/media/live-voiceover.txt`; its captions are distinct and match the Live script. A future brand-voice recording may replace that generated narration after audio/caption QA.

## Goals

- Keep one source-controlled copy of each media asset wherever possible.
- Keep landing media reproducible from repository assets.
- Use truthful product language: no undetectable/guaranteed capture claims.
- Keep Win/macOS share-preview verification and Linux content-protection limitations visible.
- Label campaign visuals as illustrative when they are not literal application screenshots.
- Prefer native browser video controls for accessible playback.
- Keep landing copy and SEO metadata static in `public/landing.html`; do not rely on client-side copy replacement for public claims.

## Render pipeline

Run:

```bash
bash scripts/render-promo-video.sh solo
bash scripts/render-promo-video.sh live
```

The renderer consumes only `public/media/` inputs. Solo uses the committed narration MP3 and captions. Live synthesizes its distinct narration from the committed text source before rendering. Generated videos are written to `artifacts/marketing/`.

The manual `.github/workflows/render-promo.yml` workflow verifies ffmpeg and installs `espeak` only when a Live render needs it.

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

## Validation before publishing rendered media

- Run both Solo and Live renders in the manual workflow.
- Verify captions against the rendered audio and adjust SRT timings if they drift.
- Confirm the Live render contains Live narration, not the Solo script.
- Verify the social image and landing media resolve from `/media/` on the deployed origin.
