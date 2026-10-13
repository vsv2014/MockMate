# v1.6.6 debris cleanup execution

Scope: cleanup on top of PR #100, not a release. Version remains 1.6.6. No tags, signing, installer publication or auto-update feed changes.

## Sections and validation

| Section | Result | Full suite |
|---|---|---|
| 1 | Removed ScoreTrend, HomeTile and ScoreRing after identifier/export/registration checks | 108 files / 846 tests passed |
| 2 | Preserved code fences through META processing; made file-store usage-release persistence failures reject; logged transcription refund failures; removed unused DashboardHome | 109 / 852 passed |
| 3 | Consolidated public proxy guard, shared report fields and managed vision text; wired customer-success/support scenarios; changed Ready Room TODO to Pending; aligned hosted-cookie flags; removed unused billing client wrapper | 109 / 854 passed |
| 4 | Corrected comments, retired retracted audit-summary claim, named existing budgets, logged query failures, renamed token-cache test, removed inert lint directives, used limit alias, documented environment overrides; stopped overwriting stored Live strategy | 109 / 854 passed |
| Final | Added proxy opt-in tests and handled failed scoped-storage boolean results in custom playbook UI | 110 / 858 passed, zero failures |

The production Vite build and Linux unpacked electron-builder command completed successfully. git diff --check passed. This is not Windows validation or a signed build. Duplicate dependency-reference warnings were emitted by electron-builder. A first packaging attempt with dependency symlinks also emitted unresolved-path warnings; the dependency trees were installed locally and packaging repeated before the final result.

## Section 1

Deleted base-snapshot definitions: src/App.jsx:1328 (ScoreTrend), src/App.jsx:1712 (HomeTile), src/Dashboard.jsx:34 (ScoreRing). Each was local, not exported, and appeared only at its definition. Kept live component interfaces.

## Section 2

H1: shared/hintLayers.js:71 protects code before META processing; shared/hintLayers.js:184 protects unfinished streaming fences in prose sanitation. Regression cases include array literals, numeric indexing, SAY strings, prose placeholders, ordinary JSON code and metadata headers (shared/hintLayers.test.js). Before: `const a = ; console.log(a);`. After: original fenced `const a = [1, 2]; console.log(a[0]);` is preserved. Leading fenced interview metadata remains removable, while ordinary code is retained.

I1/I2: backend/src/store.js:125,145 now await durable release writes and reject failures. Existing Mongo implementation already propagates write errors. backend/src/store.release.test.js exercises disk rename failure and durable success. Callers: backend/src/middleware/meter.js:106 logs LLM release failures; api/_lib/apiRoutes.js:95 logs metering callback failures; backend/src/managedSttGateway.js:174 logs settlement failures and tracks them; backend/src/routes/transcribe.js:131 logs a rejected refund before its existing recovery catches. No silent refund failure is represented as success by the file store.

B1: removed DashboardHome (base src/Dashboard.jsx:305 after section 1). Exact identifier scan found no consumer or registry reference. Its remaining private helper subtree is recorded below, not silently deleted beyond the listed component.

## Section 3 decisions

