import { describe, expect, it } from 'vitest'
import { canRunLanguage } from './codeRunner.js'

describe('code runner language gate', () => {
  it('allows JavaScript aliases only', () => {
    expect(canRunLanguage('javascript')).toBe(true)
    expect(canRunLanguage('JS')).toBe(true)
    expect(canRunLanguage('python')).toBe(false)
    expect(canRunLanguage('typescript')).toBe(false)
  })
})
