# Release notes — v1.4.8

MockMate 1.4.8 focuses on the Live interview failures observed after 1.4.7.

## Highlights

- More reliable microphone intent: longer semantic stabilization, incomplete-question blocking,
  overlap merging, and conservative cleanup of common transcription artifacts.
- Interviewer corrections such as “wait”, “I’ll repeat”, and “that answer is wrong” cancel stale
  work. Format follow-ups such as “write it as code” update the active question.
- Faster failure behavior: a slow provider cannot leave the overlay on Thinking indefinitely;
  questions now expose failed/superseded states and Retry.
- Better answer grounding: first-person claims must come from the resume, while the JD controls
  role fit and preferred tooling. Explicit code, language, and brevity requests are honored.
- Live setup now uses the same draggable, resizable, collapsible overlay shell as Live mode.
- Coding screenshot language tabs perform a strict code transformation into the selected language.
- Coding requests can begin mid-interview without inheriting the previous topic; runnable code is shown in an expanded syntax-highlighted block with Copy.
- Disabling Stealth requires an in-window danger confirmation; every protection change reports its resulting state.
- Coding screenshots now seed a session-scoped coding workspace. A later language/optimization/debug follow-up can reuse that problem even after an unrelated capture, without attaching code to behavioral answers.
- Live preflight now separates “OS capture protection applied” from “verified in this meeting preview”; both must pass before starting on supported desktop platforms.
- Privacy-safe session diagnostics now record final-transcript confidence, degraded-mode usage, diarization-lock coverage, question commit latency, and answer first-token latency without storing transcript text.
- Deepgram Nova-3, keyterm prompting, VAD endpointing, and supported OS voice-isolation controls improve global-English accents, noisy audio, terminology, and turn boundaries; Nova-2 remains a fallback.
- JavaScript answers have an optional isolated Run control with blocked network/DOM/storage access and a hard timeout. Other languages are never falsely marked as executed.
- Meeting detection now identifies Zoom, Meet, Teams, Webex, or Whereby and binds preview confirmation to the selected share mode.
- A compact local quality dashboard surfaces recent STT confidence and latency trends without storing interview content.
- Live and Solo now show a compact model picker: Automatic (recommended) plus up to three useful models for each configured provider, rather than the provider's entire raw catalog. Stale model selections are reset, active providers are named, and obsolete saved keys can be removed in Settings.
- Readiness and failover indicators now use distinct, currently reported provider keys—not internal aliases or the selected Managed mode. Cerebras is configurable/discoverable, and a disconnected saved capture display resets to Primary.
- Automatic model selection now clears persisted stale IDs across Live, Solo, and Duo. Capture displays refresh on monitor hot-plug, Anthropic/Cerebras are included in desktop key detection, and Advanced overrides can be explicitly cleared instead of remaining invisibly merge-only.

## Verification status

- Unit tests and production web build: verified.
- Packaged Windows system-audio and meeting share-preview soak: still required before release.

Always verify content protection in the meeting application's share preview before a real call.
