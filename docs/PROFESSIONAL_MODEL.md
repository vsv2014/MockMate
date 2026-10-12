# ARCH professional model (Professional State Graph)

**Status:** design. Graph code (Step 1) has not started; it is gated on Gate 0 and the privacy gate below.
**Basis:** the "ARCH: unified professional intelligence core" strategy draft (2026-10-13), checked against this repository.
**Last reviewed:** 2026-10-13, at v1.6.3.

## 1. Definition

ARCH's professional model is MockMate's shared, evidence-grounded model of the user as a professional. Résumé, jobs, Duo, preparation, interviews and follow-up are surfaces that read from and update it.

The loop:
1. Collect evidence.
2. Update the model.
3. Help in the current workflow.
4. Observe outcomes.
5. Propose the most useful next action.
6. Measure whether it helped.

"One model" means a **shared, queryable, versioned representation of professional evidence and goals**. It does not mean:
- one giant prompt or one opaque model
- indefinite storage of raw transcripts
- unrestricted access for every subsystem

## 2. Two layers share the ARCH name

| Layer | What it is | Code | Data |
|---|---|---|---|
| **ARCH runtime and product insights** (exists) | Engineering state. Covers lane routing and latency metrics, the transcription fallback executor, and usage insights. | `backend/src/arch.js`, `arch/mockmate.abl.json`, `/api/arch`, `shared/productIntelligence.js`, `src/lib/productIntelligence.js`, the Settings "Product insights" panel | Metadata only. Process-local metrics, plus a bounded usage ring buffer stored per account on the device. |
| **ARCH professional model** (planned, this document) | The user's professional evidence and goals. | Not started | Résumé, job and interview evidence, with provenance |

The two layers stay separate. Product-health events are not facts about the user and never gain access to the professional model.

The Settings panel was renamed from "ARCH · Product Intelligence" to **Product insights**. Its claims now describe only that panel's data, so "never stores résumés" cannot be read as a statement about the professional model. Internal module names still use `arch`/`productIntelligence`.

## 3. What exists today

### Data map (desktop, BYOK)

This is the input to the privacy gate in §10. "Per account" means account-scoped local storage, which `purgeScopedStorage` deletes on Delete Account.

| Data | Where | Scope | Leaves the device when | Retention and deletion |
|---|---|---|---|---|
| Profile and résumé (`peerMockProfile`): name, target role and company, job description, résumé text and one backup | Renderer local storage | Per account | Résumé and job-description excerpts go to the configured AI provider for Live, Solo and Duo answers, Career tailoring and job matching | Until edited; Delete Account |
| Documents / knowledge bank (`mm-docs`; vectors in `mm-docs-index-v1`, which also hold chunk text) | Local storage | Per account | Chunks go to the embedding provider when indexed. Retrieved chunks go to the AI provider with Live questions. | Until removed (removing a document deletes its vectors) |
| Saved jobs and career draft (`mm-saved-jobs`, `mm-career-draft`) | Local storage | Per account | Searches go to job-listing APIs; résumé and job text go to the AI provider for matching and tailoring | Until removed |
| Interview history (`mm-sessions`): Solo, Live and Duo sessions with transcript, report and settings | Local storage | Per account | Not uploaded in BYOK mode. The transcript was processed by Deepgram and the AI provider while the session ran. | Newest 60 kept; delete per session; Delete Account |
| Live checkpoint (`mm-live-checkpoint-v1`) | Local storage | Per account | No | Cleared after recovery or session end |
| Kits and playbooks (`mm-interview-kits`, `mm-saved-playbooks-v1`) | Local storage | Per account | Custom instructions are sent with Live and Solo prompts | Until edited |
| Duo recent rooms (`mm-duo-recent-v1`): room code, role, target role and company | Local storage | **Device-wide** | No | **Not removed by Delete Account (gap)** |
| Audio | Not stored | — | Streamed to Deepgram | Deepgram's retention policy |
| Screenshots (F7) | Memory only | — | The image goes to the configured vision provider | Not written to disk by MockMate |
| API keys | `userData/.env.enc`, encrypted with the OS keychain (safeStorage) where available | Device | Only to the matching provider | Remove in Settings |
| Diagnostics | `userData/logs/diagnostics.jsonl`, up to 4 × 5 MB | Device | Only if the user exports and shares a bundle | Rotation; Clear logs |
| Session metrics | `userData/session-metrics.jsonl`, rotated at 2 MB; rows that look like content are rejected | Device | No | Rotation |
| Product insights (`mm-product-intel-v2`, 600 events) | Local storage | Per account | No. Breadcrumbs reach the diagnostics log only when the user opts in. | Clear in the panel; Delete Account |

