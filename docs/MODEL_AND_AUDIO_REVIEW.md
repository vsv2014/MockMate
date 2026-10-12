# Model routing and Live audio review

## Implemented

- Provider defaults, environment override precedence, model priorities, embedding defaults and compact-picker scores live in `shared/modelRegistry.js`. `shared/currentModels.js` applies lifecycle and capability policy. ARCH continues to select operation lanes; `api/_lib/core.js` owns execution and recovery.
- Live discovery can admit newer compatible chat generations without adding them to the compact picker. Provider-published deprecation and retirement flags still exclude them. Unfamiliar endpoints require compatible family/capability evidence; they are not assumed to support vision.
- AI failures expose safe authentication, access, unavailable-model, request-format, quota, rate and network categories. Ready Room displays the error code and distinguishes its own timeout.
- Ready Room tests the selected microphone or desktop playback source using the same capture path as Live, then carries that source into Live setup. Device changes invalidate voice readiness. A transcript proves capture reached STT; it does not prove the absence of meeting echo or local monitoring.
- Microphone mode requires explicit Answer this. Inferred speaker identity cannot authorize automatic question generation, revision or refinement. System playback retains automatic questions.
- Deepgram uses supported streaming `diarize_model=v1`; managed gateway validation rejects conflicting, duplicate and batch-only values.

## Verification and remaining device checks

Automated tests use mocked providers; no user keys were available for a real AI request. Build and platform dependency checks are local checks, not a signed installer or desktop validation.

On Windows/macOS with the target headphones/output device: run the System Audio preflight while playing speech, speak while playback is paused to detect monitoring/echo, and verify Live receives the same remote audio. In microphone mode, confirm no answer request starts until Answer this. Repeat after switching output devices.

The installed desktop version and the original failed AI request cannot be verified remotely from the screenshots. These changes need a packaged update and a repeat of the real provider/device tests before claiming those issues resolved on the user's computer.

## Collapsed badge and key onboarding

The main window previously kept a dashboard minimum size while requesting 72×72 for the badge. `electron/window-mode.cjs` applies mode-specific minimum sizes before bounds, disables native resizing/shadows for the badge, and reasserts a transparent native background on Windows/macOS. Renderer window-mode synchronization runs before paint; document/root backgrounds remain transparent. Linux retains its opaque-window policy.

