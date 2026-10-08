import { describe, it, expect, vi } from 'vitest'
import {
  MAX_QUEUE_BYTES,
  computeReconnectDelayMs,
  buildDeepgramListenUrl,
  abandonDeepgramSocket,
  enqueueOrSendPcm,
  flushQueuedPcm,
} from './deepgramTransport'

describe('deepgramTransport shared helpers', () => {
  it('queues a PCM frame if WebSocket send throws during close', () => {
    const frame = new Uint8Array([1, 2]).buffer
    const refs = {
      wsRef: { current: { readyState: 1, send: () => { throw new Error('closed') } } },
      pcmQueueRef: { current: [] },
      pcmQueueBytesRef: { current: 0 },
      pcmDroppedBytesRef: { current: 0 },
    }
    expect(() => enqueueOrSendPcm(frame, refs)).not.toThrow()
    expect(refs.pcmQueueRef.current).toEqual([frame])
    expect(refs.pcmQueueBytesRef.current).toBe(2)
  })

  it('computes exponential reconnect backoff capped at 8000ms', () => {
    expect(computeReconnectDelayMs(1)).toBe(500)
    expect(computeReconnectDelayMs(2)).toBe(1000)
    expect(computeReconnectDelayMs(3)).toBe(2000)
    expect(computeReconnectDelayMs(5)).toBe(8000)
    expect(computeReconnectDelayMs(20)).toBe(8000)
  })

  it('builds Deepgram listen URLs for microphone and diarized system audio', () => {
    const micUrl = buildDeepgramListenUrl({ degraded: false, language: 'en-US', diarize: false })
    expect(micUrl).toContain('model=nova-3')
    expect(micUrl).not.toContain('diarize=true')

    const liveUrl = buildDeepgramListenUrl({
      degraded: false,
      language: 'en-US',
      diarize: true,
      keyterms: ['Kafka', 'PgBouncer'],
    })
    expect(liveUrl).toContain('model=nova-3')
    expect(liveUrl).toContain('&diarize=true')
    expect(liveUrl).toContain('&keyterm=Kafka')

    const degradedUrl = buildDeepgramListenUrl({
      degraded: true,
      language: 'en-US',
      diarize: true,
      keyterms: ['Kafka'],
    })
    expect(degradedUrl).toContain('model=nova-2')
    expect(degradedUrl).toContain('&diarize=true')
    expect(degradedUrl).not.toContain('&keyterm=Kafka')
  })

  it('queues PCM frames while socket is closed, sheds oldest beyond MAX_QUEUE_BYTES, and flushes FIFO', () => {
    const wsRef = { current: null }
    const pcmQueueRef = { current: [] }
    const pcmQueueBytesRef = { current: 0 }
    const pcmDroppedBytesRef = { current: 0 }

    const halfCap = new Uint8Array(Math.floor(MAX_QUEUE_BYTES * 0.6)).buffer
    enqueueOrSendPcm(halfCap, { wsRef, pcmQueueRef, pcmQueueBytesRef, pcmDroppedBytesRef })
    enqueueOrSendPcm(halfCap, { wsRef, pcmQueueRef, pcmQueueBytesRef, pcmDroppedBytesRef })

    expect(pcmQueueRef.current.length).toBe(1)
    expect(pcmDroppedBytesRef.current).toBe(halfCap.byteLength)

    const send = vi.fn()
    flushQueuedPcm({
      sock: { send },
      pcmQueueRef,
      pcmQueueBytesRef,
      pcmDroppedBytesRef,
      mode: 'microphone',
      model: 'nova-3',
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(pcmQueueRef.current.length).toBe(0)
    expect(pcmQueueBytesRef.current).toBe(0)
    expect(pcmDroppedBytesRef.current).toBe(0)
  })

  it('abandons an active Deepgram socket cleanly and clears refs', () => {
    const send = vi.fn()
    const close = vi.fn()
    const sock = { readyState: 1, send, close, onclose: () => {}, onmessage: () => {} }
    const activeSocketRef = { current: sock }
    const wsRef = { current: sock }
    abandonDeepgramSocket(sock, activeSocketRef, wsRef)
    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'CloseStream' }))
    expect(close).toHaveBeenCalledTimes(1)
    expect(activeSocketRef.current).toBeNull()
    expect(wsRef.current).toBeNull()
  })
})
