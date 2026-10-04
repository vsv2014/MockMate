# MockMate v1.5 mobile beta

## What this branch can do

- Run one Expo/React Native client on iOS and Android.
- Sign up and sign in against the hosted MockMate API with the token in OS-protected storage.
- Create job-specific Live, Mock and Coding attempts for any company and role.
- Save a reusable Interview Playbook and snapshot it with the selected answer depth per attempt.
- Add hosted text sources, classify them as résumé/JD/knowledge/supporting, explicitly select the relevant sources and retrieve question-relevant excerpts for generated questions and answers.
- Run text-input Mock and Answer Assist sessions and sync bounded transcripts.
- Record microphone audio with explicit consent and a persistent recording indicator, then upload it through the authenticated `/transcribe` endpoint for managed Deepgram transcription.
- View shared history, account plan/usage and the consent-first Duo shell.

## Local validation

```bash
npm run mobile:verify
cd mobile
EXPO_OFFLINE=1 npx expo export --platform ios --output-dir dist-ios
EXPO_OFFLINE=1 npx expo export --platform android --output-dir dist-android
```

Set `EXPO_PUBLIC_API_BASE` to a real HTTPS backend. Hosted documents and sessions require MongoDB; the public backend must also set `MOCKMATE_HOSTED=1`, a stable `JWT_SECRET`, provider credentials, and an explicit production CORS allowlist.

## Private distribution

`mobile/eas.json` contains development, internal preview and production profiles. Before the first EAS build, the owner must supply the Expo account/project binding and configure `EXPO_PUBLIC_API_BASE` for the selected profile. Use `eas build --profile preview --platform all` for internal builds after Apple/Google signing access is available.

## Not yet a store-ready claim

- Microphone recording/transcription is implemented, but voice remains private-beta until physical-device interruption/background/network-loss testing is complete.
- Hosted PDF/DOCX picking/extraction is not yet a production-ready mobile claim; text-backed hosted sources are the verified grounding path today.
- Duo pairing is still a consent-model shell, not a working remote companion.
- Production billing configuration, token-expiry/account-deletion recovery, privacy labels, and physical-device tests remain release gates.
- iOS/Android do not promise desktop Stealth or universal same-device meeting-audio capture.
