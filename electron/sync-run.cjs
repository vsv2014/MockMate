// Metadata-only, encrypted-vault-backed synchronization run state.
// The owner vault holds these records; no remote text or access tokens are
// copied into the run history.
const { randomBytes } = require('node:crypto')

const MAX_RUNS = 20
const RUN_STATES = new Set(['checking', 'awaiting_apply', 'needs_attention',
  'completed', 'partial', 'paused', 'interrupted', 'superseded'])

function newSyncRun({ now = Date.now(), manual = false, selected = 0, targeted = false } = {}) {
  return {
    id: 'sync_' + now.toString(36) + '_' + randomBytes(4).toString('hex'),
    status: 'checking', startedAt: new Date(now).toISOString(), finishedAt: null,
    trigger: manual ? 'manual' : 'scheduled', targeted: !!targeted,
    selected, checked: 0, changed: 0, failures: 0, pending: 0, applied: 0,
  }
}
function beginRun(ownerState, run, { currentlyActive = false } = {}) {
  if (!ownerState || !RUN_STATES.has(run.status)) throw new Error('Invalid sync run')
  ownerState.syncRuns = Array.isArray(ownerState.syncRuns) ? ownerState.syncRuns : []
  if (!currentlyActive) {
    for (const old of ownerState.syncRuns) {
      if (old.status === 'checking') {
        old.status = 'interrupted'
        old.finishedAt = null
      }
    }
  }
  ownerState.syncRuns.unshift(run)
  ownerState.syncRuns = ownerState.syncRuns.slice(0, MAX_RUNS)
  return run
}
function finishRun(run, { checked = 0, changed = 0, failures = 0, paused = false, at = Date.now() } = {}) {
  if (!run || run.status !== 'checking') throw new Error('Sync run is not in progress')
  run.checked = checked
  run.changed = changed
  run.failures = failures
  run.pending = changed
  run.status = failures > 0 ? 'partial'
    : paused ? 'paused'
      : changed > 0 ? 'awaiting_apply' : 'completed'
  run.finishedAt = run.pending === 0 ? new Date(at).toISOString() : null
  return run
}
function acknowledgeRun(state, runId, { at = Date.now(), failed = false } = {}) {
  if (!runId) return null
  const run = (state.syncRuns || []).find(item => item.id === runId)
  if (!run) return null
  if (failed) {
    run.status = 'needs_attention'
    return run
  }
  if (run.pending > 0) {
    run.pending -= 1
    run.applied += 1
  }
  if (run.pending === 0) {
    run.status = run.failures ? 'partial' :
      run.status === 'interrupted' ? 'completed' : 'completed'
    run.finishedAt = new Date(at).toISOString()
  }
  return run
}
function publicSyncRuns(state, { active = false } = {}) {
  return (state.syncRuns || []).slice(0, MAX_RUNS).map(run => ({
    ...run,
    status: run.status === 'checking' && !active ? 'interrupted' : run.status,
  }))
}
module.exports = { newSyncRun, beginRun, finishRun, acknowledgeRun, publicSyncRuns }
