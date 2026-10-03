# LockedIn Transcript Autopsy — Failure Pattern Ledger

**Status: EVIDENCE-FILLED (2026-10-03).** 8 files attached → 7 unique sessions (DispatchTrack 30-Sep and
Teradata 29-Sep were pasted twice). All quotes below are verbatim-shortened from the pasted exports.
Nothing is invented; sessions not pasted (Santhosh-Teradata-round4, Manideep 09-30 01:17 full text)
remain unchecked.

## Session outcomes (honest read)

| Session | Company / interviewer | Outcome signal | Dominant failures |
|---|---|---|---|
| DispatchTrack 24-Sep (75m) | DispatchTrack panel | technical content strong; panel kept correcting the generative task | LP-13, LP-11 |
| DispatchTrack 30-Sep (44m) | DispatchTrack panel | neutral close; repetition + fabricated water project + revenue guessing | LP-11, LP-12, LP-03 |
| DispatchTrack 02-Oct (31m) | Founder (technical) | **founder said he'd recommend an offer** — despite identity/placeholder landmines | LP-18, LP-20, LP-19 |
| Teradata 29-Sep (74m) | Rahul/Ravi, compute group | feedback: "try more on the coding side" — the stall cost him | LP-14, LP-15, LP-16 |
| Teradata 30-Sep (15m) | Bharath, Prodigal | no next step — an HONEST fit conversation (0-to-1 vs 1-to-10), not a failure | — |
| Coursera 24-Sep (38m) | "Am", Coursera FDE team | smooth; closed by thanking a person under a hallucinated name | LP-03 (name) |
| RealPage 09-Sep (3m) | cut short | no signal | — |

## Candidate mistakes (what Vishal/Santhosh did wrong, separate from the AI)

1. **Let the echo-loop play out** — never interrupted when the same answer was re-spoken 3–4×
   (DispatchTrack 30-Sep strengths ×4 at 23:13:36–23:13:45; NoSQL ×3 at 22:51:46–22:52:55).
2. **Didn't take the keyboard when the AI stalled** — Teradata 29-Sep: interviewer had to say
   "where is code" TWICE (23:52:30, 23:55:17) before any code appeared.
3. **Spoke the AI's landmines aloud** — "[X] years" and "Yes, I'm Isabel" were presumably vocalized
   (02-Oct); a manual kill/override habit would have saved both.
4. **Profile/identity drift across sessions** — Hyderabad vs "originally from Bangalore",
   "Santhosh Vishal" persona reused; inconsistency is a tell.
5. **Verbatim long monologues** — answers read as walls of text; no 90–120s discipline (LP-06).

## LockedIn wrong answers (fabrications & misfires, quoted)

| # | Session | Quote (shortened) | Why wrong | Pattern |
|---|---|---|---|---|
| W1 | DispatchTrack 30-Sep 22:54:09 | "on the water-related work… sensor noise… temperature and dissolved oxygen trends" | Invented an entire water-quality ML project from a garbled word; resume is a Kore.ai SDE2 | LP-03 |
| W2 | DispatchTrack 30-Sep 23:11:56–23:12:04 | "scaled to roughly $30M ARR… $200M to $525M band" | Fabricated employer revenue figures, spoken as fact | LP-03 |
| W3 | Coursera 22:07:30 | "Thank you, Shrreya" | Interviewer never stated that name | LP-03 |
| W4 | DispatchTrack 02-Oct 08:46:15 | "Yes, I'm Isabel. Nice to meet you." | Candidate is NOT Isabel; accepted a wrong identity | LP-18 |
| W5 | DispatchTrack 02-Oct 08:36:39–08:37:56 | "I started in civil engineering… Data Structures and Algorithms was my number one" | Interviewer was telling HIS OWN civil-engineering story; AI appropriated it as the candidate's life | LP-19 |
| W6 | DispatchTrack 02-Oct 08:45:46 | "I've had my current vehicle for about **[X] years**" | Template placeholder leaked into a spoken answer | LP-20 |
| W7 | Teradata 29-Sep 00:12:16 | "Yes, you're right — that line is sorting all items together" | FALSE about its own code (the 00:04:15 version sorted inside buckets); sycophantic concession | LP-15 |
| W8 | Teradata 29-Sep 23:50:10–23:50:21 | "I'd treat that as the experience band…" | The interviewer was enumerating array indexes; prior CV-banding topic bled into a coding question | LP-16 |
| W9 | Teradata 29-Sep 23:49:03–23:52:32 | 8+ clarifying restatements, zero code | Clarification stall; interviewer demanded "where is code" twice | LP-14 |
| W10 | DispatchTrack 24-Sep 05:20–05:47 | kept generating an "assistant prompt" while interviewer wanted a spec prompt for building a web app; "No no no no" ×1 | Meta-instruction drift on a generative task | LP-13 |
| W11 | DispatchTrack 30-Sep 22:42:17–19 | confident full answer THEN "Sorry, I didn't catch that" for the same turn | Double-emit contradiction | LP-12 |
| W12 | Coursera 21:34:33 | "Yes, I'd be open to relocating to Pune" | Committed the candidate to relocation without asking him | LP-17 |
| W13 | All sessions | near-identical full answers re-spoken per ASR fragment | Fragment echo loop — the single biggest "this is a bot" tell | LP-11 |

## Pattern taxonomy (LP-01…LP-20)

LP-01…LP-10 as previously defined (misheard questions, not-asked questions, truth violations, zero
company context, fragile SQL/coding, robotic pacing, latency, ignored playbooks, seniority mismatch,
no learning loop). Evidence additions: LP-03 ← W1–W3; LP-06 ← repetition walls in every session.

| ID | Pattern (new, evidence-born) | MockMate mitigation shipped THIS commit |
|---|---|---|
| LP-11 | Fragment echo loop | Anti-Fail rule ONE ANSWER PER TURN; duplicate-suppression already in STT layer (1.4.8) |
| LP-12 | Double-emit contradiction | Anti-Fail rule ONE ANSWER PER TURN |
| LP-13 | Meta-instruction drift | Anti-Fail rule (existing NOT-ASKED) + new: restate requested ARTIFACT before generating |
| LP-14 | Clarification stall | Anti-Fail rule CODE FIRST |
| LP-15 | Sycophantic self-code misread | Anti-Fail rule VERIFY BEFORE AGREEING |
| LP-16 | Context bleed across topics | topic isolation shipped 1.4.11; Anti-Fail rule TOPIC ISOLATION |
| LP-17 | Unauthorized commitments | Anti-Fail rule NO UNAUTHORIZED COMMITMENTS |
| LP-18 | Identity acceptance | Anti-Fail rule IDENTITY LOCK |
| LP-19 | Biography appropriation | Anti-Fail rule INTERVIEWER STORIES ARE NOT MINE |
| LP-20 | Placeholder/meta-prefix leak | **runtime**: `sanitizeSpokenProse` now strips `[X]`-style brackets and `SAY:/THINK:/IF HE GOES DEEPER:` coach prefixes (shared/hintLayers.js) + Anti-Fail rule NO PLACEHOLDERS |

## In-product encoding

- `CustomPromptStudio` template `anti_fail` (🛡 Anti-Fail Guardrails) carries all rules as ALWAYS-blocks.
- `shared/hintLayers.js#sanitizeSpokenProse` enforces LP-20 at runtime, code blocks untouched.
- Remaining process-level items (no code can fully solve): manual kill-switch habit, profile/name
  hygiene across applications, and rehearsing brevity so answers stay 90–120s.
