import { describe, it, expect } from 'vitest'
import gateway from '../electron/connector-gateway.cjs'

const { sourceCheck } = gateway

describe('connector source validation', () => {
  it('never silently truncates identifiers into another source', () => {
    const longPath = 'owner/repo:' + 'a'.repeat(600) + '.md'
    expect(() => sourceCheck('github', longPath)).toThrow(/Invalid connector source identifier/)
    expect(() => sourceCheck('googledrive', 'x'.repeat(601))).toThrow(/Invalid connector source identifier/)
  })

  it('retains valid IDs and blocks traversal and invalid values', () => {
    expect(sourceCheck('github', 'owner/repo:docs/guide.md')).toBe('owner/repo:docs/guide.md')
    expect(() => sourceCheck('github', 'owner/repo:../secrets.md')).toThrow(/Unsafe GitHub path/)
    expect(() => sourceCheck('googledrive', 'invalid/id')).toThrow(/Invalid Drive file ID/)
    expect(() => sourceCheck('github', null)).toThrow(/Invalid connector source identifier/)
  })
})
