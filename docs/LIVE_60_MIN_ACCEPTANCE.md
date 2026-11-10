# MockMate — supervised 60-minute Windows Live acceptance

This is a **real-device acceptance test**, not a synthetic CI soak. Automated tests
cannot certify microphone permissions, system loopback, OS power events, global
shortcuts, provider credit state, screen-sharing protection or UI rendering.

## Build provenance

Install only the latest Windows **validation artifact** from the CI run matching
the tested commit SHA. Record SHA, Windows build, microphone/playback devices,
the selected AI provider/model, Deepgram mode (BYOK/managed) and OS display
scale. The CI artifact is not a signed production release.

## Preflight (before the 60-minute clock)

1. Back up existing saved sessions and approved sources. Confirm that their
   account-scoped records still open after updating the application.
2. Open Settings → verify the intended model/provider response and quota;
   ensure a fallback provider is configured where available. Do not accept an
   HTTP 200 from a health probe as proof of a complete streaming answer.
3. In Ready Room, test microphone and **entire-screen system audio separately**.
   Hearing yourself in the mic test is not evidence of system audio capture.
4. When using System Audio, explicitly enable the separate **candidate mic** in
   Live and verify captured candidate speech **within the first ten minutes**.
   It is opt-in and can incur additional Deepgram usage.
5. Connect only previously approved sources. Enable background sync for one
   approved source to verify it does not run during Live. Never enable
   unrestricted external account access.

## Live test: 60 full minutes

- **0–10 min:** Start System Audio + candidate mic; verify both socket indicators.
  Ask/answer at least five prompts. Confirm answers are actually visible, not
  only that the AI provider connection test passed.
- **10–25 min:** Cover follow-ups, longer technical questions, coding/partial
  answers and fast speaker changes; note missing or incorrect question splits.
  Use the manual Answer Now control once to ensure it can recover a missed
  question. Confirm TTFT and completed answers.
- **25–40 min:** Keep Live running through at least one scheduled connector
  interval. Connector scans/imports must remain paused; playback and microphone
  should continue. Check for dropped PCM frames and transcript gaps.
- **40–50 min:** If safe, switch and restore the capture source once; verify
  the selected device and re-enable candidate mic if required. Verify
  reconnection without a duplicate interview or lost transcript. Do **not**
  intentionally revoke all accounts or exhaust a paid provider during this test.
- **50–60 min:** Exercise screen analysis only with consent, and check the
  application-overlay exclusion in your actual Zoom/Meet share preview.
  Verify text layout at normal display scale and keyboard shortcuts.
  Ask/answer enough prompts that the run totals at least ten committed
  questions and ten delivered hints.
- **At 60+ min:** End through the application. Leave “Wrapping up” open until
  scored. Do not click cancel unless explicitly testing recovery. Confirm
  saved transcript, candidate speech, evaluation score and reopen in Sessions.

## Recovery scenario

If scoring fails or is deliberately cancelled, open **Sessions → Retry score**
from the preserved transcript. The new report must not overwrite a modified,
deleted, provisional or interviewer-only transcript. Do not call a failed or
cancelled score a successful 60-minute acceptance.

## Export and analysis

From Settings → Diagnostics, export the sanitized JSONL bundle. On a checkout
of the tested code:

```sh
node scripts/verify-live-60min.mjs "C:\\Users\\<your-user>\\Downloads\\MockMate-Diagnostics-....jsonl"
```

Or supply the exact opaque session ID as the second argument if you recorded
multiple sessions after the hour-long test.

**Pass** requires a full 60-minute Windows Live run, actual System Audio and
candidate mic connectivity, candidate speech early and late, PCM audio
heartbeat coverage with audible signal, at least ten committed questions,
at least ten delivered hints, zero user-visible errors/incomplete streams,
no unrecovered PCM stalls, and a verified saved/scored transcript.

A long gap between transcript events is a **review warning**, not automatic
proof of capture failure. Investigate with PCM heartbeats and the observed
meeting audio. Likewise, a completed desktop CI or an installer smoke test is
not this acceptance test.

## Security / privacy

Only share the **redacted diagnostics export**, never raw audio, interview
transcripts, screenshots, provider keys, JWTs, OAuth tokens or full source
documents. The diagnostics tool outputs opaque IDs, counts and state labels.

## Release gate

Record the tested installer SHA, OS build, provider/model and date. If any
check fails, preserve the affected log and reproduce with a shorter targeted
test before repeating an entire hour. Do not publish or sign a release as
production-ready solely based on CI.
