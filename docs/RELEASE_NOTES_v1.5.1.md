# MockMate v1.5.1 Release Notes (2026-10-03)

## 1. Windows Multi-Monitor, 760×240 Teleprompter HUD & Bounded `F7` Capture

- **Multi-Monitor Display Preservation (`electron/main.cjs`):** Switching between `'overlay'`, `'teleprompter'`, `'pill'`, and `'app'` now resolves the active monitor via `screen.getDisplayMatching(mainWindow.getBounds())` and preserves user-resized overlay dimensions (`lastOverlaySize`).
- **Top-Center Camera-Anchored Teleprompter (`Alt+T` / `⌖ Cam`):** Docks the Live HUD at top-center (`760×240`, clamped to `area.width - 40`) directly beneath the webcam with larger teleprompter typography (`15.5px` opener, `14px` key-point bullets, and a compact single-line `Q:` header).
- **Hands-Free Overlay Shortcuts (`Alt+T`, `Alt+Up`, `Alt+Down`, `Alt+R`, `F7`):** Scoped strictly to active `'overlay'` and `'teleprompter'` window modes, with `lastWindowMode` preserved across manual drag/resize and pill expand. `Alt+R` triggers an immediate answer for the active question candidate (`resolveAnswerNowCandidate`).
- **Bounded Windows `F7` Screen Capture:** Captures at `1440×810 @ JPEG Q76` with an automatic `210 KB` byte-budget step-down (`1280×720 @ Q70`) so LeetCode/SQL text stays crisp while vision upload latency remains bounded.
- **Public Build Safety Gate Preserved (`src/live/liveGate.js`):** Production desktop builds strictly enforce Electron + OS capture-protection (`protectionTest === 'passed'`) + `shareVerified` (or `linuxAck`); local dev bypass is restricted to `import.meta.env.DEV` on `localhost`/`127.0.0.1`.

## 2. Turn-1 System Audio & `{ Artemis }` Hybrid RAG Pipeline

- **Turn-1 System Audio Question Classification (`shared/questionCapture.js`, `src/useSystemAudio.js`):** Adds a `+25` confidence boost on Turn 1 when `source === 'system'` and flushes trailing Deepgram audio via `Finalize` on speech pause.
- **Layout-Aware PDF Extraction (`src/pdf.js`):** Reconstructs lines and tables using `transform[4]`/`transform[5]` coordinates and font-height ratios (`reconstructPageText`) so multi-column resumes and technical PDFs retain headings and bullets.
- **Header-Inherited Semantic Chunking & Diversity Re-Ranking (`shared/retrieval.js`):** Prefixes chunks with `[Section: ...]`, extracts metric/entity signals, and applies diversity-aware hybrid vector + lexical retrieval (`topK`, `lexicalTopK`).
- **`embeddingModel`-Bound Persistent Vector Cache (`api/_lib/core.js`, `api/_lib/apiRoutes.js`, `api/embed.js`, `src/lib/docs.js`):** Persists `embeddingModel` (`provider:model`) alongside `sig` and `dimensions` in `mm-docs-index-v1` and invalidates/re-embeds automatically if the embedding provider or model changes—even when vector dimensions match.
- **Debounced Speculative RAG Pre-Warm (`src/LiveCompanion.jsx`, `src/lib/docs.js`):** Pre-warms RAG during question stabilization (`320ms` debounce, `AbortController` cancellation, and `canReuseSpeculativeRag` token-overlap reuse).
- **Prompt Priority, Spoken Guardrail & Context Audit Trail (`api/_lib/interview.js`, `shared/hintLayers.js`):** Elevates `<retrieved_documents>` alongside `<candidate_resume>`, strips markdown formatting from spoken layers (`stripSpokenFormatting`), and renders source attribution pills (`✓ RESUME`, `📄 Doc · §Section`, `🖥 SCREEN`, `🌐 WEB`).

## 3. UI/UX Overhaul, `CustomPromptStudio` & Brand Icon

- **3-Tier Typography & WCAG AA Contrast (`src/auth/tokens.js`, `src/styles.css`):** Pairs `Kanit` (`T.fontDisplay`) for headings with `Inter` / `Segoe UI Variable Text` (`T.font`) for body/teleprompter reading and `Cascadia Code` / `JetBrains Mono` (`T.fontMono`, `tabular-nums`) for code/timers. Lifts `T.text3` contrast to `#8690A2`, harmonizes slate-teal answer cards (`T.answerBg`), and enforces keyboard `:focus-visible` rings across all inputs.
- **Zero-Nested-Scroll `F7` Coding View Switcher (`src/App.jsx`):** Adds `[All | Code | Steps]` tabs to `ScreenAnalysisPanel` that reset to `All` on each new capture.
- **`CustomPromptStudio` (`src/components/CustomPromptStudio.jsx`):** Adds 5 one-click role playbooks (`SWE / Coding`, `System Design`, `AI / LLM / RAG`, `Data / SQL`, `Behavioral STAR`), 6 modular `+ Add block` chips, account-scoped saved playbook presets (`mm-saved-playbooks-v1`), and a live `Compiled (always · auto-routed)` module inspector across Live and Solo setups.
- **Solo Selected Document Gate (`src/Solo.jsx`):** Validates `getSelectedDocIds().length > 0` via `onLibraryChange` so deselected library documents do not count as active context.
- **Supersampled 512×512 MockMate Icon (`public/icon.svg`, `public/icon.png`, `assets/icon.png`):** Upgrades the app, window, and tray icon to a 4×4-supersampled obsidian-teal squircle with the 5-bar acoustic-wave `M` monogram and live pulse dot.

## 4. Closed-Loop `ARCH · Product Intelligence`

- **Declarative `ABL` Funnels & Adaptive Policies (`arch/mockmate.abl.json`, `backend/src/abl.js`, `backend/src/arch.js`):** Compiles `live_interview`, `solo_practice`, and `screen_solve` funnels plus latency thresholds (`ttftFastLaneThresholdMs: 3200ms`) directly from `arch/mockmate.abl.json`.
- **Zero-PII Behavioral Synthesis (`shared/productIntelligence.js`, `src/lib/productIntelligence.js`, `src/components/ProductIntelligencePanel.jsx`):** Captures redacted flow steps, rage clicks, and sequence correlations (such as `overlay_resize → teleprompter_toggle` and preflight drop-off) while stripping resumes, transcripts, prompts, API keys, passwords, screenshots, and audio.
- **Closed-Loop Lane Promotion (`backend/src/arch.js`, `api/_lib/apiRoutes.js`):** `reasoningPolicy(op, { adaptive: true })` automatically promotes `'balanced'` operations to the `'fast'` lane when `p95` TTFT or turn latency breaches the `ABL` threshold.
