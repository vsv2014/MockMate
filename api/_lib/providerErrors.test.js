import { describe, expect, it } from 'vitest'
import { actionableProviderError } from './core.js'

describe('actionable provider failures', () => {
  it.each([
    [{ status: 401, message: 'secret upstream payload sk-test' }, 'provider_auth'],
    [{ status: 403, message: 'access denied' }, 'model_access'],
    [{ status: 404, code: 'model_not_found' }, 'model_unavailable'],
    [{ status: 400, message: 'unsupported parameter' }, 'request_invalid'],
    [{ status: 503, message: 'network outage' }, 'transient'],
    [{ status: 404, message: 'Route not found' }, 'provider_error'],
  ])('preserves the cause without exposing upstream content', (upstream, code) => {
    const error = actionableProviderError(upstream)
    expect(error.code).toBe(code)
    expect(error.status).toBe(upstream.status)
    expect(error.message).not.toContain('sk-test')
    expect(error.message).not.toBe(upstream.message)
  })
})
