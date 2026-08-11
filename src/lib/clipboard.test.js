import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyText, downloadTextFile } from './clipboard.js'

describe('copyText', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(async () => {}) },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('uses clipboard.writeText when available', async () => {
    const ok = await copyText('hello')
    expect(ok).toBe(true)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
  })

  it('returns false for empty text', async () => {
    expect(await copyText('')).toBe(false)
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })
})

describe('downloadTextFile', () => {
  it('exports a function (DOM download exercised in the app)', () => {
    expect(typeof downloadTextFile).toBe('function')
  })
})
