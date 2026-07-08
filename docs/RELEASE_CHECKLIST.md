# MockMate release checklist

**Rule: no `git tag` / no upload until every box below is checked on a REAL packaged build.**
Every 1.4.2 defect (CSP broke Solo+Live, STT coupled to the LLM cap, dangling `mintToken` import,
no `.gitignore`, un-closeable login) was a "nobody ran the packaged build and clicked through it"
bug. Dev (`npm run dev`) hides all of them — Vite serves with no CSP and a real browser window.
**You must test the packaged artifact, not the dev server.**

## 0. Clean-room build (catches missing deps / stale node_modules)
- [ ] `rm -rf node_modules dist release && npm install` (fresh — mirrors a new machine)
- [ ] `npm run build` completes with no errors
- [ ] `npm test` green (46+ tests)
- [ ] `git status` shows no build artifacts tracked (dist/ ignored)

## 1. Packaged app boots (catches CSP / server-fork / dangling-import bugs)
- [ ] `npm run electron:build:win` (or your target) produces an installer
- [ ] Install it fresh and launch — window appears, not blank
- [ ] DevTools console: **zero red errors**, especially **no CSP `Refused to connect`** to `localhost:4000`
- [ ] The auth/login window can be **moved, minimized, and closed** without Task Manager

## 2. Auth + backend (managed mode, the default)
- [ ] Sign up a new account → lands in the app (no infinite spinner, no silent failure)
- [ ] Backend reachable: no "Can't reach MockMate" on login/signup
- [ ] Sign out → sign back in works

## 3. Solo Practice — end to end
- [ ] Start a session → interviewer asks a real question (not an error toast)
- [ ] Answer → follow-up question generates
- [ ] End → evaluation report renders with scores
- [ ] Bad-key / over-cap path shows a **clear message** (not a raw 4xx, not "check your API key" in managed mode)

## 4. Live Interview — end to end (the core moment)
- [ ] Start Live → transcription connects (Deepgram token minted)
- [ ] Speak an interviewer question → a hint **streams** (first word < ~1.5s)
- [ ] Overlay is **invisible in a real screen share** (Zoom/Meet/Teams test) — the whole moat
- [ ] Response-length + Coach/Answer toggles change output
- [ ] Runs 5+ min without the socket dying; survives a brief network blip

## 5. Screenshot solve
- [ ] Ctrl+Shift+U on a coding problem → answer-first solution, no refusal
- [ ] "Faster" vs "Quality" setting changes verbosity

## 6. Duo (when enabled)
- [ ] `LIVEKIT_*` set → create room, join from a 2nd client, transcript syncs, End → report
- [ ] `LIVEKIT_*` unset → Duo shows a clean "not configured" state, **does not crash the app**

## 7. Regression sweep
- [ ] Over the free cap: LLM routes 402 with the upgrade message; **Live transcription still works** (STT not cap-gated)
- [ ] BYOK mode: keys entered in Settings → Solo/Live use them, no auth required
- [ ] What's New modal shows once after a version bump, then not again

## 8. Ship
- [ ] Bump `version` in package.json + add a CHANGELOG entry
- [ ] Tag + upload
- [ ] Post-publish: download the published installer on a clean machine and repeat §1–§4 (auto-update path)

---
*Scripted pre-checks (fast gate, run before the manual pass):*
```
npm ci && npm run verify        # verify = doctor (install/bin integrity) + build + tests
```
`npm run doctor` alone catches the "install looks fine but a bin/dep is missing" class (e.g. a
missing electron shim) that build+test miss. *The manual §1–§7 pass is the part that actually
protects the moat — do not skip it.*
