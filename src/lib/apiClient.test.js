import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./aiMode', () => ({ isManaged: () => false }))
vi.mock('../auth/api', () => ({ getToken: async () => null }))

import { apiFetch } from './apiClient.js'

describe('apiFetch timeoutMs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('aborts when timeoutMs elapses', async () => {
    vi.useFakeTimers()
    fetch.mockImplementation((_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }))

    const p = apiFetch('/api/interview', { method: 'POST', timeoutMs: 1000 })
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('passes through without timeout when timeoutMs unset', async () => {
    fetch.mockResolvedValue({ ok: true })
    await apiFetch('/api/x', { method: 'GET' })
    expect(fetch).toHaveBeenCalledOnce()
    const opts = fetch.mock.calls[0][1]
    expect(opts.signal).toBeUndefined()
  })
})
