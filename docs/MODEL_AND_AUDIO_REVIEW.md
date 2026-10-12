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

Official key-management links now live in the shared registry. Onboarding explains that keys are provider-scoped, recommends Gemini + Deepgram with an optional Groq text fallback, and links to the current Claude Console. Model access still requires a successful real connection test; no link or key-generation step promises account quota/model availability.

## Dashboard sizing and Settings scrolling

Dashboard pages now have the same full-perimeter resize affordance as Live, a native draggable top bar with clickable controls excluded from drag, and a read-only native-size bridge so page zoom does not change the starting resize dimensions. Gestures end on pointer-up, cancellation, blur, or unmount. Sidebar and page content can scroll independently, the content is keyboard-focusable, narrow windows collapse navigation to icons, and provider cards fit the available width. API key Save actions stick to the bottom of the key form's scroll viewport.

Headless Chromium download was unavailable in this environment, and Electron GUI rendering requires a display connection. Native-window appearance and scroll behavior therefore still require Windows/macOS device confirmation; the build and regression checks do not substitute for that visual check.
