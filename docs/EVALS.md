# Offline evals / CI gate

MockMate does **not** run live LLM judge evals in CI (cost + flakiness). The automated gate is:

```bash
npm test   # vitest — playbooks, packCandidateContext hierarchy, glanceLayers contract, shared helpers
```

**Release (manual) evals** — required before tagging, recorded on [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md):

| Rubric | Pass bar |
|---|---|
| Solo grounded main questions (resume/JD named) | ≥80% of 10 turns |
| Solo anti–answer-loop phrases | 0 occurrences |
| Solo follow-ups reference candidate content | ≥70% of follow-ups |
| Live stream ↔ JSON fallback same glance shape | opener + bullets + full |

When adding a hosted LLM-judge suite later, keep it opt-in (`MOCKMATE_RUN_LLM_EVALS=1`) and never block the default `npm test` path.

## Gate 0: representative Live session

Gate 0 decides whether the Live context and completeness gap is closed before any ARCH professional-model work starts (see [`PROFESSIONAL_MODEL.md`](PROFESSIONAL_MODEL.md#10-gates-and-sequencing)). **v1.6.3 is the first release that contains #93 and #94; v1.6.2 is the prior build.** One session is an initial signal, not proof.

### Fixed setup (identical for every build and for LockedIn)

- Use the same résumé, job description, selected documents or Kit, answer style (balanced) and AI provider keys. Record the provider and models that "Which model answers" shows.
- Use **System audio** as the source and play one recorded ~90-minute interviewer track through the meeting app or a second device. Do not improvise questions.
- Script about 35 questions:
  - 4 introduction or background
  - 8 behavioural
  - 6 résumé deep-dives that need specific projects or numbers
  - 6 technical concepts, each with 2 follow-ups
  - 2 coding, including "write it as code" refinements
  - 2 long multi-part system-design questions with 1–3 s pauses mid-question
  - 3 topic switches
  - 2 interviewer corrections ("actually, I meant…")
- Mark which questions are follow-ups and which need résumé or job-description context.
- MockMate builds: keep the early answer start at its default (on). At the end, use **Settings → Export logs** and keep the session in History.

### Score

```bash
node scripts/session-report.mjs MockMate-Diagnostics-<timestamp>.jsonl --scoresheet gate0-v1.6.3.csv
```

The report gives per-session timing, failures, provider attempts and fallbacks, early-start hits, speech-to-text quality and reported token usage. The scoresheet has one row per committed question.

Diagnostics contain no question or answer text, so match rows to your question script by order and time, using the session in History. Fill in the rubric columns from the History transcript. Score LockedIn on the same script by hand.

Gemini and Claude streams do not report token usage to MockMate, so take session cost from the provider's usage page.

| Column | Criterion (fixed; do not change between builds) |
|---|---|
| A | Answered the question actually asked: 0 wrong or a different question, 1 partly, 2 yes |
| B | Complete: 0 cut off or missing the main part, 1 minor gaps, 2 complete |
| C | Résumé, job-description and prior-turn context used correctly: 0 wrong or invented, 1 generic, 2 specific and correct, NA if not needed |
| D | Follow-up continuity: 0 ignores the previous answer, 1 partial, 2 builds on it; NA for new topics |
| E | Seconds from the end of the question to the first useful words |
| F | Usable as spoken: 0 no, 1 with edits, 2 as is |

Also count missed questions (no card), wrong or partial captures, duplicate cards, incomplete answers and visible errors.

### Decision rule (write any threshold changes down before the session)

The gap is **closed** if all of these hold against LockedIn on the same script:

- mean A+B+C+D (scored /8, NA scaled) is no more than 0.5 below LockedIn's
- there is no question category where LockedIn wins on 3 or more questions
- at most 1 incomplete answer and at most 1 missed question
- median E is no more than 1 s above LockedIn's

v1.6.3 must also be at least as good as v1.6.2 on A, B and D, with fewer incomplete answers.

If any condition fails, **name the gap** (the category and criterion that lost) before adding features.
