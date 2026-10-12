# MockMate release checklist

**Current source version: 1.6.3, published as an unsigned personal preview.** The signed public gates below apply to the next signed release: missing signing credentials stop it, and no unsigned fallback is allowed. Package and lock versions must match the new immutable tag.

**Rule: do not describe any build as physically certified until every applicable box below is checked on a REAL packaged build.** The separate explicit manual unsigned-preview path may publish only as an isolated, manual-update pre-release after automated CI; it is not a substitute for these physical checks.
Every 1.4.2 defect (CSP broke Solo+Live, STT coupled to the LLM cap, dangling `mintToken` import,
no `.gitignore`, un-closeable login) was a "nobody ran the packaged build and clicked through it"
bug. Dev (`npm run dev`) hides all of them — Vite serves with no CSP and a real browser window.
**You must test the packaged artifact, not the dev server.**

## 0. Clean-room build (catches missing deps / stale node_modules)
- [ ] `rm -rf node_modules dist release && npm install` (fresh — mirrors a new machine)
- [ ] `npm run build` completes with no errors
- [ ] `npm test` green for the exact candidate commit
- [ ] `npm run smoke:api` green
- [ ] `git status` shows no build artifacts tracked (dist/ ignored)

## 1. Packaged app boots (catches CSP / server-fork / dangling-import bugs)
- [ ] the Release workflow produces either a verified signed installer or the isolated `UNSIGNED` Personal Preview artifact with no updater metadata
- [ ] Install it fresh and launch — window appears, not blank
- [ ] DevTools console: **zero red errors**, especially **no CSP `Refused to connect`** to `localhost:4000`
- [ ] The auth/login window can be **moved, minimized, and closed** without Task Manager

## 2. Auth + backend (managed mode, the default)
- [ ] Sign up a new account: if email verification is disabled, lands in the app; if `REQUIRE_EMAIL_VERIFICATION=1`, shows the explicit **Check your email** state and stores no session token until verification succeeds
- [ ] Verification-enabled hosted mode refuses to boot unless mail delivery prerequisites are valid (`RESEND_API_KEY` + HTTPS `VERIFY_URL_BASE`)
- [ ] Backend reachable: no "Can't reach MockMate" on login/signup
- [ ] Sign out → sign back in works
- [ ] Two real accounts plus Guest: N01 saved-job status/notes and N02 Resume Studio drafts remain isolated, including after restart; verify account deletion clears its own scoped data only
- [ ] Upgrade an installation with legacy global jobs and career drafts: schema v3→v4 first-sign-in migration attributes existing data to the intended account; preserve other accounts' scoped state

## 3. Solo Practice — end to end
- [ ] Start a session → interviewer asks a real question (not an error toast)
- [ ] With resume+JD filled: ≥8/10 main questions name a resume project or JD skill (manual rubric)
- [ ] Zero “please answer / go ahead and answer” interviewer turns in a 10-turn dry-run
- [ ] Answer → follow-up question generates and references what you said
- [ ] End → evaluation report renders with scores
- [ ] Bad-key / over-cap path shows a **clear message** (not a raw 4xx, not "check your API key" in managed mode)

## 3b. Live glanceable answers
- [ ] After a streamed hint finishes: opener + ≤3 bullets visible; full answer behind Expand
- [ ] Force stream failure/abort mid-token → the partial hint is visibly incomplete with Retry; do **not** silently issue a second paid LLM call. Only 404/405/501 stream-unavailable responses may use JSON compatibility fallback

## 3c. Packaged Live dry-run evidence (First 10 #10)
- [ ] Copy `docs/evidence/LIVE_DRY_RUN_TEMPLATE.md` → `docs/evidence/vX.Y.Z.md` for this version
- [ ] Fill required interruption IDs (I01, I03, I04, I15, I16, I19) as PASS on Windows
- [ ] Attach the evidence file to the GitHub Release (`npm run check:dry-run`)

