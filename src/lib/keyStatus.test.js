import { describe, it, expect } from 'vitest'
import { configuredKeyRows, keyFieldStatus } from './keyStatus.js'

describe('key presence independently of usable models', () => {
  it('keeps a credential visible when there are no usable models', () => {
    expect(configuredKeyRows({ providers: [], allProviders: [{ id: 'gemini', configured: true }] })).toEqual([{ id: 'gemini', configured: true }])
  })
  it('does not infer configured keys from unconfigured catalog rows', () => {
    expect(configuredKeyRows({ allProviders: [{ id: 'groq', configured: false }] })).toEqual([])
    expect(() => configuredKeyRows({})).toThrow('incomplete')
  })
  it('does not show missing or verified while status is unknown', () => {
    expect(keyFieldStatus({ status: 'loading' })).toBe('Checking key status…')
    expect(keyFieldStatus({ added: true, status: 'error', testStatus: 'ok' })).toBe('Key status unavailable')
  })
  it('distinguishes entering a first key from replacing one', () => {
    expect(keyFieldStatus({ edited: true })).toBe('New value not saved')
    expect(keyFieldStatus({ edited: true, added: true, testStatus: 'ok' })).toBe('Replacement not saved')
    expect(keyFieldStatus({ added: true, testStatus: 'error' })).toBe('Key detected · test failed')
    expect(keyFieldStatus()).toBe('Not configured')
  })
})
