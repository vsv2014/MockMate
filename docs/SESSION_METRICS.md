# Session metrics (Phase 6)

Live sessions append **privacy-safe** JSONL rows to Electron `userData/session-metrics.jsonl` via IPC.

**Never logged:** resume text, transcripts, answers, prompts.

**Logged:** session id, TTFT ms, final-transcript confidence, diarization/degraded-mode coverage,
STT reconnect count, stream fallback / incomplete / skip / error codes, question-capture / reject /
generation-cancelled counters (privacy-safe codes only), token/cost totals at end.

The Home dashboard reads only the most recent session-summary rows and displays aggregate quality
indicators. It never loads transcript, résumé, prompt, or answer content.

## Local inspection
```bash
# After a packaged or Electron Live session:
# macOS: ~/Library/Application Support/mockmate/session-metrics.jsonl
# Linux: ~/.config/mockmate/session-metrics.jsonl
# Windows: %APPDATA%\\mockmate\\session-metrics.jsonl
```

## Soak harness (no provider spend)
```bash
npm run soak          # ~5s simulated metrics
SOAK_MS=60000 npm run soak
```

## Unit tests
`src/lib/sessionMetrics.test.js` — sanitize + TTFT summary.
Related Live modules: `shared/questionCapture*.test.js`, `shared/generationManager.test.js`,
`shared/interviewState*.test.js`.
