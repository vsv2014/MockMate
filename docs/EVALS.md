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
