# LockedIn Transcript Autopsy — Failure Pattern Ledger

**Status:** framework + pattern taxonomy SHIPPED; per-transcript evidence cells **AWAITING CONTENT**.
The 8 transcript files were attached by name but their content did not reach the workspace
(`/home/user/uploads/` absent). **Nothing below invents transcript content.** Framework rows are
pre-populated only from (a) MockMate's own documented real-interview regressions (v1.4.8–v1.5.2
release notes) and (b) filename-level metadata (who/round/company/date). Evidence cells get filled
when the transcripts are re-attached.

## Filename-level metadata (honest observations, no content claims)

| File | Candidate | Company | Round/date signal |
|---|---|---|---|
| `…santhosh-teradata-round4-2026-09-04` | Santhosh | Teradata | **Round 4** — earlier rounds did not convert |
| `…vishal-realpage-2026-09-09` | Vishal | RealPage | single session |
| `…vishal-dispatchtrack-2026-09-24-0431` | Vishal | DispatchTrack | attempt 1, 04:31 local |
| `…vishal-coursera-2026-09-24-2129` | Vishal | Coursera | same day as DispatchTrack attempt 1 |
| `…teradata-manideep-2026-09-29-2326` | Manideep | Teradata | attempt 1, 23:26 |
| `…teradata-manideep-2026-09-30-0117` | Manideep | Teradata | attempt 2 ~2h later — same-night retry loop |
| `…vishal-dispatchtrack-2026-09-30-2229` | Vishal | DispatchTrack | attempt 2 |
| `…vishal-dispatchtrack-2026-10-02-0830` | Vishal | DispatchTrack | attempt 3 within 8 days |

**Metadata-level pattern P-RETRY:** repeated same-company rounds (Vishal ×3 DispatchTrack,
Manideep ×2 same night, Santhosh round 4) indicate the assist loop was not converting interviews —
either answer quality, truth violations, or mismatch detection got candidates rejected or re-rolled.

## Pattern taxonomy (LP-xx)

| ID | Pattern | Failure shape | MockMate shipped mitigation |
|---|---|---|---|
| LP-01 | **Misheard/ASR-corrupted question → confident wrong answer** | "notes/nodes", CTE/polling/RBAC/CI term corruption; assistant answers the *heard* question, not the *asked* one | 700–1500ms semantic stabilization, incomplete-clause blocking, contextual term repair, correction controls *(1.4.8/1.4.11)*; Anti-Fail template rule MISHEARD QUESTIONS |
| LP-02 | **Answering a question that wasn't asked** | topic drift; logistical turns answered with technical monologues | logistical-turn suppression, correction/topic isolation *(1.4.11)*; rule NOT-ASKED QUESTIONS |
| LP-03 | **Resume-truth violation** | assistant claims tools/metrics/employers not on the resume → candidate caught | resume-truth/JD-fit evidence policy, stricter résumé-truth contracts *(1.4.8/1.4.11)*; rule TRUTH |
| LP-04 | **Generic boilerplate, zero company context** | "why us" answered generically; 47% of rejections tie to insufficient company context (JDP/StandOut CV data, checked 2026-10-03) | RAG JD grounding, targetCompany context in Solo/Live/Duo; rule COMPANY CONTEXT |
| LP-05 | **Wrong/fragile SQL & coding answers** | invented columns/schema, unverified grain, broken CTEs | session-scoped coding context, "write it as code" correction, bounded sandbox; rule SQL/CODING |
| LP-06 | **Robotic over-long answers → suspicion** | reading walls of text aloud; no STAR discipline | answer-depth controls, spoken-output guardrail, UCD STAR ratios (10/10/70–80/10, 90–120s); rule PACING |
| LP-07 | **Latency: answer arrives after topic moved on** | 10–20s silences then stale answer | 12s hard deadline, stale-generation cancellation, wait/repeat cancels *(1.4.8)* |
| LP-08 | **Custom prompt / playbook ignored mid-session** | late-added rules not applied to answers | CustomPromptStudio ALWAYS vs AUTO-ROUTED compilation *(1.5.2)* |
| LP-09 | **Seniority/region-mismatched advice** | intern-depth or architect-depth answers for the wrong band; region-locked job advice | seniority hard filter (LLM) + band penalties (heuristic), region tokens |
| LP-10 | **No learning loop between rounds** | same mistakes repeated across retry rounds (see P-RETRY) | ARCH product intelligence, History, Skills Matrix drills, session debriefs |

## Per-transcript evidence cells (TO FILL when content arrives)

For each file record: (1) question list with type tag (SQL/coding/system/behavioral/logistical),
(2) candidate mistakes (misread, ramble, truth slip, pacing), (3) LockedIn wrong answers (quote the
assistant line + why wrong: hallucination / stale / off-question / schema invention), (4) which LP-xx
each instance matches, (5) new patterns not in the taxonomy (assign LP-11+).

- [ ] `lockedin-custom-prompt-santhosh-teradata-round4-2026-09-04-2330.txt`
- [ ] `lockedin-custom-prompt-vishal-realpage-2026-09-09-0219.txt`
- [ ] `lockedin-custom-prompt-vishal-dispatchtrack-2026-09-24-0431.txt`
- [ ] `lockedin-custom-prompt-vishal-coursera-2026-09-24-2129.txt`
- [ ] `lockedin-custom-prompt-teradata-manideep-2026-09-29-2326.txt`
- [ ] `lockedin-custom-prompt-teradata-manideep-2026-09-30-0117.txt`
- [ ] `lockedin-custom-prompt-vishal-dispatchtrack-2026-09-30-2229.txt`
- [ ] `lockedin-custom-prompt-vishal-dispatchtrack-2026-10-02-0830.txt`

## In-product encoding

The taxonomy ships as the **🛡 Anti-Fail Guardrails** one-click playbook template in
`CustomPromptStudio` (`src/components/CustomPromptStudio.jsx`, id `anti_fail`) so every session can
carry the forensic rules as `● ALWAYS` blocks. When transcript evidence lands, rules get tightened
per pattern with quoted examples.
