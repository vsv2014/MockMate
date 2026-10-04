# Platform modernization review ledger

This ledger records the staged modernization chain and the evidence required before each merge. The sequence deliberately keeps one major/runtime boundary per PR so every stage remains independently testable and revertible.

## Merge order

1. **#54 — Electron 44 / v1.5.5**
2. **#55 — Vite 8 / Rolldown**
3. **#56 — React 19**
4. **Next — Vitest 5**
5. **Then — remaining package audit**

Do not merge #55 or #56 before #54 passes the installed-machine gate and merges.

---

## #54 — Electron 44 / v1.5.5

**Verdict:** HOLD for the installed-machine gate, then SHIP.

### Approved baseline

- Electron `43.0.0` → `44.5.1`
- electron-builder `26.15.3` → `26.17.0`
- electron-updater `6.8.9` → `6.8.10`
- CI/dev Node → `24.21.0` LTS
- package version `1.5.4` → `1.5.5`
- latest branch head: `e35164a34b3bc2ef3c79948421b8d04a589a4492`
- Desktop CI #198: green on the latest head
- verification baseline: `67 suites / 482 tests`

The `1.5.5` bump is intentional: a real updater-interoperability test requires the installed `1.5.4` client to see a strictly newer semver target.

### Automated protections

- `verify:platform` runs before dependency installation and enforces exact stable Electron / builder / updater versions plus package-lock agreement.
- Stable-only policy: Electron 45 prerelease, builder 27 alpha, updater 7 alpha, and Node 26 Current are excluded.
- Root + backend `npm audit --audit-level=critical` gate critical advisories.
- Windows CI builds the real NSIS installer, not only an unpacked directory.
- CI launches packaged `MockMate.exe` and requires the local UI/API (`:3002`) and account backend (`:4000`) to become ready.
- CI verifies the installer, `latest.yml`, blockmap, and `app.asar` and emits `validation-baseline.json`.
- Validation artifacts are retained for **7 days**.
- The release workflow repeats the platform contract and packaged-Windows runtime smoke before publication.

### Compatibility review

- No Electron main-process `clipboard` usage; renderer-side `navigator.clipboard` is unaffected by Electron 44's clipboard API change.
- Browser windows already use `contextIsolation: true`, `nodeIntegration: false`, and sandboxing.
- `desktopCapturer.getSources` remains in the main process.
- Native/ABI audit found no shipped `node-gyp` / `node-addon-api` / `binding.gyp` consumers requiring an Electron-44 rebuild.

### Final candidate baseline

The validated Electron-44 candidate produced:

- installer: `MockMate-Setup-1.5.5.exe`
- installer size: `164325202` bytes
- installer SHA-256: `b4a4b9bfc74456a384d76a0812af2782f57d347f2eebc6ae30357834d6471d3c`
- blockmap size: `173550` bytes
- `app.asar` size: `213002160` bytes
- packaged Windows runtime smoke: PASS

The latest head differs only by validation-artifact retention and also passed CI #198.

### Installed-machine gate

With v1.5.4 still installed, verify all of the following before merge:

1. **Updater interoperability:** v1.5.4 updater (`6.8.9`) accepts the v1.5.5 package produced by builder `26.17.0`; differential/full download completes, blockmap verifies, and the app restarts into Electron 44.
2. **safeStorage / BYOK persistence:** a key encrypted under Electron 43 decrypts correctly after the Electron 44 upgrade and a provider call succeeds.
3. **Restart / port reuse:** close and reopen at least three times; `:3002` and `:4000` are healthy each time; no orphan processes; `freePort()` does not kill an unrelated PID.
4. **Install hygiene:** upgrade-over-install and clean uninstall → install work; shortcuts/tray icons are correct; no stale old ASAR remains.
5. **Real flows:** sign-in, Solo microphone/STT, Live system audio, F7 screenshot solve, PiP, Alt+T overlay geometry, tray/global shortcuts, and Zoom/Meet/Teams share-preview/content-protection verification.
6. **Record results:** update the blast-radius and onboarding baselines before merge.

Green CI alone is not sufficient for #54.

---

## #55 — Vite 8 / Rolldown

**Verdict:** SHIP after #54 merges and the PR is retargeted/rebased to `main` with a fresh green CI run.

### Upgrade

- Vite → `8.3.2`
- `@vitejs/plugin-react` → `6.1.1`
- React intentionally remains `18.3.1` in this PR.
- Vitest intentionally remains 4.x.

### Migration quality

- Replaces deprecated Rollup-style `manualChunks()` with Rolldown `output.codeSplitting.groups`.
- Preserves the seven existing vendor boundaries for React, Sentry, LiveKit client, LiveKit UI, html2canvas, jsPDF, and PDF reader.
- Uses explicit priorities; `livekit-client` (`100`) outranks the broader `@livekit` group (`90`) so nested package paths do not get swallowed by the broader group.
- Uses Windows-safe path matching.
- Keeps dev-server host policy safe by default; controlled preview hosts use `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` rather than `allowedHosts: true`.
- Preserves the local `/api` proxy behavior.

