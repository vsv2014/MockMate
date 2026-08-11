import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./http.js', () => ({
  fetchWithTimeout: vi.fn(),
}))

import { fetchWithTimeout } from './http.js'
import { deepgramToken } from './core.js'

describe('deepgramToken key-fallback policy', () => {
  const prev = {
    key: process.env.DEEPGRAM_API_KEY,
    hosted: process.env.MOCKMATE_HOSTED,
    managed: process.env.MOCKMATE_MANAGED,
    fallback: process.env.MOCKMATE_DEEPGRAM_KEY_FALLBACK,
  }

  beforeEach(() => {
    process.env.DEEPGRAM_API_KEY = 'dg-secret'
    delete process.env.MOCKMATE_HOSTED
    delete process.env.MOCKMATE_MANAGED
    delete process.env.MOCKMATE_DEEPGRAM_KEY_FALLBACK
    vi.mocked(fetchWithTimeout).mockReset()
  })

  afterEach(() => {
    for (const [k, v] of Object.entries({
      DEEPGRAM_API_KEY: prev.key,
      MOCKMATE_HOSTED: prev.hosted,
      MOCKMATE_MANAGED: prev.managed,
      MOCKMATE_DEEPGRAM_KEY_FALLBACK: prev.fallback,
    })) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('returns grant JSON when mint succeeds', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'grant', expires_in: 300 }),
    })
    const out = await deepgramToken({ allowApiKeyFallback: true })
    expect(out.access_token).toBe('grant')
    expect(out.fallback).toBeUndefined()
  })

  it('allows raw-key fallback on local (incl. when caller opts in)', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false, status: 403 })
    const out = await deepgramToken({ allowApiKeyFallback: true })
    expect(out.access_token).toBe('dg-secret')
    expect(out.fallback).toBe('api_key')
    expect(out.localOnly).toBe(true)
  })

  it('allows fallback under local MOCKMATE_MANAGED (Electron auth fork)', async () => {
    process.env.MOCKMATE_MANAGED = '1'
    vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false, status: 403 })
    const out = await deepgramToken({ allowApiKeyFallback: true })
    expect(out.fallback).toBe('api_key')
  })

  it('refuses raw-key fallback without allowApiKeyFallback', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false, status: 403 })
    await expect(deepgramToken({})).rejects.toMatchObject({ status: 403 })
    await expect(deepgramToken({ allowApiKeyFallback: false })).rejects.toMatchObject({ status: 403 })
  })

  it('never falls back when MOCKMATE_HOSTED (remote production)', async () => {
    process.env.MOCKMATE_HOSTED = '1'
    vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false, status: 403 })
    await expect(deepgramToken({ allowApiKeyFallback: true })).rejects.toMatchObject({ status: 403 })
  })

  it('respects MOCKMATE_DEEPGRAM_KEY_FALLBACK=0 even with allow flag', async () => {
    process.env.MOCKMATE_DEEPGRAM_KEY_FALLBACK = '0'
    vi.mocked(fetchWithTimeout).mockResolvedValue({ ok: false, status: 401 })
    await expect(deepgramToken({ allowApiKeyFallback: true })).rejects.toMatchObject({ status: 401 })
  })
})
