import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { newSyncRun, beginRun, finishRun, acknowledgeRun, publicSyncRuns } = require('./sync-run.cjs')

describe('durable approved-source sync run state machine', () => {
  const time = Date.parse('2026-11-10T09:00:00Z')
  it('does not claim completed when source content still needs local application', () => {
    const state = { syncRuns: [] }
    const run = beginRun(state, newSyncRun({ now: time, selected: 3 }))
    finishRun(run, { checked: 3, changed: 2, failures: 0, at: time + 100 })
    expect(run).toMatchObject({ status: 'awaiting_apply', pending: 2, applied: 0, finishedAt: null })
    acknowledgeRun(state, run.id, { at: time + 200 })
    expect(run).toMatchObject({ status: 'awaiting_apply', pending: 1, applied: 1 })
    acknowledgeRun(state, run.id, { at: time + 300 })
    expect(run).toMatchObject({ status: 'completed', pending: 0, applied: 2 })
    expect(run.finishedAt).toBe(new Date(time + 300).toISOString())
  })
  it('preserves interrupted runs after crash and never fabricates an acknowledgment', () => {
    const state = { syncRuns: [] }
    const run = beginRun(state, newSyncRun({ now: time, selected: 10 }))
    expect(publicSyncRuns(state)[0].status).toBe('interrupted')
    expect(run.status).toBe('checking')
    beginRun(state, newSyncRun({ now: time + 500, manual: true }))
    expect(run.status).toBe('interrupted')
    expect(run.applied).toBe(0)
  })
  it('preserves failures and a pending apply as incomplete', () => {
    const state = { syncRuns: [] }
    const run = beginRun(state, newSyncRun({ now: time, selected: 2 }))
    finishRun(run, { checked: 2, changed: 1, failures: 1 })
    expect(run.status).toBe('partial')
    expect(run.finishedAt).toBeNull()
    acknowledgeRun(state, run.id)
    expect(run.status).toBe('partial')
    expect(run.finishedAt).toBeTruthy()
  })
  it('marks a failed local save as needing attention, leaving source pending', () => {
    const state = { syncRuns: [] }
    const run = beginRun(state, newSyncRun({ now: time, targeted: true }))
    finishRun(run, { checked: 1, changed: 1 })
    acknowledgeRun(state, run.id, { failed: true })
    expect(run.status).toBe('needs_attention')
    expect(run.pending).toBe(1)
  })
})
