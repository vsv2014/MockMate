/**
 * Question boundary detection + stabilization (M2).
 * Does NOT commit solely because Deepgram emitted one final fragment.
 */

import { normalizeCaptureText, isDuplicateQuestion } from './transcriptBuffer.js'

export const QUESTION_CAPTURE_VERSION = 'question_capture_v1'

/** Incomplete / wait-for-more shapes */
const INCOMPLETE_OPENERS = /^(can you design|how would you design|how would you|what about|how about|tell me about(?: a time)?|tell me about|walk me through|describe|explain|why(?:\s+\w+)?|what are|what is|what was|given an|design a|design an|let'?s (?:start|switch|do)|okay\.?\s*(?:forget|let'?s)?)$/i
const INCOMPLETE_TRAILING = /\b(design a|design an|tell me about(?: a time)?|how would you|what about|can you|walk me through)\s*$/i
const CORRECTION_MARK = /\b(actually|no,?\s*i meant|rather|i mean)\b/i

const INTERROGATIVE = /\b(tell me|describe|explain|how would|how do|how does|what is|what are|what was|what were|what about|how about|walk me|can you|could you|would you|why did|why do|why is|why are|why use|have you|give me|when did|where did|design (?:a|an|the)|given an?)\b/i

/**
 * Measured stabilization windows (ms) — not a blind 2–3s everywhere.
 * Tuned for: fast commit on complete ? ; accumulate on incomplete openers.
 */
export const STABILIZE_MS = {
  completeQuestionMark: 180,
  completeInterrogative: 320,
  likelyComplete: 450,
  incomplete: 900,
  unknownSpeaker: 1100,
  maxAccumulate: 2800,
}

/**
 * @returns {{
 *   action: 'reject'|'wait'|'stabilize'|'commit',
 *   reason: string,
 *   waitMs: number,
 *   confidence: number,
 *   completeness: 'incomplete'|'likely'|'complete',
 * }}
 */
export function assessQuestionBoundary({
  text = '',
  silenceMs = 0,
  isFinal = false,
  speakerRole = 'unknown',
  hadPriorQuestion = false,
  laneAgeMs = 0,
} = {}) {
  const q = String(text || '').trim()
  if (!q) {
    return { action: 'reject', reason: 'empty', waitMs: 0, confidence: 0, completeness: 'incomplete' }
  }

  if (speakerRole === 'candidate') {
    return { action: 'reject', reason: 'candidate_speech', waitMs: 0, confidence: 0, completeness: 'incomplete' }
  }

  const words = q.split(/\s+/).filter(Boolean).length
  const hasQ = /\?\s*$/.test(q)
  const incomplete = isIncompleteUtterance(q)
  const interrogative = INTERROGATIVE.test(q) || hasQ
  const shortFollowUp = words <= 3 && hadPriorQuestion && (hasQ || /^(why|how|and then|what if|what about|how about)\b/i.test(q))

  let completeness = 'incomplete'
  if (!incomplete && (hasQ || (interrogative && words >= 6) || shortFollowUp)) completeness = 'complete'
  else if (!incomplete && interrogative && words >= 4) completeness = 'likely'
  else if (!incomplete && words >= 10 && interrogative) completeness = 'likely'

  if (speakerRole === 'unknown') {
    // Never confidently treat unknown as interviewer on weak evidence.
    if (!(hasQ && words >= 5) && !(interrogative && words >= 8)) {
      if (silenceMs < STABILIZE_MS.unknownSpeaker && laneAgeMs < STABILIZE_MS.maxAccumulate) {
        return {
          action: 'wait',
          reason: 'speaker_unknown',
          waitMs: STABILIZE_MS.unknownSpeaker,
          confidence: 0.25,
          completeness,
        }
      }
      if (!hasQ && words < 8) {
        return { action: 'reject', reason: 'speaker_unknown', waitMs: 0, confidence: 0.2, completeness }
      }
    }
  }

  if (incomplete || completeness === 'incomplete') {
    if (laneAgeMs >= STABILIZE_MS.maxAccumulate && interrogative && words >= 5) {
      return {
        action: 'stabilize',
        reason: 'max_accumulate',
        waitMs: STABILIZE_MS.likelyComplete,
        confidence: 0.55,
        completeness: 'likely',
      }
    }
    return {
      action: 'wait',
      reason: 'incomplete',
      waitMs: STABILIZE_MS.incomplete,
      confidence: 0.35,
      completeness: 'incomplete',
    }
  }

  if (!interrogative && !shortFollowUp && words < 8) {
    return { action: 'reject', reason: 'low_confidence', waitMs: 0, confidence: 0.2, completeness }
  }

  const waitMs = hasQ
    ? STABILIZE_MS.completeQuestionMark
    : completeness === 'complete'
      ? STABILIZE_MS.completeInterrogative
      : STABILIZE_MS.likelyComplete

  // Silence / finality gate
  const silenceOk = silenceMs >= waitMs || (isFinal && silenceMs >= Math.min(waitMs, 200))
  if (!silenceOk && laneAgeMs < STABILIZE_MS.maxAccumulate) {
    return {
      action: 'stabilize',
      reason: hasQ ? 'stabilizing_terminal' : 'stabilizing',
      waitMs,
      confidence: completeness === 'complete' ? 0.8 : 0.6,
      completeness,
    }
  }

  return {
    action: 'commit',
    reason: hasQ ? 'terminal_question' : (shortFollowUp ? 'short_follow_up' : 'semantic_complete'),
    waitMs: 0,
    confidence: completeness === 'complete' ? 0.92 : 0.75,
    completeness,
  }
}

