# MockMate v1.4.11

## Real-interview reliability

This patch is based on the full SysCloud Round 2 interview transcript and its privacy-safe v1.4.9 diagnostics—not synthetic assumptions.

- Question assembly is now bounded: a viable partial question commits by 4.5 seconds and an unusable fragment expires by 6.5 seconds. The previous state machine could repeatedly stabilize an incomplete lane and carry its timestamp/context for minutes.
- Rejected lanes are logged and cleared, preventing stale fragments from joining the next topic.
- Context-gated term repair covers the observed CTE, polling, RBAC and CI/Jenkins recognition failures without globally rewriting ordinary words such as city, database connection pooling, or RBC in unrelated contexts.
- “I am asking…” starts the corrected question and discards the stale topic.
- Auto-skip removes meeting mechanics such as audible/visible/screen-share checks before creating an answer card or calling an LLM.
- The answer truth contract forbids unsupported experience duration, tools, cloud services, ownership, metrics, employers, locations and acronym expansions. A JD remains a requirement source, never evidence that the candidate used a skill.
- Conversation history is explicitly secondary and may resolve only real follow-up references. The current standalone question always wins.

## Interview Playbook

- Live Setup now shows a highlighted, expanded **Interview Playbook** card before the Start button instead of burying custom instructions inside Documents & context.
- MockMate stores the full playbook and compiles core plus question-relevant sections for each turn, so late SQL, Python, coding, architecture, API, Angular, AI/RAG/MCP and behavioral rules are no longer discarded by a 2,000-character prefix cutoff.
- Source-mode enforcement keeps verified personal ownership, documented product behavior, general knowledge and hypothetical designs separate. A custom prompt cannot override résumé truthfulness or claim external actions that MockMate did not perform.
- **Interview Documents** now follows the playbook in the setup sequence and shows how many résumé,
  JD and selected supporting sources are ready before the user expands it. Start Live comes after all
  personalization controls and remains sticky while the setup form scrolls.
- Solo Practice now exposes the same prominent playbook editor and active-state indicator. A shared
  playbook can no longer influence practice while remaining invisible in setup.

## Desktop product safety

- Each saved interview now keeps a compact setup snapshot: mode, company, role, selected-document
  IDs and whether the playbook, résumé and JD were active. Users can switch between any number of
  companies without changing the meaning of older sessions.
- Document retrieval now respects the configured relevance threshold. If no selected passage is
  relevant, MockMate adds no document context instead of forcing a zero-score fallback into the
  answer. Long documents sample representative sections across the file and are labeled as such.
- Document uploads report local-storage failures rather than displaying a false success message.
- Resume Studio calls its score an **AI match estimate**, clarifies that it is not an employer ATS
  result, and keeps a one-step backup with visible Undo before changing the resume shared by Jobs,
  Solo and Live.
- History attempts to preserve the newest completed interview by pruning the oldest local entries
  when storage is constrained. If even the newest session cannot be stored, the report tells the
  user to copy the transcript before leaving.
- Job cards identify Remotive or Adzuna and open the original listing. AI only ranks listings
  returned by those sources; it does not synthesize job openings.

## Validation status

- Focused deterministic regression tests cover every code-level behavior above.
- A packaged Windows replay is still required. Do not describe speech recognition or hallucination prevention as perfect: Deepgram and the selected answer model remain probabilistic.
- Release approval requires the full unit/API/build checks and the GitHub Actions Windows installer/updater artifacts.