## 4. Live Interview — end to end (the core moment)
- [ ] Start Live in Managed AI → desktop obtains a short-lived **single-use backend WSS ticket**, not a direct Deepgram grant; authenticated gateway reserves at most one bounded segment before provider streaming and enforces PCM/time limits
- [ ] Speak an interviewer question → a hint **streams** (first word < ~1.5s)
- [ ] Inspect actual Zoom / Meet / Teams window and full-screen share previews; record whether the overlay is excluded by each mode. Do **not** assume universal invisibility.
- [ ] Response-length + Coach/Answer toggles change output
- [ ] Runs 5+ min without losing the interview; survives a brief network blip. For **managed gateway** reconnect, verify new one-use tickets/segment reservations and correct usage settlement; BYOK's direct-to-provider flow is separate. Do not assume hosted grant reuse from the legacy implementation.
- [ ] On a test kill/relaunch, recent Live question/hint notes are readable via explicit recovery, without auto-resuming mic, STT, generation or billing
- [ ] Physically exercise sleep/wake and audio-track `ended` without `devicechange`, and verify capture reacquisition never resurrects after Stop

## 4b. Live answers, key setup, product insights and Windows overlay (v1.6.3: #93, #94)
- [ ] On the packaged build, replay fragmented definitions, topic changes, duplicate STT finals, coding corrections and short follow-ups ("draw it", "show me the code", "explain the architecture", "give me an example") through capture and generation. Follow-ups resolve against the previous question and AI suggestion, and a question longer than 800 characters is answered in full
- [ ] Benchmark the same recorded input and context, with the same provider and model, against a **named baseline release**: the one the regression report compared against or, if none was recorded, the latest stable public Windows release (v1.5.3). Record the selected model, TTFT, completion/truncation status, capture-to-answer latency and token usage/cost from diagnostics (never transcript content), with the baseline tag, in `docs/evidence/VALIDATION_STATUS.md`
- [ ] Concise style: coding/design answers still contain complete code or architecture within 1,800 tokens, and simple answers on the blocking `/api/hint` path (Live JSON compatibility fallback, Duo or mobile) finish within **380 tokens** with no truncation and no JSON-repair request (`request_usage` `requestIndex` stays 0)
- [ ] Windows transparent overlay: collapse to the badge, drag, expand and resize with the custom edge handles at 100% and one non-default page zoom. Transparency survives every step. Repeat with microphone and system-playback sources
- [ ] **Long answers finish:** with a real provider, a coding or system-design answer that streams for more than 11 seconds completes without an "outage" error. Diagnostics show no `attempt_timed_out`, or only `timeoutKind: first_token` before failover
- [ ] **Early answer start:** with system audio in BYOK mode, a clear question's answer starts sooner than with `localStorage['mm-live-early-answer'] = '0'`, and diagnostics show `speculative_hint` `claimed`. When the interviewer pauses and then adds to the question, no answer to the shorter question is shown, the answer covers the full question, and diagnostics show `cancelled` with `speech_continued`
- [ ] **Claude:** with only an Anthropic key, quick answers use Claude Haiku 5.5 and coding/design answers use Claude Sonnet 5.5. First words arrive without a long silent pause, and there is no `thinking_setting_rejected`
- [ ] **Product insights privacy:**
  - Rapid-click a document's Remove button, a History session's buttons and (in icon-sidebar mode) the account button.
  - The panel shows only fixed identifiers (for example `document_remove`, `nav_account`), never names or text.
  - With **Include usage breadcrumbs in diagnostic logs** off, an exported log bundle contains no `product_intel` rows; with it on, it does.
- [ ] **Settings key setup:**
  - Paste an Anthropic, Gemini, Groq, OpenAI, Cerebras and Deepgram key: each is suggested correctly.
  - An unknown format requires choosing the provider; a mismatched choice asks for confirmation; OpenRouter and admin keys are refused.
  - Keys saved by the previous release still appear and work after upgrading; Test, Replace and Remove work.
  - "Which model answers" matches the models seen in diagnostics.

## 5. Screenshot solve
- [ ] Ctrl+Shift+U / F7 on a coding problem **from Live** → answer-first solution, no refusal
- [ ] Home does **not** show a screen-analysis panel / “Screenshot + solve” CTA
- [ ] "Faster" vs "Quality" setting changes verbosity

## 5b. Resume Studio
- [ ] Tailor → **Download PDF** produces a readable 1–2 page file with applied summary/bullets
- [ ] Referral → Copy note / Copy to paste works; no send-email affordance
- [ ] Minimize-to-pill and restore: analysis JD / tailor draft still present