### Regression gate

`verify:vite-output` runs after production build on Ubuntu and Windows and asserts:

- `dist/index.html` exists.
- `public/landing.html` is copied.
- landing media from `public/media` is copied.
- repository `marketing/` sources are **not** deployed through Vite output.
- all expected named vendor chunks are emitted.

### Evidence

Desktop CI #200 on head `bca00fc6f84a2cf3336993fa8836dff8ce0aa79f` is fully green:

- `67 suites / 482 tests` unchanged.
- API smoke PASS.
- Vite 8.3.2 production build PASS on Ubuntu and Windows.
- Rolldown output verification PASS on Ubuntu and Windows.
- Linux package + ASAR entrypoints PASS.
- real Windows NSIS installer PASS.
- packaged `MockMate.exe` runtime smoke PASS with required `:3002` / `:4000`.
- validation baseline + artifact upload PASS.

The Vite branch does not modify `api/` or `vercel.json`; the existing Vercel function consolidation / rewrite surface is unchanged.

Vite 8 requires a modern Node runtime (`^20.19 || >=22.12`); MockMate's pinned Node `24.21.0` satisfies this requirement.

---

## #56 — React 19

**Verdict:** SHIP after #55 merges and #56 is retargeted/rebased to `main` with a fresh green full CI/package/runtime run.

### Upgrade

- React `18.3.1` → `19.3.0`
- ReactDOM `18.3.1` → `19.3.0`
- scheduler resolves to the React-19 line.
- `loose-envify` / `js-tokens` disappear from the React dependency footprint as expected.
- No product/UX renderer code changes are required.

### Compatibility scan

The renderer already uses `react-dom/client` + `createRoot`.

Repository scan found no migration blockers:

- no `ReactDOM.render`
- no legacy `hydrate`
- no `unmountComponentAtNode`
- no `findDOMNode`
- no `createFactory`
- no legacy context (`contextTypes`, `childContextTypes`, `getChildContext`)
- no string refs
- no function-component `defaultProps` assignments
- no `propTypes` assignments
- no `react-test-renderer` / shallow renderer dependency

`npm ci` resolves the React 19 graph without a peer-dependency failure.

### Regression gate

`verify:react19` asserts:

- React / ReactDOM are pinned and resolved at `19.3.0`.
- package.json and package-lock agree.
- the renderer remains on `react-dom/client` + `createRoot`.
- removed/legacy React APIs remain absent from `src/`.

The check runs on Ubuntu and Windows before the normal product test suite.

The string-ref pattern is intentionally strict and may also flag a future `data-ref="..."`-style attribute; treat that as a maintainability note rather than a current defect.

### Evidence

Desktop CI #201 on head `7504d02ca6552130c3fcb44743674c32e594e747` is fully green:

- React 19 contract PASS.
- npm/peer resolution PASS.
- `67 suites / 482 tests` unchanged.
- API smoke PASS.
- Vite 8.3.2 / Rolldown production build PASS on Ubuntu and Windows.
- Vite output/public-media verification PASS.
- Linux package + ASAR entrypoints PASS.
- Windows NSIS installer PASS.
- packaged `MockMate.exe` runtime smoke PASS with required local services.
- validation baseline + 7-day artifact upload PASS.

React #56 validation artifact:

- artifact: `mockmate-windows-pr-56`
- artifact id: `11298845072`
- expires: `2026-10-11`
- installer: `MockMate-Setup-1.5.5.exe`
- installer size: `164399845` bytes
- installer SHA-256: `cc908b97b2c3a100b56a62c897c5270508d70a9492f060a0796d2a4b1314b50d`
- blockmap size: `173210` bytes
- `app.asar` size: `216363936` bytes

**Do not use the #56 installer as a substitute for #54's Electron-only installed-machine gate.**

---

## After #56

### Vitest 5

Create a separate PR for Vitest 5. Keep the pre/post test ledger at `67 suites / 482 tests`, and explicitly re-check known module-mocking behavior including `vi.doMock` + `importOriginal()` spread patterns and the STT lease suites.

### Remaining package audit

Audit Sentry, LiveKit, OpenAI, Mongoose, Stripe, Express, PDF.js, jsPDF, Helmet, dotenv, and remaining packages.

Policy:

- safe patch/minor changes may be grouped when the package family is tightly coupled;
- majors get separate migration PRs;
- desktop/runtime-sensitive dependency changes require the packaged Windows runtime smoke.

### Dependency automation

Add Dependabot or Renovate with:

- weekly patch/minor updates;
- majors separate;
- grouped families for Electron + builder + updater, Vite + plugin + Vitest, and React + ReactDOM;
- Electron-family changes must retain the packaged-runtime gate and must not auto-merge solely on unit-test success.
