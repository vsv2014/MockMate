import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_CHECKPOINT_KEY, LIVE_CHECKPOINT_TTL_MS, clearLiveCheckpoint,
  loadLiveCheckpoint, saveLiveCheckpoint, checkpointToConversation,
  normalizeLiveCheckpointRows,
} from './liveCheckpoint.js'
import { scopedKey, setActiveAccountScope } from './accountScope.js'

const local = new Map()
const session = new Map()
let quota = Infinity

vi.stubGlobal('localStorage', {
  getItem: key => local.get(key) ?? null,
  setItem: (key, value) => {
    if (String(value).length > quota) throw new Error('QuotaExceededError')
    local.set(key, String(value))
  },
  removeItem: key => { local.delete(key) },
  key: i => [...local.keys()][i] ?? null,
  get length() { return local.size },
})
vi.stubGlobal('sessionStorage', {
  getItem: key => session.get(key) ?? null,
  setItem: (key, value) => session.set(key, String(value)),
  removeItem: key => session.delete(key),
})

const first = {
  text: 'Explain transaction isolation', questionId: 'q1', isQuestion: true, ts: 1,
  answer: 'Serializable is safest.', hint: {
    opener: 'Isolation controls visibility',
    keyPoints: ['Dirty reads', 'Phantoms'],
    fullAnswer: 'Serializable is safest.',
    provider_secret: 'should never persist',
  },
  profile: { resume: 'Private CV' },
  authorization: 'Bearer secret',
}
const at = 1_789_000_000_000

describe('Live interview crash checkpoint (read-only recovery)', () => {
  beforeEach(() => {
    local.clear()
    session.clear()
    quota = Infinity
    setActiveAccountScope('account-a')
  })

  it('persists only bounded question/answer fields and never arbitrary provider details', () => {
    expect(saveLiveCheckpoint({ sessionId: 'session-1', transcript: [first] }, at)).toBe(true)
    const raw = local.get(scopedKey(LIVE_CHECKPOINT_KEY))
    expect(raw).not.toContain('Private CV')
    expect(raw).not.toContain('Bearer secret')
    expect(raw).not.toContain('should never persist')
    const loaded = loadLiveCheckpoint(at + 2_000)
    expect(loaded.transcript[0].text).toBe('Explain transaction isolation')
    expect(loaded.transcript[0].hint.keyPoints).toEqual(['Dirty reads', 'Phantoms'])
    expect(checkpointToConversation(loaded).map(x => x.role)).toEqual(['interviewer', 'hint'])
  })

  it('does not leak recovered notes when switching account scopes', () => {
    saveLiveCheckpoint({ sessionId: 'a', transcript: [first] }, at)
    setActiveAccountScope('account-b')
    expect(loadLiveCheckpoint(at + 1000)).toBeNull()
    expect(saveLiveCheckpoint({ sessionId: 'b', transcript: [
      { isQuestion: true, text: 'Other account question', answer: 'Other answer' },
    ] }, at)).toBe(true)
    setActiveAccountScope('account-a')
    expect(loadLiveCheckpoint(at + 1000).sessionId).toBe('a')
    clearLiveCheckpoint()
    expect(loadLiveCheckpoint(at + 1000)).toBeNull()
    setActiveAccountScope('account-b')
    expect(loadLiveCheckpoint(at + 1000).sessionId).toBe('b')
  })

  it('purges stale or corrupt recovery files without exposing them', () => {
    saveLiveCheckpoint({ sessionId: 'test', transcript: [first] }, at)
    expect(loadLiveCheckpoint(at + LIVE_CHECKPOINT_TTL_MS + 1)).toBeNull()
    expect(local.has(scopedKey(LIVE_CHECKPOINT_KEY))).toBe(false)
    local.set(scopedKey(LIVE_CHECKPOINT_KEY), '{"not-valid":')
    expect(loadLiveCheckpoint(at + 1000)).toBeNull()
    expect(local.has(scopedKey(LIVE_CHECKPOINT_KEY))).toBe(false)
  })

  it('keeps recent entries when local storage quota rejects a larger checkpoint', () => {
    const transcript = Array.from({ length: 70 }, (_, i) => ({
      text: 'Question ' + i + ' '.repeat(160), isQuestion: true,
      answer: 'Answer ' + i + ' '.repeat(180), questionId: 'q' + i,
    }))
    quota = 5_000
    expect(saveLiveCheckpoint({ sessionId: 'recent', transcript }, at)).toBe(true)
    const restored = loadLiveCheckpoint(at + 500)
    expect(restored.transcript.length).toBeLessThan(60)
    expect(restored.transcript.at(-1).questionId).toBe('q69')
    expect(restored.transcript[0].questionId).not.toBe('q0')
  })

  it('rejects empty feeds, truncates oversized strings and ignores non-question objects', () => {
    expect(saveLiveCheckpoint({ sessionId: 's', transcript: [] }, at)).toBe(false)
    const normalized = normalizeLiveCheckpointRows([
      null, { isQuestion: false, text: 'private transcript fragment' },
      { isQuestion: true, text: 'Q'.repeat(20_000), answer: 'A'.repeat(30_000) },
    ])
    expect(normalized).toHaveLength(1)
    expect(normalized[0].text).toHaveLength(3000)
    expect(normalized[0].answer).toHaveLength(12000)
  })
})