## 6. Duo (when enabled)
- [ ] `LIVEKIT_*` set → create room, join from a 2nd client, transcript syncs, End → report
- [ ] `LIVEKIT_*` unset → Duo shows a clean "not configured" state, **does not crash the app**

## 7. Regression sweep
- [ ] Home → Interview Kits → Ready Room → Live works in the packaged release candidate; active Kit selection, create/edit/delete, and no-Kit fallback states behave correctly.
- [ ] Kit Solo and Live sessions retain the correct role/JD/preferences and selected Kit-document IDs in their session snapshot, keep drafts per Kit, exclude the shared document library, and do not overwrite the shared profile.
- [ ] Upload/select PDF, TXT, and Markdown supporting materials in a Kit; verify they remain account-local and visible only to that Kit, selected files alone ground its Solo/Live retrieval, removal clears the cached index, and deleting the Kit leaves shared documents unchanged.
- [ ] Ready Room distinguishes local service availability, configured providers, successful AI/voice tests, and OS/share-preview checks; provider-test usage is disclosed before any potentially billable call.
- [ ] Over the LLM cap: managed LLM routes 402 with the upgrade message
- [ ] Over the STT cap: managed WSS ticket/stream and uploaded `/transcribe` reject **before provider spend** with `stt_quota_exhausted`; failed reservation/provider attempts settle or refund correctly, including graceful shutdown
- [ ] Near the STT cap: a long upload cannot pass on “1 second remaining”; server-probed duration must reserve atomically before Deepgram is called
- [ ] BYOK mode: keys entered in Settings → Solo/Live use them, no hosted account quota is consumed
- [ ] What's New modal shows once after a version bump, then not again

## 8. Hosted deployment
- [ ] Vercel deployment completes on Hobby with **≤12 Serverless Functions** (PR #46 consolidated 15 → 12)
- [ ] Existing public `/api/ats-score`, `/api/referral`, `/api/resume-latex`, and `/api/tailor-resume` URLs still work through rewrites to the consolidated career function
- [ ] Public Vercel API remains default-deny unless `MOCKMATE_ALLOW_PUBLIC_API=1` is intentionally set

## 8b. Windows update signing and grant accounting
- [ ] Public Release CI has `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` and `MOCKMATE_WINDOWS_PUBLISHER` set, with publisher matching the actual cert Subject.
- [ ] `Get-AuthenticodeSignature` reports **Valid** on the NSIS installer and unpacked app executable; downloaded updates are publisher-verified.
- [ ] If all signing settings are intentionally absent, CI instead reports **NotSigned** for both binaries, uses the Personal Preview app identity, publishes only an `UNSIGNED` pre-release plus checksum/notice, and publishes no updater metadata.
- [ ] An old **unsigned** installation's upgrade path is tested explicitly; use the manually downloaded signed installer if the old updater cannot establish trusted provenance.
- [ ] Managed mode: every one-use gateway ticket and bounded stream uses authenticated quota reservation/settlement; verify safe behavior across reconnect, duplicate ticket replay, stop and backend graceful shutdown. A host crash still requires durable reservation reconciliation; do not claim precise provider-billed per-second accounting without real E2E evidence.
- [ ] Repeat an actual 10+ minute Live session with sleep/wake, device change, network flapping and diagnostics redaction on a Windows host.

## 9. Ship
- [ ] `package.json` version matches a **new** release tag and CHANGELOG/release notes match the final implementation
- [ ] Run the signed-only release workflow from reviewed main with a new vX.Y.Z tag only after signing, automated and device acceptance checks.
- [ ] Post-publish: download the published Windows installer on a clean machine and repeat §1–§4
- [ ] Keep the last published Windows version **v1.5.3** installed → Check for updates → Downloading → Ready → Restart & install; **do not uninstall** during this test. For unsigned-to-signed migration, verify the safe manual signed-installer path if the legacy updater cannot verify provenance.
- [ ] Settings → Diagnostics → Export logs; verify updater/provider/STT/session events exist and no key/token/transcript/prompt/screenshot content appears

---
*Scripted pre-checks (fast gate, run before the manual pass):*
```
npm ci && npm run verify        # verify = doctor (install/bin integrity) + build + tests
```
`npm run doctor` alone catches the "install looks fine but a bin/dep is missing" class (e.g. a
missing electron shim) that build+test miss. *The manual packaged pass is the part that actually
protects the moat — do not skip it.*