- B2: removed unused reconcileBilling client export. Kept /billing/reconcile, which remains authenticated and is separate from portal/webhook reconciliation (backend/src/routes/billing.js:29,100,112,157). No new billing UI was introduced.
- B3/O1: Google OAuth wiring/removal deferred to the owner. No launch button or server removal.
- C1/M3: ARCH client-to-server product-event flow/removal deferred. No telemetry upload added.
- C2/P1: shared/interviewClassify.js:338 adds customer-success/support routing for renewal/churn/onboarding/escalation complaints. The old classifier did not actually classify CS roles as sales_roleplay; the sales branch was restricted to sales/business-development. The new rule is scoped to CS roles and relevant terms, with regression tests.
- C3: legacy aliases retained with a caller-compatibility comment at shared/interviewClassify.js:217. There is no user-machine historical storage here to establish that old supplied classifications can never occur.
- D1: api/_lib/publicProxyGuard.js:2 owns the deployment guard. Exact opt-in remains `1`; tests verify local, denied deployment and explicit opt-in behavior.
- D2: shared/reportSchema.js:2 owns common JSON fields; each task retains its distinct summary wording.
- D3: api/_lib/visionPolicy.js:7,8 owns managed failure messages; BYOK-specific messages remain distinct.
- D4: reconnect-hook unification deferred; functional lifecycle logic unchanged. The two hooks still share transport/deadline helpers.
- D5/F1: canonical palette decision deferred. Code inspection shows JavaScript T surfaces use #0B0D12 while CSS @theme uses #0a0a0e; no visual/device verification was performed.
- E1: src/journey/JourneyScreens.jsx pending pills now use Pending.
- F2: error-envelope unification deferred. Auth/static-page adapters expect string error; Live transport reads error/code/retryAfterMs; provider probes use ok:false/error and SSE has its own event envelope. Contract changes require adapter tests and server route coordination, not one global replacement.
- F3: backend/src/routes/auth.js:199 uses envFlag for hosted-cookie security.
- G3: expo-file-system retained. No direct import/plugin was found, but mobile dependency/build inspection was not available; no mobile package/lock changes.

## Section 4 decisions

- H2/H3: search comment now says 8s; Gemini comments describe reasoning behavior without pinning the explanation to 2.5.
- H5: historical DEBRIS_AUDIT.md marked superseded; retracted vision-failover claims removed from its summary. The historical file is retained.
- I3: backend/src/store.js:177 logs a query error name before returning null; API return shape unchanged. This is the requested minimal diagnostic option, not a discriminated query API.
- I4: CustomPromptStudio initially logged thrown storage failures. Final verification found setScopedItem returns false instead of throwing (src/lib/accountScope.js:97). Save/delete now detect false, log only an operation enum, return null and keep UI state with a failure notice (src/components/CustomPromptStudio.jsx:156,167,235,245). New test asserts the previously stored preset remains.
- J1/J2: history 24,000-character/13-entry and SDK 9,000ms budgets are named; values unchanged.
- J3: retrieval 2,000ms and prefetch 320ms are independently named, not coupled.
- J4: one-hour raw-key fallback value documented as cache refresh interval, not a grant expiry; the 300s grant path is unchanged.
- K3: stopped overwriting loaded Live modelStrategy. Stored strategy now reaches server validation/default behavior; no preference widget was added.
- L1: renamed token-cache test to deepgramTransport.tokenCache.test.js; existing deepgramTransport.test.js remains.
- L2: source-comment assertion explicitly marked intentional and not a native behavior test.
- M1: inert eslint-disable directives removed; no lint toolchain added.
- N1: rate limiter max→limit, same 120-request value.
- P2–P5: .env.example documents architecture-spec path, preview harness, reset-link base and Google server configuration. OAuth remains unwired as stated.

## Section 5 — later decisions (unchanged)

| Item | Owner decision / scope |
|---|---|
| Google OAuth | Keep server-only, add supported sign-in UI, or remove the feature |
| ARCH events | Keep local client store, add explicitly scoped server ingestion, or remove empty server subset |
| Palette | Canonical JS/CSS background; visual comparison required |
| Error envelopes | At least auth request adapter (src/auth/api.js:95), static auth (public/auth-web.js:50), Live HTTP/SSE adapter (src/live/hintTransport.js:30), STT token adapter (src/lib/deepgramTransport.js:207), and probe consumers; corresponding route/error tests. Multi-adapter compatibility work, not a mechanical alias edit |
| Deepgram lifecycle | Solo and Room use useDeepgram (src/Solo.jsx:3, src/Room.jsx:8); Live uses useSystemAudio (src/LiveCompanion.jsx:1708). Capture/PCM, reconnect/wake, candidate/interviewer roles and callback timing are involved. Current transport sharing remains; native audio tests are needed before unification |

User steering: raise the PR now; these decisions and additional work stay for later.

