# Release notes — v1.4.7

See also [`CHANGELOG.md`](../CHANGELOG.md) and [`ROADMAP.md`](ROADMAP.md).

## Highlights

- New screenshots answer the visible screen question without inheriting the previous spoken/OCR question.
- Starting or ending Live clears screenshot, speech, in-flight analysis, and cache context from the previous interview.
- Newest-question navigation follows automatically only when the user is already at the latest answer; otherwise it offers **Jump to latest**.
- Local account-service failure no longer blocks guest/BYOK use.
- Advanced settings now expose optional Groq and custom OpenAI-compatible vision configuration.
- Live question and answer cards now support text selection and reliable one-tap copying in Electron.
- Stealth is now an explicit ON-by-default shield toggle controlling capture protection. Turn it OFF only to test/demo capture; transparency, pinning, click-through, collapse, and the protected hints window remain independent controls.

## Authentication scope

This release hardens device-local authentication and its failure handling. Cross-device/centralized
accounts still require the planned hosted production backend and are not claimed as complete here.

## Validation

- Unit tests: **261 passed**.
- Production Vite build: **passed**.
- Packaged Windows/macOS smoke testing should still be completed before marking the release verified.
