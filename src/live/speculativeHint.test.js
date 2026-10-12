import { describe, expect, it, vi } from 'vitest'
import { createSpeculativeHint } from './speculativeHint.js'

function setup(overrides = {}) {
  const fetches = []
  const events = []
  const timers = []
  const fetchImpl = vi.fn((path, init) => {
    fetches.push({ path, init })
    return Promise.resolve({ ok: true, status: 200, body: null, init })
  })
  const early = createSpeculativeHint({
    fetchImpl,
    now: () => 1_000,
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeoutFn: () => {},
    onEvent: e => events.push(e),
    ...overrides,
  })
  return { early, fetches, events, timers, fetchImpl }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('createSpeculativeHint', () => {
  it('hands over the in-flight request only for the identical key and body', async () => {
    const { early, fetches, events } = setup()
    const ticket = early.prepare('what is cap theorem')
    expect(early.start(ticket, { key: 'what is cap theorem', bodyJson: '{"q":1}' })).toBe(true)
    await flush()
    expect(fetches).toHaveLength(1)
    expect(fetches[0].path).toBe('/api/hint-stream')
    expect(fetches[0].init).toMatchObject({ method: 'POST', body: '{"q":1}' })

    const claimed = early.claim({ key: 'what is cap theorem', bodyJson: '{"q":1}' })
    expect(claimed).toBeTruthy()
    await expect(claimed.response).resolves.toMatchObject({ ok: true })
    expect(fetches[0].init.signal.aborted).toBe(false)
    expect(events.map(e => e.outcome)).toEqual(['started', 'claimed'])
    expect(early.activeKey()).toBeNull()
  })

  it('aborts instead of handing over when the question or the context changed', async () => {
    const { early, fetches, events } = setup()
    early.start(early.prepare('a'), { key: 'a', bodyJson: '{"history":1}' })
    await flush()
    expect(early.claim({ key: 'a', bodyJson: '{"history":2}' })).toBeNull()
    expect(fetches[0].init.signal.aborted).toBe(true)
    expect(events.at(-1)).toMatchObject({ outcome: 'cancelled', reason: 'context_changed' })

    early.start(early.prepare('b'), { key: 'b', bodyJson: '{}' })
    await flush()
    expect(early.claim({ key: 'c', bodyJson: '{}' })).toBeNull()
    expect(fetches[1].init.signal.aborted).toBe(true)
    expect(events.at(-1)).toMatchObject({ reason: 'question_changed' })
  })

  it('cancels when the captured text moves on and ignores the unchanged text', async () => {
    const { early, fetches } = setup()
    early.start(early.prepare('design a cache'), { key: 'design a cache', bodyJson: '{}' })
    await flush()
    expect(early.cancelUnlessKey('design a cache')).toBe(false)
    expect(fetches[0].init.signal.aborted).toBe(false)
    expect(early.cancelUnlessKey('design a cache for a million users')).toBe(true)
    expect(fetches[0].init.signal.aborted).toBe(true)
  })

  it('never starts a request whose preparation was superseded or abandoned', async () => {
    const { early, fetchImpl } = setup()
    const first = early.prepare('first')
    const second = early.prepare('second')          // supersedes the first preparation
    expect(early.start(first, { key: 'first', bodyJson: '{}' })).toBe(false)
    expect(early.abandon(first)).toBe(false)         // a stale ticket cannot cancel newer work
    expect(early.activeKey()).toBe('second')
    expect(early.abandon(second, 'retrieval_unavailable')).toBe(true)
    expect(early.start(second, { key: 'second', bodyJson: '{}' })).toBe(false)
    await flush()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('drops a preparation that has not started yet when the question commits', () => {
    const { early, events } = setup()
    early.prepare('slow retrieval question')
    expect(early.claim({ key: 'slow retrieval question', bodyJson: '{}' })).toBeNull()
    expect(events.at(-1)).toMatchObject({ outcome: 'cancelled', reason: 'not_ready', phase: 'preparing' })
  })

  it('expires an unclaimed request so a rejected question does not keep generating', async () => {
    const { early, fetches, timers, events } = setup({ maxAgeMs: 5_000 })
    early.start(early.prepare('q'), { key: 'q', bodyJson: '{}' })
    await flush()
    expect(timers[0].ms).toBe(5_000)
    timers[0].fn()
    expect(fetches[0].init.signal.aborted).toBe(true)
    expect(events.at(-1)).toMatchObject({ outcome: 'cancelled', reason: 'expired' })
    expect(early.claim({ key: 'q', bodyJson: '{}' })).toBeNull()
  })
})
