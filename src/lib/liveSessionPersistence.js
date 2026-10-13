// Transitional localStorage preservation. SQLite/outbox migration is separate.
import { activeAccountScope } from './accountScope.js'
import { saveSessionAsync } from '../history.js'
import { clearLiveCheckpoint, loadLiveCheckpoint } from './liveCheckpoint.js'
import { diagnostic } from './diagnostics.js'

export async function preserveLiveSession({ runId, conversation = [], report, config, profile,
  captureStatus = 'captured', evaluationStatus = 'failed', final = false },
  { save = saveSessionAsync, clear = clearLiveCheckpoint, readCheckpoint = loadLiveCheckpoint, log = diagnostic } = {}) {
  const scope = activeAccountScope()
  if (!runId) throw new Error('Live preservation requires runId')
  const fallbackReport = {
    overallScore: null, dimensions: [], strengths: [], improvements: [],
    summary: evaluationStatus === 'pending' ? 'Transcript preserved. Evaluation pending.'
      : evaluationStatus === 'not_requested' ? 'Live session started. No evaluation yet.'
      : evaluationStatus === 'cancelled' ? 'Evaluation cancelled. Transcript preserved.'
      : 'No score is available. Transcript preserved.',
  }
  const { _storageWarning: previousWarning, ...effectiveReport } = report || fallbackReport
  void previousWarning
  const payload = { runId, captureStatus, evaluationStatus, report: effectiveReport,
    transcript: conversation, config, profile }
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
  log('session', 'history_commit_started', { runId, captureStatus, evaluationStatus, bytes })
  let stored = null
  try { stored = await save(payload) } catch {}
  if (scope !== activeAccountScope()) stored = null
  log('session', stored ? 'history_commit_succeeded' : 'history_commit_failed', {
    runId, captureStatus, evaluationStatus, bytes, ...(!stored ? { errorCode: 'local_write_failed' } : {}),
  }, stored ? 'info' : 'error')
  let warning = !stored ? 'This session could not be saved. Recovery was retained where available; copy the transcript before leaving this screen.' : ''
  if (stored?.storagePruned) warning = `Saved after removing ${stored.storagePruned} oldest local sessions to free space.`
  if (stored && final) {
    const checkpoint = readCheckpoint()
    // Finishing a new run must not erase an older run's still-recoverable feed.
    if (checkpoint && checkpoint.sessionId !== runId) {
      log('session', 'checkpoint_retained_other_run', { runId })
      return { stored, report: warning ? { ...effectiveReport, _storageWarning: warning } : effectiveReport }
    }
    const cleared = clear()
    log('session', cleared ? 'checkpoint_clear_succeeded' : 'checkpoint_clear_failed', { runId }, cleared ? 'info' : 'warn')
    if (!cleared) warning = [warning, 'Saved to History, but recovery cleanup failed.'].filter(Boolean).join(' ')
  }
  return { stored, report: warning ? { ...effectiveReport, _storageWarning: warning } : effectiveReport }
}