## Section 6 — Keep list

Kept preload/HTML/EAS/release entries, versioned bootstrap, account migrations, previous-model discovery fallbacks, development preview, optional chunk policy, best-effort telemetry/index startup, managed availability gate, thin wrappers and distinct spec/runtime modules. Naming lint directives were removed from audio hooks, but their functional lifecycle was not unified.

## New findings and release limits

1. Packaging command success is not dependency completeness. The final Linux app.asar contains none of multer, mammoth or pdf-parse under root/backend node_modules. package.json:57 excludes backend/node_modules; backend/src/routes/uploads.js:2–4 and transcribe.js:2 import those modules. backend/server.js:164–172 loads these routes **only in Mongo mode**, so this is a packaged managed-Mongo startup blocker, not proof local file/BYOK startup fails. Kept outside this cleanup scope; Windows artifact/runtime acceptance remains open.
2. Removal of DashboardHome leaves private helpers with no live consumer: greeting, Sparkline, ActionCard, Empty, SystemStatus and QuickAction in src/Dashboard.jsx. Some already belonged solely to the dead component. Reported for later cleanup rather than deleting unlisted subtrees.
3. Scoped storage failure was a false return, not a thrown exception; fixed during verification as described above.

No Claude API key test, embedding-provider change, missing-session persistence fix, or competitor-quality claim is included in this cleanup.

## Changeset size

Application/config/test delta versus e009beb before this report: 40 files, 252 lines added, 329 removed (including a test rename). This execution report is an additional documentation file. No version, release-request or tag changes.

## Exact changed-file line references

The following are candidate line ranges from zero-context git diff; deletion-only hunks also show base ranges. They cover every edited source/config/test region, including lint-only edits.

