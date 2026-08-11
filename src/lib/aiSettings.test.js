import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ANSWER_STYLE_KEY, ANSWER_STYLE_DEFAULT, getAnswerStyle, setAnswerStyle } from './aiSettings.js'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => { store.delete(k) },
})

describe('answer style SOT', () => {
  beforeEach(() => { store.clear() })

  it('defaults to concise when unset', () => {
    expect(ANSWER_STYLE_DEFAULT).toBe('concise')
    expect(getAnswerStyle()).toBe('concise')
  })

  it('persists and reads the same value', () => {
    setAnswerStyle('balanced')
    expect(getAnswerStyle()).toBe('balanced')
    setAnswerStyle('detailed')
    expect(getAnswerStyle()).toBe('detailed')
    setAnswerStyle('concise')
    expect(getAnswerStyle()).toBe('concise')
  })

  it('ignores invalid stored values', () => {
    localStorage.setItem(ANSWER_STYLE_KEY, 'turbo')
    expect(getAnswerStyle()).toBe('concise')
  })
})
