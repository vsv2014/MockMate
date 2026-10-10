# MockMate release checklist

**Current target: v1.5.5 (unpublished as of 2026-10-10).** The last actually published Windows installer is v1.5.3; v1.5.4 was an interim source-only hotfix. Check `package.json` and `package-lock.json` versions and use a new matching tag only after all gates pass.

**Rule: no `git tag` / no upload until every box below is checked on a REAL packaged build.**
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
- [ ] the Release workflow produces a signed Windows installer (PR CI artifacts are unsigned validation-only)
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
- [ ] An old **unsigned** installation's upgrade path is tested explicitly; use the manually downloaded signed installer if the old updater cannot establish trusted provenance.
- [ ] Managed mode: every one-use gateway ticket and bounded stream uses authenticated quota reservation/settlement; verify safe behavior across reconnect, duplicate ticket replay, stop and backend graceful shutdown. A host crash still requires durable reservation reconciliation; do not claim precise provider-billed per-second accounting without real E2E evidence.
- [ ] Repeat an actual 10+ minute Live session with sleep/wake, device change, network flapping and diagnostics redaction on a Windows host.

## 9. Ship
- [ ] `package.json` version matches a **new** release tag and CHANGELOG/release notes match the final implementation
- [ ] For this candidate, run the version-generic release workflow from reviewed current `main` with new `v1.5.5` tag **only after signing secrets, real Windows certification, and (for Managed AI) hosted WSS/Mongo/Deepgram verification are complete**
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
