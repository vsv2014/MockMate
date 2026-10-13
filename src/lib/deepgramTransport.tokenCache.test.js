import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './apiClient'
import { clearDeepgramTokenCache, requestDeepgramToken } from './deepgramTransport'

vi.mock('./apiClient', () => ({ apiFetch: vi.fn() }))

const grantResponse = (token = 'temporary-grant', expiresIn = 300) => ({
  ok: true, status: 200,
  json: async () => ({ access_token: token, expires_in: expiresIn }),
})

describe('per-session Deepgram grant lease reuse', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T08:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('reuses one grant across successive websocket reconnects', async () => {
    apiFetch.mockResolvedValue(grantResponse())
    const cacheRef = { current: null }
    const first = await requestDeepgramToken({ mode: 'system_audio', cacheRef, generation: 1 })
    const second = await requestDeepgramToken({ mode: 'system_audio', cacheRef, generation: 2 })
    const third = await requestDeepgramToken({ mode: 'system_audio', cacheRef, generation: 3 })
    expect(first.ok).toBe(true)
    expect(first.reused).toBe(false)
    expect(second.reused).toBe(true)
    expect(third.tokenRes.access_token).toBe('temporary-grant')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('refreshes before the grant expires, rather than connecting with an old JWT', async () => {
    apiFetch.mockResolvedValueOnce(grantResponse('grant-1', 300))
      .mockResolvedValueOnce(grantResponse('grant-2', 300))
    const cacheRef = { current: null }
    await requestDeepgramToken({ cacheRef })
    vi.setSystemTime(new Date('2026-10-09T08:04:31Z'))
    const refreshed = await requestDeepgramToken({ cacheRef })
    expect(refreshed.reused).toBe(false)
    expect(refreshed.tokenRes.access_token).toBe('grant-2')
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('does not retain obsolete tokens from stopped or superseded sessions', async () => {
    apiFetch.mockResolvedValue(grantResponse())
    const cacheRef = { current: null }
    await requestDeepgramToken({ cacheRef, isCurrent: () => false })
    expect(cacheRef.current).toBeNull()
    await requestDeepgramToken({ cacheRef })
    expect(cacheRef.current).not.toBeNull()
    clearDeepgramTokenCache(cacheRef)
    expect(cacheRef.current).toBeNull()
    await requestDeepgramToken({ cacheRef })
    expect(apiFetch).toHaveBeenCalledTimes(3)
  })

  it('does not cache local raw API-key fallback credentials', async () => {
    apiFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ access_token: 'local-api-key', expires_in: 3600, fallback: 'api_key' }),
    })
    const cacheRef = { current: null }
    await requestDeepgramToken({ cacheRef })
    await requestDeepgramToken({ cacheRef })
    expect(cacheRef.current).toBeNull()
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('does not treat an unsuccessful API response containing a token as a usable grant', async () => {
    apiFetch.mockResolvedValue({
      ok: false, status: 403,
      json: async () => ({ access_token: 'must-not-use' }),
    })
    const cacheRef = { current: null }
    const result = await requestDeepgramToken({ cacheRef })
    expect(result.ok).toBe(false)
    expect(result.tokenStatus).toBe(403)
    expect(cacheRef.current).toBeNull()
  })

  it('does not share grants across hook instances or interview sessions', async () => {
    apiFetch.mockResolvedValue(grantResponse())
    const mic = { current: null }, system = { current: null }
    await requestDeepgramToken({ mode: 'microphone', cacheRef: mic })
    await requestDeepgramToken({ mode: 'system_audio', cacheRef: system })
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})
