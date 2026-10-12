import { describe, expect, it } from 'vitest'
import {
  LIVE_HINT_OVERALL_TIMEOUT_MS,
  LIVE_HINT_STALL_TIMEOUT_MS,
  LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS,
  LIVE_STREAM_STALL_TIMEOUT_MS,
} from './liveTiming.js'

describe('Live answer timing budget', () => {
  it('allows three default provider attempts plus cleanup margin', () => {
    expect(LIVE_HINT_OVERALL_TIMEOUT_MS).toBeGreaterThanOrEqual(
      LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS * 3 + 5_000,
    )
  })

  it('lets the server report a stalled stream before the browser backstop fires', () => {
    expect(LIVE_HINT_STALL_TIMEOUT_MS).toBeGreaterThan(LIVE_STREAM_STALL_TIMEOUT_MS)
    // A stall budget far below the first-token budget would make healthy but slow
    // providers look broken mid-answer.
    expect(LIVE_STREAM_STALL_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000)
  })
})
