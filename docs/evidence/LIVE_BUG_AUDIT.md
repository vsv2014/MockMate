# Live interview defects — prioritized release gate

**Status:** October 10, 2026 (v1.5.5 candidate code, not a published release). This is a *Live interview* filter of the earlier
~141 **audit candidates**, not a claim that all 141 are reproduced or fixed.
Current evidence comes from merged pull requests, code review, and targeted
tests. The original numbered audit was not preserved in a complete row-by-row
file. Do not invent unseen descriptions or close items by range.

Definitions:
- **Merged**: targeted fix is present in `main`, regression may be automated.
- **Merged but not deployed/certified**: fix is on GitHub `main`; hosting or real-device production behavior may still be unverified.
- **Unverified**: requires reproducible failure or physical-device evidence.

| ID | Severity | Behavior / failure | Status | Evidence / validation needed |
|---|---|---|---|---|
| L01 | P1 | Flaky Deepgram connections can endlessly reset reconnect budget | Merged | #65, retries only reset after 30s stable |
| L02 | P1 | Reconnect delays exceed old audio queue | Mitigated | #66, queue 15s; test loss on device |
| L03 | P1 | WebSocket send races with close and loses PCM | Merged | #67, `deepgramTransport.test.js` |
| L04 | P1 | Buffered PCM replay discards unsent tail | Merged | #67, regression in `deepgramTransport.test.js` |
| L05 | P1 | Speaker IDs leak across Deepgram sockets | Merged | #67, reset diarization on socket open |
| L06 | P1 | Slow permission prompt resurrects stopped capture | Merged | #67, generation guarded capture |
| L07 | P1 | Overlapping system-audio restarts race | Merged | #67, restart revision checks |
| L08 | P1 | SSE CRLF split across chunks misparsed | Merged | #67, split SSE regression |
| L09 | P1 | Partial streamed hint finalized without terminal event | Merged | #67, incomplete stream tests |
| L10 | P1 | Failed streaming hint invokes duplicate paid fallback | Merged | #67, HTTP error/fallback regression |
| L11 | P1 | STT reconnect mints duplicate five-minute grants | Merged | #68, per-hook TTL-limited grant cache |
| L12 | P0 | Direct provider WebSocket can exceed managed STT reservation | Merged; hosted unverified | #72 backend WSS gateway caps segment by time and PCM; real provider/Mongo/billing proof outstanding |
| L13 | P1 | First PCM frames lost while DB quota reservation is in progress | Merged; hosted unverified | #72 deferred-reservation and buffered-audio tests |
| L14 | P1 | First-turn Finalize lost before upstream provider opens | Merged; hosted unverified | #72 buffered control replay regression |
| L15 | P1 | Stop during pending usage reservation strands allowance | Merged for normal/graceful stop; crash open | #72 cancellation and #74 graceful drain; abrupt-crash durable reservation reconciliation not implemented |
| L16 | P1 | Sleep/wake, display/audio-device switching may race reconnect | Merged; device unverified | #76 track-ended reacquisition regression; real mic/loopback and wake cycles still required |
| L17 | P1 | Question detection might duplicate or misclassify turns | Unverified | Full scripted interviewer/candidate real-STT matrix |
| L18 | P1 | Retry/cancel/new question could race generation state | Unverified | Slow LLM and rapidly edited/aborted prompts |
| L19 | P1 | Unsaved Live session notes could be lost on application crash | Merged; device unverified | #75 bounded, read-only account-scoped question/hint recovery; physical kill/relaunch still required |
| L20 | P0 privacy | Overlay capture exclusion differs by OS/share mode | Manual blocker | Windows/macOS Zoom, Meet, Teams share-preview screenshots; Linux unsupported |
| L21 | P1 privacy | Session metric error event could persist raw speech/secret in provider errors | Merged; export unverified | #72 metrics redaction tests; actual packaged export still needs inspection |
| L22 | P1 | Provider auth failure mapped to retryable WebSocket close | Merged; hosted unverified | #72 fatal-close gateway regression |
| L23 | P1 | Less than 300s remaining quota could be denied rather than reserving remaining seconds | Merged; hosted unverified | #72 partial-lease regression |
| L24 | P1 security | Duplicate model/PCM query parameters could bypass our chosen upstream STT policy | Merged; hosted unverified | #72 query-parameter validation regression |
| L25 | P0 | Electron CSP missing HTTPS API's WSS managed STT socket origin | Merged; packaged-provider unverified | #72 CSP and origin tests; actual hosted WSS connection in signed installer outstanding |

## Required verification before public release

- [x] PR #72 merged with passing Linux/Windows CI and packaged-renderer checks. **Not a substitute for a real hosted gateway test.**
- [ ] Real managed backend Mongo + HTTPS/WSS deployed with correct upgrade routing and sticky one-time tickets; record provider-billed duration vs server reservation.
- [x] Graceful process shutdown drains STT settlements before MongoDB close (PR #74).
- [ ] Abrupt process-crash recovery of in-flight STT reservations. Bounded sockets still need durable reservation reconciliation and provider invoice checks.
- [ ] Run repeated long interviews on a real Windows machine: STT mic, loopback, speaking overlap, accents, partial questions, sleep/wake, device switching, network blips and manual Stop.
- [ ] Validate screen-share privacy in actual Zoom/Meet/Teams screen-share previews, including full display/window sharing; never promise universal invisibility.
- [ ] Verify signed NSIS upgrade from previous stable installer, rollback path, persistence of local sessions and OS capture consent.
- [ ] Reconstruct remaining original audit findings in issue #71; do **not** claim zero confirmed bugs just because only a few are logged in GitHub.

## Related evidence

- Historical audit reconciliation: #71
- Managed streaming cap issue: #69
- Consolidated managed STT gateway and graceful settlement: #72, #74
- Major framework packaged renderer gate: #70
- Earlier Live fixes: #64–#68
- Device checklist: `docs/RELEASE_CHECKLIST.md`
- Read-only Live checkpoint and track recovery: #75, #76
- Account isolation and recovery: #77, #79
