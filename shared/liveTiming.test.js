import { describe, expect, it } from 'vitest'
import {
  LIVE_HINT_OVERALL_TIMEOUT_MS,
  LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS,
} from './liveTiming.js'

describe('Live answer timing budget', () => {
  it('allows three default provider attempts plus cleanup margin', () => {
    expect(LIVE_HINT_OVERALL_TIMEOUT_MS).toBeGreaterThanOrEqual(
      LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS * 3 + 5_000,
    )
  })
})