export function isIncompleteUtterance(text) {
  const q = String(text || '').trim().replace(/\s+/g, ' ')
  if (!q) return true
  if (/\?\s*$/.test(q)) return false
  if (INCOMPLETE_OPENERS.test(q)) return true
  if (INCOMPLETE_TRAILING.test(q)) return true
  // Ends mid-phrase without object
  if (/\b(a|an|the|about|design|for|with|to|of)\s*$/i.test(q)) return true
  // "design a booking" without system/app/feature — still incomplete
  if (/\bdesign (?:a|an|the) \w{3,20}$/i.test(q) && !/\b(system|service|app|feature|platform|pipeline|architecture|layer|cache|database)\b/i.test(q)) {
    return true
  }
  // Very short interrogative stem
  const words = q.split(/\s+/).filter(Boolean).length
  if (words <= 3 && /^(what|why|how|can|could|would|tell|describe|explain|design)\b/i.test(q) && !/\?$/.test(q)) {
    return true
  }
  return false
}

/**
 * Apply interviewer self-correction inside one candidate window.
 * "How would you design Redis—actually, how would you design the whole caching layer?"
 */
export function applyUtteranceCorrection(text) {
  const raw = String(text || '').trim()
  if (!CORRECTION_MARK.test(raw)) return raw
  // Prefer text after the last correction marker
  const parts = raw.split(/\b(?:actually|no,?\s*i meant|rather|i mean)\b/i)
  if (parts.length < 2) return raw
  const last = parts[parts.length - 1].replace(/^[\s,.—\-]+/, '').trim()
  return last || raw
}

/**
 * Create capture controller: buffer → candidate → stabilize → commit.
 */