- `.env.example` @@ -89,0 +90,12 @@ DEEPGRAM_API_KEY=
- `DEBRIS_AUDIT.md` @@ -2,0 +3,2 @@
- `DEBRIS_AUDIT.md` @@ -728 +729,0 @@ The repo is better than average here (`shared/liveTiming.js` names the four core
- `DEBRIS_AUDIT.md` @@ -759 +759,0 @@ The repo is better than average here (`shared/liveTiming.js` names the four core
- `api/_handler.js` @@ -0,0 +1 @@
- `api/_handler.js` @@ -13,5 +14 @@ export function postHandler(fn, key) {
- `api/_lib/core.js` @@ -0,0 +1 @@
- `api/_lib/core.js` @@ -9 +10 @@ import { getRetryAfterMs, isRateLimit, isQuotaExhausted, isTransient } from '../
- `api/_lib/core.js` @@ -10,0 +12,2 @@ import {
- `api/_lib/core.js` @@ -626 +629 @@ const AI_ERRORS = {
- `api/_lib/core.js` @@ -634 +637 @@ const AI_ERRORS = {
- `api/_lib/core.js` @@ -797 +800 @@ export async function completeJSON({ messages, maxTokens = 1600, provider, think
- `api/_lib/core.js` @@ -802 +805 @@ export async function completeJSON({ messages, maxTokens = 1600, provider, think
- `api/_lib/core.js` @@ -1265 +1268 @@ export async function streamText({ messages, maxTokens = 700, provider, thinking
- `api/_lib/core.js` @@ -1365,0 +1369,2 @@ export async function deepgramToken(opts = {}) {
- `api/_lib/core.js` @@ -1477,4 +1482 @@ Return ONE JSON object, no prose, with this shape:
- `api/_lib/interview.js` @@ -0,0 +1,4 @@
- `api/_lib/interview.js` @@ -23 +27 @@ import { compileCustomInstructions } from '../../shared/customInstructions.js'
- `api/_lib/interview.js` @@ -54,2 +58,2 @@ export function buildHintUserContext({ question, packed = '', conversationHistor
- `api/_lib/interview.js` @@ -686,4 +690 @@ Return ONE JSON object, no prose:
- `api/_lib/publicProxyGuard.js` @@ -0,0 +1,6 @@
- `api/_lib/publicProxyGuard.test.js` @@ -0,0 +1,18 @@
- `api/_lib/visionPolicy.js` @@ -6,0 +7,3 @@ import { isRateLimit, isQuotaExhausted, isTransient } from '../../shared/llm-err
- `api/_lib/visionPolicy.js` @@ -100 +103 @@ export function makeVisionRateLimitedError(managed = false) {
- `api/_lib/visionPolicy.js` @@ -110 +113 @@ export function makeVisionUnavailableError(managed = false) {
- `api/deepgram-token.js` @@ -0,0 +1 @@
- `api/deepgram-token.js` @@ -7,5 +8 @@ export default async function handler(req, res) {
- `api/hint-stream.js` @@ -0,0 +1 @@
- `api/hint-stream.js` @@ -9,3 +10 @@ export default async function handler(req, res) {
- `api/providers.js` @@ -0,0 +1 @@
- `api/providers.js` @@ -3,10 +3,0 @@ import { availableProviders, allProviders, deepgramConfigured, searchConfigured,
- `api/token.js` @@ -0,0 +1 @@
- `api/token.js` @@ -8,5 +9 @@ export default async function handler(req, res) {
- `backend/src/routes/auth.js` @@ -0,0 +1 @@
- `backend/src/routes/auth.js` @@ -198 +199 @@ router.get('/google', (req, res) => {
- `backend/src/routes/transcribe.js` @@ -131 +131,5 @@ async function releaseLease(req, lease, seconds = lease?.seconds || 0) {
- `backend/src/store.js` @@ -125 +125 @@ function makeFileBackend() {
- `backend/src/store.js` @@ -145 +145 @@ function makeFileBackend() {
- `backend/src/store.js` @@ -177 +177 @@ async function makeMongoBackend() {
- `backend/src/store.release.test.js` @@ -0,0 +1,35 @@
- `electron/pill-window-geometry.test.js` @@ -12,0 +13,2 @@ describe('pill window geometry safety', () => {
- `server.js` @@ -79 +79 @@ app.use(express.json({ limit: '2mb' }))
- `shared/hintLayers.js` @@ -70,2 +70,16 @@ export function stripHintMeta(raw = '') {
- `shared/hintLayers.js` @@ -138,0 +153 @@ export function stripHintMeta(raw = '') {
- `shared/hintLayers.js` @@ -169 +184 @@ export function sanitizeSpokenProse(text = '') {
- `shared/hintLayers.test.js` @@ -106,0 +107,25 @@ describe('sanitizeSpokenProse (Artemis-style streaming output guardrail)', () =>
- `shared/interviewClassify.js` @@ -216,0 +217,2 @@ export function contextNeedsFor(questionType, { isFollowUp = false, parentType =
- `shared/interviewClassify.js` @@ -335,0 +338,4 @@ export function classifyTurn({
- `shared/interviewClassify.test.js` @@ -152,0 +153,13 @@ describe('long Live technical interview benchmark — short turns', () => {
- `shared/liveTiming.js` @@ -18,0 +19,3 @@ export const LIVE_HINT_STALL_TIMEOUT_MS = 12_000
- `shared/reportSchema.js` @@ -0,0 +1,5 @@
- `src/ApiKeys.jsx` @@ -166 +166 @@ export default function ApiKeysPanel({ onSaved, showStatus = false, onModeChange
- `src/App.jsx` @@ -354 +354 @@ function ElectronShell({ auth }) {
- `src/App.jsx` @@ -822 +822 @@ function ElectronShell({ auth }) {
- `src/App.jsx` @@ -1325,46 +1324,0 @@ export function IconBtn({ icon, title, onClick, active, danger }) {
- `src/App.jsx` @@ -1710,35 +1663,0 @@ export function OverlayPanel({ children, panelSize, stealth, minimized, onDrag,
- `src/Dashboard.jsx` @@ -33,22 +32,0 @@ function greeting() {
- `src/Dashboard.jsx` @@ -327,134 +304,0 @@ function TopBtn({ children, onClick, title, danger }) {
- `src/Jobs.jsx` @@ -274 +274 @@ export default function Jobs({ onHome, noProviders, onSettings, onOpenCareer, on
- `src/LiveCompanion.jsx` @@ -0,0 +1,3 @@
- `src/LiveCompanion.jsx` @@ -151,3 +154,3 @@ function SetupScreen({ onStart, onHome, recoveredLive, onRecoverLive, onDiscardL
- `src/LiveCompanion.jsx` @@ -241 +244 @@ function SetupScreen({ onStart, onHome, recoveredLive, onRecoverLive, onDiscardL
- `src/LiveCompanion.jsx` @@ -722 +725 @@ function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, pane
- `src/LiveCompanion.jsx` @@ -776 +779 @@ function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, pane
- `src/LiveCompanion.jsx` @@ -879 +882 @@ function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, pane
- `src/LiveCompanion.jsx` @@ -1238 +1241 @@ function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, pane
- `src/LiveCompanion.jsx` @@ -1312 +1315 @@ function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, pane
- `src/LiveCompanion.jsx` @@ -1656 +1659 @@ function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, pane
- `src/LiveCompanion.jsx` @@ -1702 +1705 @@ function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, pane
- `src/LiveCompanion.jsx` @@ -1776 +1779 @@ function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, pane
- `src/LiveCompanion.jsx` @@ -1828 +1831 @@ function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, pane
- `src/Room.jsx` @@ -168 +168 @@ function RoomInner({ session, onEnd }) {
- `src/Room.jsx` @@ -189 +189 @@ function RoomInner({ session, onEnd }) {
- `src/Room.jsx` @@ -257 +257 @@ function RoomInner({ session, onEnd }) {
- `src/Room.jsx` @@ -288 +288 @@ function RoomInner({ session, onEnd }) {
- `src/Solo.jsx` @@ -128 +128 @@ export default function Solo({ onHome, noProviders, initialProfile, kitId, kitNa
- `src/Solo.jsx` @@ -264 +264 @@ export default function Solo({ onHome, noProviders, initialProfile, kitId, kitNa
- `src/WhatsNew.jsx` @@ -64 +64 @@ export default function WhatsNew({ openSignal = 0 }) {
- `src/auth/api.js` @@ -170 +169,0 @@ export async function openBillingPortal() { const { url } = await request('/bill
- `src/components/CustomPromptStudio.jsx` @@ -0,0 +1 @@
- `src/components/CustomPromptStudio.jsx` @@ -155 +156,6 @@ export function savePlaybookSlot(name, prompt) {
- `src/components/CustomPromptStudio.jsx` @@ -161 +167,6 @@ export function deletePlaybookSlot(id) {
- `src/components/CustomPromptStudio.jsx` @@ -223,0 +235 @@ export default function CustomPromptStudio({ value = '', onChange, compact = fal
- `src/components/CustomPromptStudio.jsx` @@ -232,0 +245 @@ export default function CustomPromptStudio({ value = '', onChange, compact = fal
- `src/components/CustomPromptStudio.test.js` @@ -54,0 +55,11 @@ describe('CustomPromptStudio helpers & compiler integration', () => {
- `src/journey/JourneyScreens.jsx` @@ -864,4 +864,4 @@ export function ReadyRoom({
- `src/lib/docs.js` @@ -10,0 +11,2 @@ import { readScopedArrayWithRecovery } from './storageRecovery'
- `src/lib/docs.js` @@ -473 +475 @@ export function canReuseSpeculativeRag(specQuery = '', committedQuery = '') {
- `src/useDeepgram.js` @@ -219 +219 @@ export function useDeepgram(onFinal, onFail, lang = 'en-US') {
- `src/useSystemAudio.js` @@ -412 +412 @@ export function useSystemAudio(onFinal, onFail, onEarlyQuestion, onReconnect) {
