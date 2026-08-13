/**
 * Live F7 / screen-analysis → overlay transcript + End Live conversation helpers.
 * Pure — no React. Keeps ScreenAnalysisPanel ephemeral while history stays durable.
 */

export function buildF7SeedText(analysis) {
  const a = analysis || {}
  const parts = [
    a.detectedText && `Problem: ${a.detectedText}`,
    a.pattern && `Pattern: ${a.pattern}`,
    Array.isArray(a.approach) && a.approach.length ? `Approach: ${a.approach.slice(0, 5).join(' | ')}` : '',
    a.code ? `Code:\n${String(a.code).slice(0, 900)}` : '',
    a.complexity && `Complexity: ${a.complexity}`,
    !a.code && a.fullAnswer && `Answer: ${String(a.fullAnswer).slice(0, 900)}`,
    Array.isArray(a.keyPoints) && a.keyPoints.length && !a.code
      ? `Key points: ${a.keyPoints.slice(0, 6).join(' · ')}`
      : '',
  ].filter(Boolean)
  return parts.join('\n').trim()
}

export function f7QuestionText(analysis) {
  const t = String(analysis?.detectedText || '').trim()
  return t || 'Screen solve (F7)'
}

/** True when analysis has something worth keeping in session history. */
export function f7HasUsableContent(screenAnalysis) {
  if (!screenAnalysis || screenAnalysis.error) return false
  const a = screenAnalysis.analysis
  if (!a) return false
  return !!(buildF7SeedText(a))
}

/**
 * Upsert a screen_f7 card by questionId and/or screenshot fingerprint.
 * Reanalyze often mints a new screenContextId — fingerprint keeps one card.
 */
export function upsertF7TranscriptCard(transcript, {
  questionId,
  fingerprint = '',
  text,
  answer,
  hint,
  ts = Date.now(),
} = {}) {
  const list = Array.isArray(transcript) ? transcript : []
  if (!questionId && !fingerprint) return list
  const idx = list.findIndex(s => {
    if (s.source !== 'screen_f7') return false
    if (questionId && s.questionId === questionId) return true
    if (fingerprint && s.fingerprint && s.fingerprint === fingerprint) return true
    return false
  })
  const stableId = (idx >= 0 && list[idx].questionId) || questionId
  if (!stableId) return list
  const card = {
    text: text || 'Screen solve (F7)',
    questionId: stableId,
    fingerprint: fingerprint || (idx >= 0 ? list[idx].fingerprint : '') || '',
    ts,
    isQuestion: true,
    source: 'screen_f7',
    answer: answer || '',
    status: 'committed',
    hint: hint || null,
  }
  if (idx >= 0) {
    const next = list.slice()
    next[idx] = { ...next[idx], ...card, ts: next[idx].ts || ts }
    return next
  }
  return [...list, card]
}

/** Prefer prior F7 questionId when the screenshot fingerprint matches (reanalyze). */
export function resolveF7QuestionId(screenAnalysis, priorByFingerprint = null) {
  const fp = screenAnalysis?.fingerprint || ''
  if (fp && priorByFingerprint?.fingerprint === fp && priorByFingerprint?.questionId) {
    return priorByFingerprint.questionId
  }
  return screenAnalysis?.screenContextId || null
}

/**
 * Append SCREEN interviewer + hint turns from transcript cards into End Live conversation.
 * Safe for both hasCandidate and !hasCandidate paths. Idempotent on text match.
 */
export function appendScreenF7ToConversation(conversation, transcript) {
  const base = Array.isArray(conversation) ? conversation.slice() : []
  const cards = (Array.isArray(transcript) ? transcript : []).filter(
    s => s.source === 'screen_f7' && s.isQuestion && (s.answer || s.hint?.fullAnswer || s.text),
  )
  for (const s of cards) {
    const qText = String(s.text || 'Screen solve (F7)').trim()
    const hintText = String(s.answer || s.hint?.fullAnswer || '').trim()
    const alreadyQ = base.some(
      t => (t.role === 'interviewer' || t.role === 'screen')
        && String(t.text || '').trim() === qText
        && (t.source === 'screen_f7' || !t.source),
    )
    // Prefer explicit screen markers; also skip if identical interviewer+hint already paired
    const alreadyHint = hintText && base.some(
      t => (t.role === 'hint' || t.role === 'screen_hint') && String(t.text || '').trim() === hintText,
    )
    if (!alreadyQ) {
      base.push({
        role: 'interviewer',
        text: qText,
        ts: s.ts || Date.now(),
        source: 'screen_f7',
      })
    }
    if (hintText && !alreadyHint) {
      base.push({
        role: 'hint',
        text: hintText,
        ts: s.ts || Date.now(),
        source: 'screen_f7',
      })
    }
  }
  return base
}

export function captureRejectLabel(reason, { audioSource } = {}) {
  const r = String(reason || '')
  if (r === 'candidate_speech') {
    if (audioSource === 'system') {
      return 'System Audio hears the call — your voice is not used for hints'
    }
    return 'Ignored — sounds like you (not used for hints)'
  }
  if (r === 'speaker_unknown') return 'Waiting for a clearer interviewer question'
  if (r === 'duplicate') return 'Same as last question — not added again'
  if (r === 'low_confidence') return 'Not clear enough as a question yet'
  if (r === 'incomplete' || r === 'incomplete_speaker_switch') return 'Question still incomplete — listening…'
  if (r === 'empty') return ''
  return r ? `Skipped capture (${r})` : ''
}
