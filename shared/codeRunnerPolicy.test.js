import { describe, expect, it } from 'vitest'
import { CODE_RUNNER_WORKER_CSP } from './codeRunnerPolicy.js'

describe('code runner worker CSP', () => {
  it('allows evaluation only in the isolated worker and denies network access', () => {
    expect(CODE_RUNNER_WORKER_CSP).toContain("script-src 'self' 'unsafe-eval'")
    expect(CODE_RUNNER_WORKER_CSP).toContain("connect-src 'none'")
    expect(CODE_RUNNER_WORKER_CSP).toContain("default-src 'none'")
  })
})

