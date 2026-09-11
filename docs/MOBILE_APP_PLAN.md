# MockMate mobile — product and delivery plan

## Product position

The mobile app is the everyday preparation and second-device surface for MockMate. It is not a
smaller desktop overlay and it does not promise capabilities the operating system cannot support.

Core loop:

1. **Prepare** a job goal from company, role, objective, resume/JD and preferences.
2. **Practice** with short voice, behavioral, coding-explanation and system-design drills.
3. **Companion** pairs with desktop for visible transcript, answers and safe remote controls.
4. **Review** converts sessions into evidence-backed weak areas and the next drill.

## Reference-screen findings

Five competitor screenshots supplied on 2026-09-11 were reviewed as product research. Patterns
worth adopting in MockMate's own design language:

- A persistent four-item bottom navigation.
- Live, Mock and Coding as clear session intents.
- Company, role and objective visible before advanced settings.
- History cards that show mode, role/company and date at a glance.
- Duo pairing through both a shareable link and short code.
- Account identity and plan usage in one compact destination.

Patterns to improve rather than copy:

- Require a meaningful session title instead of producing repeated “Untitled session” history.
- Keep advanced setup progressive, but show a concise preflight summary before starting.
- Separate screen-view consent from remote-control consent.
- Never expose internal user IDs as a primary pairing experience.
- Present real caps/usage; do not label access “Unlimited” unless the enforced backend entitlement is
  genuinely unlimited.
- Keep custom instructions structured and validate them rather than relying on one huge prompt.

The screenshots are research inputs only and are intentionally not committed because they contain
third-party visual assets and personal account information.

## Initial information architecture

| Destination | V0 foundation | M1 |
|---|---|---|
| Prepare | Live/Mock/Coding setup | Resume/JD, audio permission, session preflight |
| History | Synced session cards and empty/error states | Reports, weakness tags, replay |
| Duo | Link/code shell and native sharing | QR pairing, notifications, transcript and controls |
| Account | Identity, plan, usage and sign-out | Billing, privacy, export/delete and devices |

## Technical direction

- Expo SDK 57 / React Native with TypeScript.
- Hosted HTTPS API only; `EXPO_PUBLIC_API_BASE` must fail closed when absent in non-demo flows.
- Tokens stored in `expo-secure-store`; never AsyncStorage or source-controlled configuration.
- The backend remains authoritative for plan limits, usage and cross-device history.
- Mobile-specific audio/capture code stays behind capability interfaces so iOS and Android behavior
  can diverge safely.
- Shared domain fixtures must prove mobile and desktop use the same question/answer contracts before
  the audio pipeline is enabled.

## Definition of the first usable build

- Starts on iOS and Android development clients.
- A user can sign up/sign in against staging, see account usage, create a session goal, see synced
  history, share a Duo invitation and sign out.
- Network and authentication failures are actionable and never masquerade as wrong credentials.
- No audio, screen-capture or remote-control capability is advertised before it exists and passes a
  physical-device test.
