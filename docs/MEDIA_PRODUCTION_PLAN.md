# MockMate Media Production Plan

This document defines the repeatable production path for MockMate landing and campaign media.

## Goals

- Keep landing media reproducible from repository assets.
- Use truthful product language: no undetectable/guaranteed capture claims.
- Keep Win/macOS share-preview verification and Linux content-protection limitations visible.
- Label campaign visuals as illustrative when they are not literal application screenshots.
- Prefer native browser video controls for accessible playback.

## Batch 1 assets

- `marketing/card-solo-practice.png`
- `marketing/card-live-mode.png`
- `marketing/voiceover-solo.mp3`
- `marketing/voiceover-live.mp3`
- `marketing/captions-solo.srt`
- `marketing/captions-live.srt`

These filenames are stable inputs for the render pipeline. The current PR reuses the already-versioned campaign source art/audio so the pipeline remains deterministic and binary-safe.

## Render pipeline

Run:

```bash
bash scripts/render-promo-video.sh solo
bash scripts/render-promo-video.sh live
```

The script uses ffmpeg to combine a campaign card, voiceover, and captions with a restrained Ken Burns treatment. Output is written under `marketing/rendered/` and is not required for local application builds.

## Landing usage

The landing page may use the campaign cards for a subtle crossfade/Ken-Burns hero treatment and the existing narrated explainer with native browser controls, captions, transcript access, and audio-only fallback. Do not cover the browser volume control with a custom overlay.

## Accessibility and performance

- Always include a `noscript` visibility fallback for reveal animations.
- Respect `prefers-reduced-motion` and disable animated card movement/crossfade when requested.
- Provide intrinsic image dimensions where possible.
- Preload only the hero asset that materially affects LCP.
- Keep explicit labels on authentication inputs.
- Keep a skip-to-content link.

## Compliance guardrails

- Never claim the overlay is "undetectable" or guaranteed hidden.
- Windows/macOS content protection must be described as a supported OS capture-protection path and users must verify the real Zoom/Meet/Teams share preview.
- Linux content protection is not supported.
- BYOK credentials stay local to the device; prompts/audio/content still go to the providers the user selects.
- Managed AI/STT uses hosted MockMate services and plan quotas where configured.
- No fake testimonials, fabricated user counts, or invented latency guarantees.
