# MockMate mobile — product and delivery plan

## Product position

The mobile app is the preparation, practice and second-device surface for MockMate. It is not a smaller desktop overlay and it does not promise desktop-style Stealth or universal same-device meeting-audio capture.

## Current v1.5.2 private-beta state

Implemented:

- Expo/React Native client for iOS and Android.
- Hosted signup/login with OS-protected token storage.
- Prepare / History / Duo / Account navigation.
- Company/role/objective and Interview Playbook setup.
- Hosted text-document selection and question-relevant grounding.
- Text mock / Answer Assist flows with synced transcripts.
- Microphone recording with explicit consent/recording state.
- Authenticated upload transcription through `/transcribe`, including language selection and typed-input fallback handling.
- Shared session/history/account/usage contracts with the backend.

Still gated / incomplete:

- PDF/DOCX extraction on mobile; current hosted document flow is text-first.
- Real Duo pairing/remote companion controls.
- Physical-device certification across iPhone and materially different Android devices.
- App Store / Play Store distribution, privacy-label review and interruption/background soak.
- Same-device meeting capture guarantees.

## Technical direction

- Expo SDK 57 / React Native with TypeScript.
- Hosted HTTPS API only for beta/production; `EXPO_PUBLIC_API_BASE` fails closed when invalid.
- Tokens stay in `expo-secure-store`.
- Backend remains authoritative for auth, plans, quotas, sessions and hosted documents.
- Mobile voice uses the authenticated `/transcribe` route. Server-side duration probing and atomic STT reservation prevent provider spend from exceeding the plan cap.
- Platform-specific audio behavior stays isolated behind mobile capability boundaries.

## Next milestones

1. Ten-minute voice mock and interruption/recovery soak on real devices.
2. PDF/DOCX picking + secure server-side extraction.
3. Real desktop↔mobile pairing with explicit consent and revocable controls.
4. Offline-safe cached profile/history with visible sync state.
5. Push reminders and drill scheduling.
6. Store-readiness validation: account deletion, token expiry, billing entitlements, privacy labels and physical-device coverage.

See `docs/MOBILE_BETA.md` for the exact shipped/private-beta boundary and `docs/ROADMAP.md` for sequencing.
