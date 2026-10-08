import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../lib/apiClient.js'
import { streamLiveHint, splitSseBuffer } from './hintTransport.js'

vi.mock('../lib/apiClient.js', () => ({ apiFetch: vi.fn() }))

function streamedResponse(chunks) {
  return { ok: true, status: 200, body: new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  }) }
}

describe('Live hint stream completion safety', () => {
  beforeEach(() => vi.resetAllMocks())

  it('requires a done event before reporting stream success', async () => {
    apiFetch.mockResolvedValue(streamedResponse([
      'event: token\ndata: "partial"\n\n',
    ]))
    const events = []
    const result = await streamLiveHint({ body: { question: 'Q' }, onEvent: ev => { events.push(ev) } })
    expect(result.mode).toBe('incomplete')
    expect(events.map(ev => ev.event)).toEqual(['token', 'error'])
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('accepts fully completed event streams', async () => {
    apiFetch.mockResolvedValue(streamedResponse([
      'event: token\ndata: "complete"\n\n',
      'event: done\ndata: {}\n\n',
    ]))
    const events = []
    const result = await streamLiveHint({ body: { question: 'Q' }, onEvent: ev => { events.push(ev) } })
    expect(result.mode).toBe('stream')
    expect(events.map(ev => ev.event)).toEqual(['token', 'done'])
  })

  it('returns stopped on explicit skip, never falling back', async () => {
    apiFetch.mockResolvedValue(streamedResponse(['event: skip\ndata: {}\n\n']))
    const result = await streamLiveHint({
      body: { question: 'Q' }, onEvent: ev => ev.event === 'skip' ? 'stop' : null,
    })
    expect(result.mode).toBe('stopped')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('does not silently succeed when a stream ends without any event', async () => {
    apiFetch.mockResolvedValue(streamedResponse([]))
    const events = []
    const result = await streamLiveHint({ body: {}, onEvent: ev => { events.push(ev.event) } })
    expect(result.mode).toBe('incomplete')
    expect(events).toEqual(['error'])
  })

  it('does not dispatch an error after the request is aborted', async () => {
    const signal = new AbortController()
    apiFetch.mockImplementation(async () => {
      signal.abort()
      return streamedResponse([])
    })
    const onEvent = vi.fn()
    const result = await streamLiveHint({ body: {}, signal: signal.signal, onEvent })
    expect(result.mode).toBe('aborted')
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('rejects quota and server errors without starting a second LLM request', async () => {
    for (const status of [401, 402, 403, 429, 500]) {
      apiFetch.mockReset()
      apiFetch.mockResolvedValue({ ok: false, status, clone: () => ({
        json: async () => ({ error: 'unavailable' }),
      }) })
      await expect(streamLiveHint({ body: { question: 'Q' } })).rejects.toMatchObject({ status })
      expect(apiFetch).toHaveBeenCalledTimes(1)
    }
  })

  it('runs exactly one compatibility fallback when streaming endpoint is missing', async () => {
    apiFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ hint: { fullAnswer: 'fallback' } }) })
    const events = []
    const result = await streamLiveHint({
      body: { question: 'Q' }, onEvent: ev => { events.push(ev) },
    })
    expect(result.mode).toBe('fallback')
    expect(events.map(ev => ev.event)).toEqual(['fallback'])
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('never issues a second paid hint request on HTTP 200 with an empty stream body', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, body: null })
    const onEvent = vi.fn()
    const onFallback = vi.fn()
    const result = await streamLiveHint({
      body: { question: 'How do you design a retry?' },
      onEvent,
      onFallback,
    })
    expect(result.mode).toBe('incomplete')
    expect(onEvent).toHaveBeenCalledWith({
      event: 'error',
      data: { error: expect.stringContaining('no content') },
    })
    expect(onFallback).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('does not emit errors for a stale aborted no-body stream', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, body: null })
    const ac = new AbortController()
    ac.abort()
    const onEvent = vi.fn()
    const result = await streamLiveHint({ body: {}, signal: ac.signal, onEvent })
    expect(result.mode).toBe('aborted')
    expect(onEvent).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('handles split CRLF and CR-only empty line delimiters', () => {
    const one = splitSseBuffer('event: token\r\ndata: "hello"\r')
    expect(one.events).toHaveLength(0)
    expect(splitSseBuffer(one.rest + '\n\r\n').events[0].data).toBe('hello')
    expect(splitSseBuffer('event: token\rdata: "hello"\r\r').events[0].data).toBe('hello')
  })
})
