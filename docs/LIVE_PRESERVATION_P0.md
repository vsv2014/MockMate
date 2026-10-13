# Live preservation P0

This is transitional safety work on the existing account-scoped localStorage store. It is not the SQLite migration or hosted sync implementation.

## Implemented

- Start creates a provisional History row with the Live run ID. Controller, checkpoint, metrics, History updates and evaluation config share that ID.
- End commits captured interviewer/candidate material before requesting evaluation. No-candidate, empty, failed and cancelled sessions remain unscored records rather than disappearing behind a score gate.
- Final reports update the same row, preserving its original timestamp. History save reads back and verifies the committed row before acknowledging success.
- Recovery is cleared only after a successful final commit, and only for that run (or an absent checkpoint). Failed saves surface a warning and Retry local save; the notes view retains the copy-transcript route.
- evaluateSolo passes signal to completeJSON and its SDK request. Cancellation stops optional-parameter retries, JSON repair, retry backoff and provider failover. It is not proof that remote computation or billing stopped.

## Validation

111 test files / 870 tests pass. Production Vite build passes. New tests cover unscored states, zero score, one-row upserts, timestamp preservation, quota failure, silently dropped writes, cleanup failure, another run's retained checkpoint, account isolation, metrics identity and evaluator cancellation before/during request/backoff.

## Limits and remaining gates

localStorage remains quota-limited and History retains its existing age/cap/pruning behavior. Checkpoints remain the bounded visible question/hint feed (60 rows, 12-hour expiry), not a full incremental candidate transcript journal. Full conversation commit occurs at End; Start's provisional row does not make an interrupted pre-End capture durable. SQLite incremental capture and migration are specified in the separate architecture PR.

This patch consumes the abort signal injected by the Express API routes. The serverless postHandler currently does not inject a disconnect signal; this patch does not claim serverless disconnect propagation. Hosted persistence, evaluation retry UI, encryption, outbox, cross-device sync and full lifecycle UI are not implemented here. Windows packaged crash/upgrade/disk-full journeys still require validation before release. No tag, version bump, release publication or infrastructure purchase is included.