export function createQuestionCaptureController(opts = {}) {
  const {
    buffer,
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (id) => clearTimeout(id),
    now = () => Date.now(),
    onCandidate = () => {},
    onCommitted = () => {},
    onReject = () => {},
    onLive = () => {},
    onDebug = () => {},
    getHadPriorQuestion = () => false,
    getLastCommittedText = () => '',
  } = opts

  let stabilizeTimer = null
  let silenceTimer = null
  let candidate = null // { id, text, speaker, createdAt, revisionCount, status }
  let lastSilenceAt = now()
  const metrics = {
    candidates: 0,
    commits: 0,
    rejects: 0,
    revisions: 0,
    duplicates: 0,
    timeToCommitMs: [],
    candidateDurationMs: [],
  }

  function debug(stage, detail = {}) {
    onDebug({ stage, ts: now(), ...detail })
  }

  function clearTimers() {
    if (stabilizeTimer) { clearTimeoutFn(stabilizeTimer); stabilizeTimer = null }
    if (silenceTimer) { clearTimeoutFn(silenceTimer); silenceTimer = null }
  }

  function ensureCandidate(text, speaker) {
    const cleaned = applyUtteranceCorrection(text)
    if (!candidate) {
      candidate = {
        id: `qc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        text: cleaned,
        rawTranscript: text,
        speaker,
        createdAt: now(),
        revisionCount: 0,
        status: 'candidate',
      }
      metrics.candidates += 1
      onCandidate({ ...candidate })
      debug('QUESTION_CANDIDATE', { questionId: candidate.id, text: cleaned, speaker })
      return candidate
    }
    if (normalizeCaptureText(cleaned) !== normalizeCaptureText(candidate.text)) {
      candidate.text = cleaned
      candidate.rawTranscript = text
      candidate.revisionCount += 1
      candidate.status = 'stabilizing'
      metrics.revisions += 1
      onCandidate({ ...candidate })
      debug('QUESTION_REVISION', { questionId: candidate.id, text: cleaned, revisionCount: candidate.revisionCount })
    }
    return candidate
  }

  function reject(reason, detail = {}) {
    metrics.rejects += 1
    debug('QUESTION_REJECT', { reason, ...detail })
    onReject(reason, detail)
  }

  function commitCurrent(reason) {
    if (!candidate) return null
    const text = applyUtteranceCorrection(candidate.text)
    const last = getLastCommittedText()
    if (last && isDuplicateQuestion(text, last)) {
      metrics.duplicates += 1
      reject('duplicate', { text })
      candidate = null
      buffer.clearLane()
      clearTimers()
      return null
    }
    const committed = {
      ...candidate,
      text,
      normalizedTranscript: normalizeCaptureText(text),
      status: 'committed',
      commitReason: reason,
      committedAt: now(),
      captureLatencyMs: now() - candidate.createdAt,
    }
    metrics.commits += 1
    metrics.timeToCommitMs.push(committed.captureLatencyMs)
    metrics.candidateDurationMs.push(committed.captureLatencyMs)
    debug('QUESTION_COMMITTED', {
      questionId: committed.id,
      text: committed.text,
      reason,
      captureLatencyMs: committed.captureLatencyMs,
      revisions: committed.revisionCount,
    })
    onCommitted(committed)
    candidate = null
    buffer.clearLane()
    clearTimers()
    return committed
  }

  function scheduleEvaluate(waitMs) {
    clearTimers()
    const w = Math.max(50, waitMs || STABILIZE_MS.likelyComplete)
    stabilizeTimer = setTimeoutFn(() => {
      stabilizeTimer = null
      evaluate({ silenceMs: now() - lastSilenceAt, isFinal: true })
    }, w)
  }

  function evaluate({ silenceMs = 0, isFinal = false } = {}) {
    const lane = buffer.getLane()
    if (!lane || !lane.text) return null

    if (lane.speaker === 'candidate') {
      reject('candidate_speech', { text: lane.text })
      buffer.clearLane()
      clearTimers()
      candidate = null
      return null
    }

    const assessment = assessQuestionBoundary({
      text: applyUtteranceCorrection(lane.text),
      silenceMs,
      isFinal,
      speakerRole: lane.speaker,
      hadPriorQuestion: getHadPriorQuestion(),
      laneAgeMs: now() - lane.startedAt,
    })

    debug('BOUNDARY', { ...assessment, text: lane.text, speaker: lane.speaker, silenceMs })

    if (assessment.action === 'reject') {
      // Keep accumulating if incomplete was already shown as unclear — don't wipe live UI aggressively
      if (assessment.reason === 'low_confidence' || assessment.reason === 'speaker_unknown') {
        onLive({ text: lane.text, status: 'unclear', reason: assessment.reason })
      }
      return assessment
    }

    ensureCandidate(lane.text, lane.speaker)

    if (assessment.action === 'wait' || assessment.action === 'stabilize') {
      if (candidate) candidate.status = 'stabilizing'
      onLive({ text: candidate?.text || lane.text, status: assessment.action, reason: assessment.reason })
      scheduleEvaluate(assessment.waitMs)
      return assessment
    }

    if (assessment.action === 'commit') {
      return { ...assessment, committed: commitCurrent(assessment.reason) }
    }
    return assessment
  }

  /**
   * Ingest STT fragment (interim or final).
   */
  function ingest(fragment) {
    lastSilenceAt = now()
    const result = buffer.push(fragment)

    // Flushed prior speaker lane — evaluate it as possible question
    if (result.flushed?.text && result.flushed.speaker !== 'candidate') {
      ensureCandidate(result.flushed.text, result.flushed.speaker)
      const snap = { ...buffer.getLane() }
      // Temporarily evaluate flushed text
      const flushedAssessment = assessQuestionBoundary({
        text: applyUtteranceCorrection(result.flushed.text),
        silenceMs: STABILIZE_MS.completeInterrogative,
        isFinal: true,
        speakerRole: result.flushed.speaker,
        hadPriorQuestion: getHadPriorQuestion(),
        laneAgeMs: STABILIZE_MS.maxAccumulate,
      })
      if (flushedAssessment.action === 'commit' || flushedAssessment.completeness !== 'incomplete') {
        // Restore candidate to flushed text and commit
        if (candidate) {
          candidate.text = applyUtteranceCorrection(result.flushed.text)
        } else {
          ensureCandidate(result.flushed.text, result.flushed.speaker)
        }
        commitCurrent(flushedAssessment.reason || 'speaker_switch_flush')
      } else {
        reject('incomplete_speaker_switch', { text: result.flushed.text })
        candidate = null
      }
      // Continue with new lane (snap unused intentionally — buffer already has new lane)
      void snap
    }

    if (result.laneSpeaker === 'candidate' || fragment.meta?.isCandidate || fragment.meta?.speakerRole === 'candidate') {
      reject('candidate_speech', { text: result.liveText || fragment.text })
      onLive({ text: '', status: 'listening', reason: 'candidate_speech' })
      buffer.clearLane()
      clearTimers()
      return result
    }

    onLive({ text: result.liveText, status: 'listening' })

    if (fragment.isFinal) {
      evaluate({ silenceMs: 0, isFinal: true })
    } else {
      // Soft evaluate on interim for early candidate visibility
      const lane = buffer.getLane()
      if (lane?.text && !isIncompleteUtterance(lane.text) && INTERROGATIVE.test(lane.text)) {
        ensureCandidate(lane.text, lane.speaker)
      }
      scheduleEvaluate(STABILIZE_MS.incomplete)
    }
    return result
  }

  function notifySilence(ms) {
    lastSilenceAt = now() - ms
    return evaluate({ silenceMs: ms, isFinal: true })
  }

  function forceCommit() {
    const lane = buffer.getLane()
    if (lane?.text) ensureCandidate(lane.text, lane.speaker)
    return commitCurrent('force')
  }

  function reset() {
    clearTimers()
    candidate = null
    buffer.clearLane()
  }

  function getMetrics() {
    const t = metrics.timeToCommitMs
    return {
      ...metrics,
      avgTimeToCommitMs: t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : null,
      questionCaptureSuccessHint: metrics.commits,
    }
  }

  function getCandidate() {
    return candidate ? { ...candidate } : null
  }

  return {
    version: QUESTION_CAPTURE_VERSION,
    ingest,
    evaluate,
    notifySilence,
    forceCommit,
    reset,
    getMetrics,
    getCandidate,
    clearTimers,
  }
}

export function formatCaptureDebugLine(evt = {}) {
  const parts = [
    '[mm-capture]',
    evt.stage || '?',
    evt.questionId ? `id=${evt.questionId}` : null,
    evt.reason ? `reason=${evt.reason}` : null,
    evt.action ? `action=${evt.action}` : null,
    evt.text ? `text=${JSON.stringify(String(evt.text).slice(0, 80))}` : null,
    evt.captureLatencyMs != null ? `commitMs=${evt.captureLatencyMs}` : null,
  ]
  return parts.filter(Boolean).join(' ')
}
