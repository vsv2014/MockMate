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

  it('handles split CRLF and CR-only empty line delimiters', () => {
    const one = splitSseBuffer('event: token\r\ndata: "hello"\r')
    expect(one.events).toHaveLength(0)
    expect(splitSseBuffer(one.rest + '\n\r\n').events[0].data).toBe('hello')
    expect(splitSseBuffer('event: token\rdata: "hello"\r\r').events[0].data).toBe('hello')
  })
})