Managed (hosted) mode stores accounts, sessions, documents and billing in the hosted backend; see `DEPLOY_BACKEND.md`.

### Evidence logic that exists

- **`shared/skillsMatrix.js`:** a deterministic résumé-vs-job/role skills gap matrix used by Career and Jobs, with "Drill in Solo" links. Results are not persisted and have no source spans or versions.
- **`shared/resumeFacts.js`:** extractive résumé facts (years, seniority band, education, certifications) for job ranking.
  - `extractYearsTotal` returns the **larger** of the explicit "N years" figure and the employment date span. That silently picks a winner, which this design forbids (§5). It is the first conflict case Step 1 must represent.
- **`shared/delivery.js`:** filler, pace and length analysis of the candidate's own speech.
- **Prompts** instruct models never to fabricate experience. No stored claim checking exists.
- **No persisted cross-session competency or evidence store.** The earlier P5 roadmap item overstated this; P5 is now folded into the ARCH entry in `ROADMAP.md`.

## 4. Duo, mapped from the code

Duo (beta) is a two-person LiveKit room (`src/Duo.jsx`, `src/Room.jsx`, room tokens from `/api/token`; requires `LIVEKIT_*` configuration).

- **Roles:** the user joins as candidate or interviewer. The interviewer can send suggested questions.
- **Transcription:** each person's speech goes through Deepgram and is shared over the room's data channel.
- **Hints:** the candidate gets hints from `/api/hint`, built from the résumé, job description, last 8 turns and playbook. They appear in a capture-protected co-pilot window (Electron) or a picture-in-picture window.
- **Artifacts:**
  - profile fields saved from the setup form
  - the recent-rooms list
  - at session end, a history record (transcript, report, role and company) in `mm-sessions`
  - an optional Markdown export

There is no separate Duo data store.

**Interim handling:** Duo sessions are already interview records in history. Until a Duo adapter exists, the professional model may reference them only as generic source artifacts (original ID, type `duo_session`, timestamps). Their content does not become evidence for career claims.

## 5. Minimal Step 1 schema

Only the entities one vertical slice needs: a saved job, a résumé version, its claims and requirements, and a linked interview session or question.

| Entity | Required fields |
|---|---|
| `ProfessionalProfile` | target role family, seniority, location constraints, priorities, `updatedAt`. User-approved only. |
| `SourceArtifact` | `id`, `type` (`resume_version`, `job_listing`, `knowledge_note`, `interview_session`, `duo_session`, `user_correction` or `unmapped`), origin, `createdAt`, content hash, retention policy, `supersedes` |
| `EvidenceClaim` | `id`, kind (skill, experience, metric, qualification), normalized value, scope (general or job-specific), validity interval, `status` (`extracted`, `user_confirmed`, `user_asserted`, `inferred`, `disputed`, `outdated`), source span (artifact, version, page/section/offset), `schemaVersion`, `extractorVersion`, plus `model`/`promptVersion` when model-derived |
| `EvidenceConflict` | the competing claim IDs, field/scope/time range, `status` (`open`, `user_resolved`, `contextual`, `superseded`), resolution note |
| `TargetRequirement` | job artifact, original wording and span, hard requirement / preference / inferred, role context (title, seniority, location, date) |
| `Demonstration` | interview artifact, question type, competency, outcome (`demonstrated`, `attempted`, `needs_work`, `incomplete`), **set by the user**, linked feedback |
| `WorkflowLink` | job ↔ résumé version ↔ session ↔ preparation actions |
| `FeedbackAction` | rating, suggested next step, approval state, undo history |

