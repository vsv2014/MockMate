import { describe, expect, it, vi } from 'vitest'
import { verifyReadyRoomLiveStream } from './readyRoomAiProbe.js'

const body = { question: 'Why does clear communication matter?', autoSkip: false }
const runEvents = (events, mode = 'stream') => vi.fn(async ({ onEvent }) => {
  for (const event of events) await onEvent(event)
  return { mode }
})

describe('Ready Room Live streaming verification', () => {
  it('passes only when the Live stream produces visible text and a done event', async () => {
    const runStream = runEvents([
      { event: 'meta', data: { type: 'technical' } },
      { event: 'token', data: 'Clear communication ' },
      { event: 'token', data: 'prevents misunderstandings.' },
      { event: 'done', data: {} },
    ])
    await expect(verifyReadyRoomLiveStream({ body, runStream })).resolves.toEqual({
      ok: true, completed: true,
    })
    expect(runStream).toHaveBeenCalledWith(expect.objectContaining({ body }))
  })

  it('rejects HTTP-200-shaped partial output without a done event', async () => {
    const runStream = runEvents([{ event: 'token', data: 'Partial answer' }])
    await expect(verifyReadyRoomLiveStream({ body, runStream })).rejects.toMatchObject({
      code: 'stream_incomplete',
    })
  })

  it('rejects an error after partial output even if a transport reports stream mode', async () => {
    const runStream = runEvents([
      { event: 'token', data: 'Partial answer' },
      { event: 'error', data: { error: 'Provider disconnected', code: 'provider_error' } },
    ])
    await expect(verifyReadyRoomLiveStream({ body, runStream })).rejects.toMatchObject({
      code: 'provider_error',
    })
  })

  it('does not mistake leaked inline metadata for a visible streaming answer', async () => {
    const runStream = runEvents([
      { event: 'token', data: 'META: {"type":"technical","confidence":"general"}' },
      { event: 'done', data: {} },
    ])
    await expect(verifyReadyRoomLiveStream({ body, runStream })).rejects.toMatchObject({
      code: 'empty_output',
    })
  })

  it('rejects completed streams with no readable answer or only metadata', async () => {
    const runStream = runEvents([
      { event: 'meta', data: { type: 'technical' } },
      { event: 'done', data: {} },
    ])
    await expect(verifyReadyRoomLiveStream({ body, runStream })).rejects.toMatchObject({
      code: 'empty_output',
    })
  })

  it('rejects skipped questions and prevents a blocking paid fallback', async () => {
    await expect(verifyReadyRoomLiveStream({
      body, runStream: runEvents([{ event: 'skip', data: {} }]),
    })).rejects.toMatchObject({ code: 'unexpected_skip' })

    await expect(verifyReadyRoomLiveStream({
      body, runStream: async ({ onFallback }) => onFallback(),
    })).rejects.toMatchObject({ code: 'stream_unavailable' })
  })

  it('never passes if the test was aborted before stream verification', async () => {
    const controller = new AbortController()
    const runStream = async ({ onEvent }) => {
      await onEvent({ event: 'token', data: 'A real answer' })
      await onEvent({ event: 'done', data: {} })
      controller.abort()
      return { mode: 'stream' }
    }
    await expect(verifyReadyRoomLiveStream({
      body, signal: controller.signal, runStream,
    })).rejects.toMatchObject({ code: 'stream_aborted', name: 'AbortError' })
  })
})