Native resizing is never enabled on Windows. The transparent main window is created with `resizable: false`, and `prepareWindowMode` keeps it non-resizable across collapse and expand; macOS and Linux keep native resizing outside the badge. On every platform, the custom edge handles resize through the bounded `window-resize` IPC handler. Electron documents that transparent windows are not resizable and that setting `resizable` to `true` may stop a transparent window working on some platforms ([Custom Window Styles: Limitations](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations)). [Electron #51175](https://releases.electronjs.org/pr/51175) fixed one Windows case, transparency lost after `setResizable(false)` followed by `setResizable(true)`, and was backported to Electron 41.3.0 and 42, so the bundled Electron 44.5.1 includes it. Never enabling native resizing on Windows avoids the documented limitation instead of relying on that fix. Physical Windows collapse/drag/expand/resize rendering is still unverified; see `docs/RELEASE_CHECKLIST.md` §4b.

Official key-management links now live in the shared registry. Onboarding explains that keys are provider-scoped and that only one AI provider is required: it suggests starting with Gemini (answers and screenshots), offers Groq, OpenAI, Anthropic and Cerebras as optional alternatives or backups, keeps Deepgram separate for voice, and links to the current Claude Console. Settings reports a detected key separately from model availability (`Key detected · not tested`, `test passed` or `test failed`) and reads BYOK key status from the local service even when Managed mode is selected. Model access still requires a successful real connection test; no link or key-generation step promises account quota/model availability.

In BYOK mode the AI section of Settings now has three parts instead of one field per provider:

- **Which model answers:** the models automatic routing uses right now for quick answers and for coding/system design, reported by `/api/providers` (`routing`, from `pickFastProvider`/`pickStrongProvider`; model names only, never key material).
- **Saved AI keys:** one row per saved provider, with its routing role, status, **Test**, **Replace** and **Remove**.
- **Add API key:** one box. `src/lib/keyDetect.js` suggests a provider from the key format on the device; the key is never sent anywhere to identify it. The user confirms or chooses the provider before saving. Unrecognised formats need a manual choice, a confident mismatch needs explicit confirmation, and OpenRouter, Anthropic Admin and OpenAI Admin keys are refused with an explanation. Ambiguous shapes (plain `sk-`, 40 hex characters for Deepgram) are labelled as possible matches only.

Keys are still merged into the same encrypted local store under the same names, so keys saved before this change keep working. The Gemini free-tier privacy note appears beside Gemini.

## Dashboard sizing and Settings scrolling

Dashboard pages now have the same full-perimeter resize affordance as Live, a native draggable top bar with clickable controls excluded from drag, and a read-only native-size bridge so page zoom does not change the starting resize dimensions. Gestures end on pointer-up, cancellation, blur, or unmount. Sidebar and page content can scroll independently, the content is keyboard-focusable, narrow windows collapse navigation to icons, and provider cards fit the available width. API key Save actions stick to the bottom of the key form's scroll viewport.

Headless Chromium download was unavailable in this environment, and Electron GUI rendering requires a display connection. Native-window appearance and scroll behavior therefore still require Windows/macOS device confirmation; the build and regression checks do not substitute for that visual check.

## Live hint context and output budgets

Streamed (`/api/hint-stream`, `streamHint`) and blocking (`/api/hint`, `generateHint`) hints build the same user message with `buildHintUserContext` and take their output caps from `hintAnswerStyle` (`api/_lib/interview.js`).

- **Current question:** sent complete. It was previously clipped at 800 characters.
- **History:** Live requests `getLlmHistory({ limit: 12, includeLastAnswer: true })`, which returns the last 12 speech turns followed by the previous AI suggestion and its question. The suggestion is included only when requested and only if that answer completed. It is labelled `AI SUGGESTION (not evidence of what the candidate said)`, so it is never presented as candidate speech. Previously the option was ignored and the server kept only the last 8 turns, clipped to 300 characters each.
- **History budget:** the server keeps at most the last 13 entries and checks them newest-first against a 24,000-character budget. An entry that does not fit the remaining budget is skipped whole, never truncated, and smaller older entries can still be kept. One very long turn, even the newest, can therefore leave a gap instead of clipped code.
- **Output caps (tokens), identical for both transports:**

| Request | Balanced | Concise | Detailed |
|---|---|---|---|
| Simple question (fast tier), answer mode | 700 | 380 | 1,100 |
| Coding/system design (strong tier), and every coach-mode request | 2,400 | 1,800 | 2,400 |

### Answer timing

- **Microphone source:** never answers automatically. Each question waits for **Answer this**, because one microphone also hears the candidate.
- **System audio:** Deepgram ends a segment after 300 ms of silence (`endpointing=300`). Question capture then waits before committing: 0.7 s when the text ends in “?”, 0.9 s for a clear question, 1.1 s when it is probably complete, and 1.4 s when it sounds unfinished, with a 4.5 s cap.
- **Early answer start** (`src/live/speculativeHint.js`) hides that wait. When capture reports a complete question that is only waiting for silence (`onStabilizing`), Live prepares the exact request it would send after commit and starts it without showing anything. That request uses the same planning, history including the pending question, and shared document retrieval.
  - On commit, the request is used only if its question and serialized body are identical; otherwise it is aborted and a normal request is sent.
  - New speech, a revision or refinement, a rejected candidate, session end, or an 8-second expiry also abort it. Aborting closes the connection, so the server stops the provider request without failover or provider cooldown.
  - It runs only for system audio in BYOK mode, so it never spends managed quota. Setting `localStorage['mm-live-early-answer']` to `'0'` turns it off.
- **Stream deadlines:** the 11-second per-provider budget (`LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS`) now covers only the wait for the first answer text, so failover can still run. After that, only a stall ends an answer: 8 s without new text on the server (`LIVE_STREAM_STALL_TIMEOUT_MS`) and 12 s in the browser (`LIVE_HINT_STALL_TIMEOUT_MS`). The browser's fixed 40-second limit applies only before the first token. Previously, any answer still streaming 11 s after its request started was cut off, reported as a provider outage, and its provider was cooled down.
- **Claude thinking:** Claude 5-generation models think by default. Over the OpenAI-compatible endpoint that thinking is never shown, counts toward `max_tokens`, is billed as output, and `reasoning_effort` is ignored. Live therefore sends the lowest setting each model accepts (`claudeLowLatencyThinking`):
  - Sonnet 5.5: `thinking: {type: 'between_tools'}`. This turns off up-front thinking; without tools the response is text only.
  - Sonnet 5, Opus 5, Haiku 5.5 and the 4.x models: `{type: 'disabled'}`.
  - Fable, Mythos and Opus 5.5 cannot turn thinking off, and Live does not route to them.
  - If Anthropic rejects the setting, the request is retried once without it.
- **Remaining factor:** the model still writes a one-line META header (type, pattern, complexity, a short tip) before the visible answer.

Compared with the previous streaming caps, strong-tier and coach-mode requests rose from 900/650/1,100; simple answer-mode caps are unchanged. Blocking requests previously used 700 (simple) or 900 (strong/coach) regardless of the concise setting, and 1,100 for detailed. They now follow the table: blocking concise simple answers drop from 700 to 380 tokens inside the JSON envelope, while strong-tier and coach-mode blocking caps rise to 1,800–2,400. The concise directive limits simple answers to the direct answer plus at most two sentences, but requires complete code or architecture and the essential trade-offs for coding/design. Definition answers start with what the term means, then give a concrete example.

## Personal BYOK recommendation and cost estimate

Checked 2026-10-13 for one occasional personal user. This is a recommendation and an estimate, not a bill or spending authorization; it does not change the provider registry or enable billing.

**Recommendation.** Keep direct BYOK with the user's own Gemini and Deepgram keys. Do not add managed hosting or require any other paid account; other AI providers stay optional. Use a billing-enabled (paid-tier) Gemini project, because MockMate sends the resume, job description and interview transcript with each request. Google uses free-tier content to improve its products and does not use paid-tier content that way, but it still logs paid-tier prompts and responses for a limited period for abuse monitoring, so the paid tier is not zero data retention. Screenshot solving must keep a vision-capable route; Gemini provides one. New Deepgram pay-as-you-go accounts start with a $200 credit and need no card, which covers the usage below many times over.

Changing providers does not show that the reported answer regressions are fixed. That needs the context and budget changes above, measured with the replay and benchmark in `docs/RELEASE_CHECKLIST.md` §4b. Extend the existing fallback and diagnostics rather than duplicating them.

**Routing that drives cost.** Live always uses the balanced strategy. With only a Gemini key, simple questions go to Gemini 3.5 Flash-Lite and coding/system-design (strong-tier) requests go to Gemini 3.8 Flash. Adding an Anthropic key sends every strong-tier request to Claude Sonnet 5.5 automatically, not only on failure: `pickStrongProvider` prefers OpenAI, then Anthropic, then Gemini. With only an Anthropic key, quick answers go to Claude Haiku 5.5 and coding/design to Claude Sonnet 5.5. If a key cannot reach the 5.5 models, Live falls back to Claude Haiku 4.5 and Sonnet 5, which are still active.

**Assumptions.** Four 90-minute Live sessions: 360 audio minutes on one Deepgram stream, because Live listens to either system audio or the microphone, not both. Each session has 40 answer requests at ≈4,300 input tokens (measured below) and 300 output tokens, plus three screenshot or other extra calls at an assumed 1,000 input tokens each. Adding 10% headroom gives 770,000 input and 52,800 output tokens in total. Gemini thinking is disabled (`reasoning_effort: 'none'`), so output is the visible answer. Coding/design answers may use up to 2,400 output tokens, so coding-heavy sessions cost more.

Measured input per request (system prompt plus user message) used a synthetic ≈4,000-character resume, ≈2,500-character job description and ≈1,200-character candidate turns. Counts use OpenAI's o200k tokenizer as a proxy; Gemini's tokenizer differs, so treat them as approximate.

| Case | Input tokens |
|---|---|
| System prompt alone | 1,280–1,550 |
| First question (resume + JD, no history) | ≈2,100 |
| Mid-session (12 turns + previous prose suggestion) | ≈4,300 |
| Coding follow-up (12 turns + previous code suggestion) | ≈5,600 |
| Full 24,000-character history | ≈6,700 |

Retrieved documents, web results and screen context add to these figures.

| Item (four 90-minute sessions) | Promotional rates (today) | Regular rates |
|---|---|---|
| LLM, every request priced at Gemini 3.8 Flash (upper bound for Gemini-only routing) | $0.78 | $1.55 |
| STT: Nova-3 streaming + diarization + keyterm prompting | $2.92 | $3.96 |
| **Total, before taxes and fees** | **≈ $3.69** | **≈ $5.51** |

Rates used:

- Gemini 3.8 Flash, paid tier: $0.75 input and $3.75 output per million tokens through 2026-12-31, then $1.50 and $7.50 from 2027-01-01. Output pricing includes thinking tokens.
- Gemini 3.5 Flash-Lite, paid tier: $0.30 input and $2.50 output per million tokens, not promotional.
- Deepgram Nova-3 Monolingual streaming, pay-as-you-go: $0.0048/min limited-time promotional rate, $0.0077/min regular. The pricing page gives no end date for the promotion.
- Live always requests streaming diarization (+$0.0020/min). On the normal Nova-3 path it also sends up to 40 keyterms from the target role and resume (keyterm prompting, +$0.0013/min when keyterms are present); the degraded Nova-2 fallback sends none. Both are part of the base cost, not optional extras.
- Claude Sonnet 5.5: $2 input and $10 output per million tokens, the same as Sonnet 5.
- Claude Haiku 5.5: $0.10 input and $0.50 output per million tokens for prompts up to 100,000 tokens.

Sensitivities:

- Gemini-only routing sends simple questions to Flash-Lite, so the LLM line above is an upper bound. If 30% of requests are strong-tier, it is ≈ $0.49 at today's rates and ≈ $0.72 from 2027.
- With an Anthropic key and the same 30% strong-tier share, those requests move to Claude Sonnet 5.5 and the LLM line becomes ≈ $0.87: about $0.39 more than Gemini-only routing today, or $0.16 more from 2027. Token counts are not portable between providers; Anthropic notes that its 4.7-and-later models produce about 30% more tokens for the same text than its previous tokenizer, which would put this case near $1.06.
- With only an Anthropic key and the same split, quick answers use Claude Haiku 5.5 and the LLM line is ≈ $0.69, or ≈ $0.90 allowing for the larger Claude token counts.
- The early answer start occasionally discards a request when the interviewer keeps talking. Each discard costs roughly that request's input, about $0.003 on Gemini 3.8 Flash today or $0.009 on Claude Sonnet 5.5. At one discard in five questions this adds about $0.10–$0.30 over the four sessions.
- Longer answers, retries, extra add-ons or a second simultaneous audio stream raise these totals. INR exchange rates and tax treatment are not verified here.
- The in-app session cost gauge (`src/cost.js`) is approximate and not a billing source. It prices Claude Sonnet 5.5 and Haiku 5.5 at list price and keeps the older Sonnet 5 at a conservative $3/$15. It prices Gemini 3.8 Flash at the promotional $0.75/$3.75, so it will understate Gemini 3.8 Flash cost from 2027-01-01 unless updated.
- Replace the assumptions with measured `inputTokens`/`outputTokens` from diagnostics after the §4b replay, and recalculate when either promotion ends.

Sources, checked 2026-10-13:

- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing): Gemini 3.8 Flash promotional and 2027 rates, Gemini 3.5 Flash-Lite rates, and free- versus paid-tier product-improvement use.
- [Gemini API zero data retention](https://ai.google.dev/gemini-api/docs/zdr): paid-tier training restriction and abuse-monitoring logging.
- [Deepgram pricing](https://deepgram.com/pricing): Nova-3 streaming promotional and regular rates, diarization and keyterm add-ons, and the $200 starting credit.
- [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing): Claude Sonnet 5.5, Sonnet 5 and Haiku 5.5 rates and the tokenizer note.
- [Claude models overview](https://platform.claude.com/docs/en/models/overview) and [model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations): the current Claude generation and API IDs, and confirmation that Sonnet 5 and Haiku 4.5 remain active.
- [Claude thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) and [OpenAI SDK compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk): per-model thinking defaults, how to turn thinking off, and the fact that the compatibility endpoint neither returns thinking nor honours `reasoning_effort`.