### Invariants

- Every conclusion is traceable: which requirement, which evidence, from which version, when, and with what status.
- Use categorical states (`Supported`, `No evidence found`, `Potential mismatch`, `User-confirmed`, `Needs review`) before any numeric score.
- **Corrections are append-only assertions.** An outdated claim keeps its history and is superseded. A corrected extraction keeps the original. A user-asserted claim is never relabelled as résumé-documented.
- **Conflicts are first-class.** Never choose a winner because a source is newer, never average, and never collapse a conflict to "unknown". Until a conflict is resolved, downstream views show it or abstain.
- **Reprocessing creates a new derived result linked to the old one.** The re-process path is idempotent and inspectable, and shows a diff that can be accepted or rolled back.
- **Uploads and imported pages are data, not instructions.** Retrieval returns only what the current task needs.

## 6. Ingestion lifecycle

1. **Register:** keep the original, with type, origin, time and scope.
2. **Classify and extract:** résumé, job description, knowledge note or `unmapped`.
3. **Validate:** report unreadable pages, poor OCR, missing sections or truncation. A partial parse is never presented as complete.
4. **Create evidence:** each fact gets a pointer to its source span.
5. **Reconcile:** detect duplicates and conflicts; the user marks a source current, outdated or authoritative.
6. **Review and index:** `Processing` → `Ready to review` → `Indexed`, or `Needs attention` / `Failed`.
7. **Propagate:** show affected matches and drafts. Never destroy prior versions or silently rewrite user documents.

Deletion removes the source and its derived indexes and caches, and discloses what the app cannot erase (provider-side copies, backups). The UI states whether parsing, OCR and embedding happen locally or at a named provider.

## 7. Retention tiers

