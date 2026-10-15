import { beforeEach, describe, expect, it, vi } from 'vitest'
import { preserveLiveSession } from './liveSessionPersistence.js'
import { loadSessions } from '../history.js'
import { scopedKey, setActiveAccountScope } from './accountScope.js'

const values = new Map()
const sessionValues = new Map()
vi.stubGlobal('sessionStorage', { getItem: key => sessionValues.get(key) ?? null,
  setItem: (key, value) => sessionValues.set(key, String(value)), removeItem: key => sessionValues.delete(key) })
vi.stubGlobal('localStorage', { getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) })
const deps = { clear: vi.fn(() => true), readCheckpoint: () => null, log: vi.fn() }
const base = { runId: 'stable-run', config: { interviewSetup: { source: 'live' } } }
beforeEach(() => { values.clear(); setActiveAccountScope('guest'); vi.clearAllMocks() })

describe('Live preservation independent of scoring', async () => {
  it('updates one Start row through captured and scored, preserving its original timestamp', async () => {
    const start = await preserveLiveSession({ ...base, captureStatus: 'provisional', evaluationStatus: 'not_requested' }, deps)
    const conversation = [{ role: 'candidate', text: 'My answer' }]
    await preserveLiveSession({ ...base, conversation, evaluationStatus: 'pending' }, deps)
    expect(deps.clear).not.toHaveBeenCalled()
    await preserveLiveSession({ ...base, conversation, evaluationStatus: 'scored', report: { overallScore: 0 }, final: true }, deps)
    expect(loadSessions()).toHaveLength(1)
    expect(loadSessions()[0]).toMatchObject({ id: 'stable-run', runId: 'stable-run', ts: start.stored.ts,
      score: 0, evaluationStatus: 'scored', transcript: conversation, mode: 'live' })
    expect(deps.clear).toHaveBeenCalledOnce()
  })
  it.each(['not_applicable', 'failed', 'cancelled'])('persists unscored %s sessions without inventing candidate evidence', async status => {
    const conversation = [{ role: 'interviewer', text: 'Design RAG' }, { role: 'hint', text: 'Suggested answer' }]
    const result = await preserveLiveSession({ ...base, conversation, evaluationStatus: status, final: true }, deps)
    expect(result.stored.score).toBeNull()
    expect(loadSessions()[0].transcript).toEqual(conversation)
    expect(loadSessions()[0].evaluationStatus).toBe(status)
  })
  it('retains checkpoint on quota failure and surfaces warning; retry updates same run', async () => {
    const original = localStorage.setItem
    localStorage.setItem = () => { throw new Error('quota') }
    let result
    try { result = await preserveLiveSession({ ...base, conversation: [{ role: 'candidate', text: 'Answer' }], final: true }, deps) }
    finally { localStorage.setItem = original }
    expect(result.stored).toBeNull()
    expect(result.report._storageWarning).toContain('could not be saved')
    expect(deps.clear).not.toHaveBeenCalled()
    const retry = await preserveLiveSession({ ...base, report: result.report, final: true }, deps)
    expect(retry.report._storageWarning).toBeUndefined()
    expect(loadSessions()).toHaveLength(1)
  })
  it('does not delete an older run checkpoint when the new run finishes', async () => {
    await preserveLiveSession({ ...base, final: true }, { ...deps, readCheckpoint: () => ({ sessionId: 'older-run' }) })
    expect(loadSessions()).toHaveLength(1)
    expect(deps.clear).not.toHaveBeenCalled()
  })
  it('does not acknowledge a dropped storage write or clear recovery', async () => {
    const original = localStorage.setItem
    localStorage.setItem = () => {}
    try {
      expect((await preserveLiveSession({ ...base, final: true }, deps)).stored).toBeNull()
      expect(deps.clear).not.toHaveBeenCalled()
    } finally { localStorage.setItem = original }
  })
  it('reports a failed cleanup separately after History commit and preserves account isolation', async () => {
    const result = await preserveLiveSession({ ...base, final: true }, { ...deps, clear: () => false })
    expect(result.stored).not.toBeNull()
    expect(result.report._storageWarning).toContain('cleanup failed')
    expect(values.get(scopedKey('mm-sessions'))).toContain('stable-run')
    setActiveAccountScope('another-account')
    expect(loadSessions()).toEqual([])
  })
})
