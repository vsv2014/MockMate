import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./aiMode', () => ({ isManaged: vi.fn(() => false) }))
vi.mock('../auth/api', () => ({ getToken: async () => null }))

import { isManaged } from './aiMode'
import { apiFetch } from './apiClient.js'

describe('apiFetch timeoutMs', () => {
  beforeEach(() => {
    isManaged.mockReturnValue(false)
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

  it('keeps key checks local even when Managed AI is selected', async () => {
    isManaged.mockReturnValue(true)
    fetch.mockResolvedValue({ ok: true })
    await apiFetch('/api/providers', { localOnly: true })
    expect(fetch.mock.calls[0][0]).toBe('/api/providers')
    expect(fetch.mock.calls[0][1].localOnly).toBeUndefined()
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('passes through without timeout when timeoutMs unset', async () => {
    fetch.mockResolvedValue({ ok: true })
    await apiFetch('/api/x', { method: 'GET' })
    expect(fetch).toHaveBeenCalledOnce()
    const opts = fetch.mock.calls[0][1]
    expect(opts.signal).toBeUndefined()
  })

  it('still cancels response-body work when the caller aborts after headers arrive', async () => {
    const controller = new AbortController()
    fetch.mockImplementation(async (_url, { signal }) => new Response(new ReadableStream({
      start(body) {
        body.enqueue(new TextEncoder().encode('{"report":'))
        signal.addEventListener('abort', () => body.error(signal.reason), { once: true })
      },
    })))
    const response = await apiFetch('/api/evaluate', { timeoutMs: 45000, signal: controller.signal })
    const requestSignal = fetch.mock.calls[0][1].signal
    expect(requestSignal.aborted).toBe(false)
    controller.abort()
    expect(requestSignal.aborted).toBe(true)
    await expect(response.json()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('preserves an already aborted caller signal when a timeout is requested', async () => {
    const controller = new AbortController()
    controller.abort()
    fetch.mockImplementation(async (_url, { signal }) => signal.throwIfAborted())
    await expect(apiFetch('/api/evaluate', { timeoutMs: 45000, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})