1. **Source of truth:** résumé versions, saved jobs and other artifacts, under user control.
2. **Derived state:** provenance-linked claims and links that the user can inspect, correct and delete.
3. **Interview learning:** by default, structured observations only (question category, competency, evidence IDs, user feedback, date, session). Raw transcripts are kept only under an explicit user policy. Today's history keeps the newest 60 full sessions; Step 1 must offer the choice before relying on transcripts.
4. **Live context:** in memory for the current session; never promoted to diagnostics.
5. **Engineering diagnostics:** metadata only, isolated (today's diagnostics, session metrics and product insights).

Processing, cloud transmission and durable retention are separate controls.

## 8. Latency and spend rules

- **No parallel evaluator on the Live critical path.** Live already makes one primary call per question. The early answer start can discard a request, which is documented with its cost in `MODEL_AND_AUDIO_REVIEW.md`.
- **Any same-completion coaching signal must not delay streaming.** It is evaluated together with answer quality as one treatment (Step 4).
- **No extra model call per turn by default.** A post-session analysis call must be user-initiated, name the provider, show the estimated cost and use its own budget.
- **No silent paid fallback, fan-out or hidden retries.**
- **Gap:** MockMate has no app-side hard spend ceiling across LLM and transcription yet; the cost gauge is an estimate. This must exist before any post-session analysis call is added, alongside provider-side limits.

## 9. Autonomy

| Authority | Allowed |
|---|---|
| Read and connect | Link user-selected artifacts and show provenance |
| Recommend | Rank gaps and next actions, with evidence and a correction path |
| Recover safely | Bounded, reversible runtime recovery under existing retry and spend rules |
| Draft | New versions or visible diffs only |
| Apply | User-data changes only after approval, with undo and history |
| External side effects | Direct confirmation for job submissions, emails, deletions, spending changes or paid-provider activation |

Weak behavioural signals (copy, regenerate, dismiss) never become durable facts about the user.

## 10. Gates and sequencing

**Gate 0: measure the current Live build.** v1.6.3 is the first release that contains #93 (and #94).

1. Install it.
2. Run one representative 90-minute session.
3. Compare it against v1.6.2 and LockedIn using the fixed rubric in [`EVALS.md`](EVALS.md#gate-0-representative-live-session).

If the gap closes, use MockMate. If a gap remains, name it before adding features. One session is an initial signal, not proof.

**Privacy gate (before Step 1 ingests any résumé, job-description or knowledge-bank content into the graph):** storage, provider transmission, retention, deletion and user-facing copy must match the implementation.
- Done in v1.6.3:
  - the Product insights panel copy was corrected and scoped
  - label-derived rage-click targets were removed, and the old store is deleted
  - the breadcrumb opt-in now actually controls diagnostics forwarding
- Remaining:
  - make Duo recent rooms account-scoped and deleted with the account
  - add per-artifact provider disclosure where content is sent
  - define a transcript retention choice (§7)
  - write graph-specific deletion and copy

**Step 1, minimal graph:** only after both gates.
- Model the §5 entities for one path, reusing existing storage.
- Ship a minimal **My Professional Model** surface: target profile, compare with a selected job, inspect a claim's source, version, status and dependents, correct or dispute it, view conflicts, and turn a confirmed gap into an approved action.
- Provenance, versioning, correction, conflicts and deletion must work before any intelligence is added.

**Step 2, cross-surface slice:** match a selected job requirement to a résumé source span, or show `No evidence found`. Link the interview session to the job and résumé version used. Show a post-session view that exposes and corrects these links. Deterministic linking only; no Live evaluator call.

**Step 3, test whether unification earns its cost:** see §11. Stop expanding the shared layer if it fails.

**Step 4, same-completion Live coaching signals:** only after Step 3 passes (§8).

**Not planned:** an in-product source-code repair agent.

## 11. Evaluation

**Correctness (fixtures).** Five synthetic, labelled scenarios, each with expected sources, counts, conflict status and recommend-or-abstain written down before running:
1. a valid three-way gap
2. supporting résumé evidence exists
3. conflicting claims (for example explicit years vs date span)
4. an outdated source that is superseded
5. insufficient data

Each scenario also includes a correction or version update. The graph passes only if:
- every source link and count is right
- it never reports a definitive gap in cases 2, 3 or 5
- no correction leaves a stale downstream conclusion

**Federated baseline (test-only).**
- Build it from the same fixtures, with three independent surfaces (job requirements, résumé evidence, practice demonstrations) plus one explicit one-off join for the gap recommendation.
- It has no persistent graph, no correction propagation, no user data and makes no model calls.
- Unification is supported only by a material advantage in correctness, conflict and correction propagation, or in avoiding accumulating join logic.

**Eligible real insight.** All of the following must hold:
- ≥5 deduplicated, parsed job listings in one user-selected role family from the last 12 months, with the requirement in ≥3 of them (source passages available)
- the selected résumé version has no source-linked support for the requirement, and there is no open conflict or extraction failure
- ≥3 comparable demonstrations across ≥2 sessions that the user explicitly marked `needs_work` or `incomplete`
- all sources are current and linked to the same goal

**Pass bar.** On the first five eligible insights:
- ≥4 rated useful or actionable
- ≥2 lead to a user-chosen next action
- zero material provenance errors

This is a self-evaluation by one user, not independent proof. If five eligible cases do not arise within six months, record the thesis as **untested** and do not expand on the assumption that it passed.

**Decision rule.** If the graph fails the fixtures or the user-value bar, keep the simpler source-linked features and stop expanding it. Passing supports continuing, not unlimited scope.

Saved-job frequencies describe the user's deduplicated sample, not the labour market. Never claim ARCH caused an interview or hiring outcome.
