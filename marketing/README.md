# MockMate marketing

Website-first campaign copy and publishing notes for MockMate.

Public landing page:

**https://mock-mate-theta-nine.vercel.app/landing.html**

## Canonical media

All source-controlled campaign/landing media lives in [`public/media/`](../public/media/). That directory is the single source of truth for website delivery and promo rendering.

Do not add duplicate video, image, audio, caption, transcript, or bundled ZIP copies under `marketing/`.

Current campaign copy remains here:

- `mockmate-post-copy.txt` — hook, caption, CTA, hashtags, alt text, and publishing note.

The full content-research and production prompt is in [`docs/MARKETING_CONTENT_PROMPT.md`](../docs/MARKETING_CONTENT_PROMPT.md).
The repeatable media workflow and compliance contract are in [`docs/MEDIA_PRODUCTION_PLAN.md`](../docs/MEDIA_PRODUCTION_PLAN.md).

## Generated outputs

Promo renders and downloadable bundles are generated into `artifacts/marketing/` and are intentionally not committed. Generate fresh artifacts from the canonical `public/media/` inputs rather than storing snapshots in Git.

## Publishing notes

The people shown are illustrative AI-generated campaign visuals, not customers or testimonials. The sample question in the video is illustrative, not a product screenshot or a promise that every session asks that exact question. Verify current setup, feature availability, and download options on the landing page before publishing.
