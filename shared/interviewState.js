/**
 * Authoritative Live interview state (M1 + M2 durable questions).
 * UI transcript / React state are projections — this module owns question identity,
 * capture status, parent links, classification, and last answer.
 *
 * Solo must NOT import this for interviewer turns.
 */

import { inferRoleFamily } from './interviewClassify.js'

export const INTERVIEW_STATE_VERSION = 'interview_state_v2'

function createSessionId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function nid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * @typedef {'candidate'|'stabilizing'|'committed'|'answered'|'failed'|'cancelled'|'superseded'|'pending'} QuestionStatus
 */

/**
 * Create a mutable InterviewState for one Live session.
 * @param {{ sessionId?: string, profile?: object }} [opts]
 */
export function createInterviewState(opts = {}) {
  const sessionId = opts.sessionId || createSessionId()
  const questions = []
  const speechTurns = []
  let currentQuestionId = null
  let screenContext = null
  let lastAnswer = null
  let liveCapture = { text: '', status: 'listening', reason: null }
  let roleFamily = inferRoleFamily(opts.profile || {}) || 'unknown'
  let listeners = new Set()

  function emit() {
    for (const fn of listeners) {
      try { fn(getSnapshot()) } catch { /* ignore */ }
    }
  }

  function getQuestion(id) {
    return questions.find(q => q.id === id) || null
  }

  function getSnapshot() {
    return {
      version: INTERVIEW_STATE_VERSION,
      sessionId,
      roleFamily,
      questions: questions.map(q => ({ ...q })),
      questionHistory: questions
        .filter(q => ['committed', 'answered', 'failed', 'cancelled', 'superseded', 'pending'].includes(q.status) || q.committedAt)
        .map(q => ({ ...q })),
      speechTurns: speechTurns.map(t => ({ ...t })),
      currentQuestion: currentQuestionId ? { ...getQuestion(currentQuestionId) } : null,
      screenContext: screenContext ? { ...screenContext } : null,
      lastAnswer: lastAnswer ? { ...lastAnswer } : null,
      liveCapture: { ...liveCapture },
    }
  }

  function setProfile(profile) {
    roleFamily = inferRoleFamily(profile || {}) || roleFamily
    emit()
  }

  function setScreenContext(ctx) {
    screenContext = ctx ? { ...ctx } : null
    emit()
  }

  function setLiveCapture({ text = '', status = 'listening', reason = null } = {}) {
    liveCapture = { text: String(text || ''), status, reason }
    emit()
  }

  /**
   * Upsert a QUESTION_CANDIDATE / stabilizing record — visible before generation.
   */
  function upsertCaptureCandidate({
    questionId,
    text,
    rawTranscript = null,
    speaker = 'interviewer',
    confidence = null,
    source = 'stt',
    revisionCount = 0,
    status = 'candidate',
  } = {}) {
    const id = questionId || nid('q')
    let q = getQuestion(id)
    if (!q) {
      q = {
        id,
        sessionId,
        createdAt: Date.now(),
        speaker,
        rawTranscript: rawTranscript || text,
        normalizedTranscript: String(text || '').trim(),
        text: String(text || '').trim(),
        confidence,
        source,
        parentQuestionId: null,
        status,
        classification: null,
        questionType: null,
        roleFamily,
        topic: null,
        isFollowUp: false,
        contextNeeds: null,
        contextSources: [],
        screenRelevant: false,
        screenContextId: null,
        screenReason: null,
        revisionCount: revisionCount || 0,
        committedAt: null,
        ts: Date.now(),
      }
      questions.push(q)
      if (questions.length > 100) {
        // Never delete committed+ — drop oldest candidates only
        const dropIdx = questions.findIndex(x => x.status === 'candidate' || x.status === 'stabilizing')
        if (dropIdx >= 0 && questions[dropIdx].id !== id) questions.splice(dropIdx, 1)
        else if (questions.length > 120) questions.shift()
      }
    } else {
      // Controlled revision — never wipe the record
      if (text && String(text).trim() !== q.text) {
        q.rawTranscript = rawTranscript || text
        q.text = String(text).trim()
        q.normalizedTranscript = q.text
        q.revisionCount = (q.revisionCount || 0) + 1
      }
      if (status) q.status = status
      if (confidence != null) q.confidence = confidence
    }
    currentQuestionId = q.id
    emit()
    return q
  }

  /**
   * Commit a durable interviewer question. Classification may be attached here or later.
   * Once committed, the question remains visible forever (status may change, record stays).
   */
  function commitQuestion(questionIdOrText, classification = null, extras = {}) {
    let q = null
    if (typeof questionIdOrText === 'string' && getQuestion(questionIdOrText)) {
      q = getQuestion(questionIdOrText)
    } else if (extras.questionId && getQuestion(extras.questionId)) {
      q = getQuestion(extras.questionId)
      if (typeof questionIdOrText === 'string') {
        q.text = questionIdOrText.trim()
        q.normalizedTranscript = q.text
      }
    } else {
      // Create + commit in one step (manual / tests / M1 beginQuestion compat)
      q = upsertCaptureCandidate({
        questionId: extras.questionId || nid('q'),
        text: typeof questionIdOrText === 'string' ? questionIdOrText : extras.text,
        rawTranscript: extras.rawTranscript,
        speaker: extras.speaker || 'interviewer',
        confidence: extras.confidence ?? classification?.confidence,
        source: extras.source || 'manual',
        status: 'stabilizing',
      })
    }

    const text = String(extras.text || q.text || '').trim()
    q.text = text
    q.normalizedTranscript = text
    q.rawTranscript = extras.rawTranscript || q.rawTranscript || text

    // Supersede prior unanswered current if different id
    if (currentQuestionId && currentQuestionId !== q.id) {
      const prev = getQuestion(currentQuestionId)
      if (prev && (prev.status === 'committed' || prev.status === 'pending') && !prev.answeredAt) {
        // Keep visible — do not delete; leave as committed until answered/failed
      }
      if (prev && (prev.status === 'candidate' || prev.status === 'stabilizing')) {
        prev.status = 'superseded'
      }
    }

    const isFollowUp = !!(classification?.isFollowUp)
    const parentQuestionId = isFollowUp
      ? (extras.parentQuestionId || findLastCommittedParent() || classification?.parentQuestionId || null)
      : null
    const parent = parentQuestionId ? getQuestion(parentQuestionId) : null
    const topic = isFollowUp
      ? (classification?.parentTopic || parent?.topic || parent?.text || text)
      : text.slice(0, 160)

    q.parentQuestionId = parentQuestionId
    q.questionType = classification?.questionType || extras.questionType || q.questionType || null
    q.roleFamily = classification?.roleFamily || roleFamily
    q.topic = topic
    q.isFollowUp = isFollowUp
    q.confidence = classification?.confidence || extras.confidence || q.confidence
    q.contextNeeds = classification?.contextNeeds || extras.contextNeeds || null
    q.contextSources = extras.contextSources || q.contextSources || []
    q.screenRelevant = !!extras.screenRelevant
    q.screenContextId = extras.screenContextId || null
    q.screenReason = extras.screenReason || null
    q.classification = classification ? { ...classification } : q.classification
    q.status = 'committed'
    q.committedAt = q.committedAt || Date.now()
    q.ts = q.committedAt
    currentQuestionId = q.id

    // Speech history — one interviewer turn per committed question (update text if revise-before-answer)
    const existingTurn = speechTurns.find(t => t.questionId === q.id && t.role === 'interviewer')
    if (existingTurn) existingTurn.text = q.text
    else {
      speechTurns.push({ id: nid('t'), role: 'interviewer', text: q.text, ts: q.ts, questionId: q.id })
      if (speechTurns.length > 120) speechTurns.splice(0, speechTurns.length - 120)
    }

    liveCapture = { text: '', status: 'committed', reason: null }
    emit()
    return q
  }

  function findLastCommittedParent() {
    for (let i = questions.length - 1; i >= 0; i--) {
      const q = questions[i]
      if (q.id === currentQuestionId) continue
      if (['committed', 'answered', 'pending'].includes(q.status) || q.committedAt) return q.id
    }
    return null
  }

  /**
   * M1-compatible: immediately create a committed question (simulations / manual Answer).
   */
  function beginQuestion(text, classification = null, extras = {}) {
    return commitQuestion(text, classification, extras)
  }

  function recordCandidate(text) {
    const t = String(text || '').trim()
    if (!t) return null
    const turn = { id: nid('t'), role: 'candidate', text: t, ts: Date.now(), questionId: currentQuestionId }
    speechTurns.push(turn)
    if (speechTurns.length > 120) speechTurns.splice(0, speechTurns.length - 120)
    emit()
    return turn
  }

  function setContextDecision(questionId, { contextSources = [], screenRelevant = false, screenContextId = null, screenReason = null } = {}) {
    const q = getQuestion(questionId)
    if (!q) return null
    q.contextSources = [...contextSources]
    q.screenRelevant = !!screenRelevant
    q.screenContextId = screenContextId
    q.screenReason = screenReason
    emit()
    return q
  }

  function attachClassification(questionId, classification) {
    const q = getQuestion(questionId)
    if (!q || !classification) return null
    const isFollowUp = !!classification.isFollowUp
    q.classification = { ...classification }
    q.questionType = classification.questionType
    q.isFollowUp = isFollowUp
    q.roleFamily = classification.roleFamily || q.roleFamily
    q.confidence = classification.confidence
    q.contextNeeds = classification.contextNeeds
    if (isFollowUp) {
      q.parentQuestionId = q.parentQuestionId || findLastCommittedParent() || classification.parentQuestionId || null
      const parent = q.parentQuestionId ? getQuestion(q.parentQuestionId) : null
      q.topic = classification.parentTopic || parent?.topic || parent?.text || q.topic
    } else {
      q.parentQuestionId = null
      q.topic = q.text.slice(0, 160)
    }
    emit()
    return q
  }

  /**
   * Commit an answer only for the matching question. Does NOT push AI text into speechTurns.
   */
  function commitAnswer({ questionId, generationId, text, hint = null, validation = null, incomplete = false } = {}) {
    const q = getQuestion(questionId)
    if (!q) return null
    q.status = incomplete ? 'failed' : 'answered'
    q.answeredAt = Date.now()
    lastAnswer = {
      questionId,
      generationId,
      text: String(text || ''),
      hint: hint ? { ...hint } : null,
      validation: validation || null,
      incomplete: !!incomplete,
      ts: Date.now(),
    }
    emit()
    return lastAnswer
  }

  function markQuestionFailed(questionId, reason = 'failed') {
    const q = getQuestion(questionId)
    if (!q) return null
    // Keep question visible; do not overwrite a successful answer.
    if (q.status !== 'answered') {
      q.status = 'failed'
      q.terminalReason = reason
      q.terminalAt = Date.now()
    }
    emit()
    return q
  }

  function markQuestionCancelled(questionId, reason = 'cancelled') {
    const q = getQuestion(questionId)
    if (!q) return null
    if (q.status === 'answered' || q.status === 'failed') return q
    q.status = 'cancelled'
    q.terminalReason = reason
    q.terminalAt = Date.now()
    emit()
    return q
  }

  function markQuestionSuperseded(questionId, reason = 'superseded') {
    const q = getQuestion(questionId)
    if (!q) return null
    if (q.status === 'answered') return q
    q.status = 'superseded'
    q.terminalReason = reason
    q.terminalAt = Date.now()
    emit()
    return q
  }

  /** Mark prior unanswered committed questions superseded when a new Q becomes active. */
  function supersedeOpenQuestions(exceptId, reason = 'new_question') {
    for (const q of questions) {
      if (exceptId && q.id === exceptId) continue
      if (q.status === 'committed' || q.status === 'pending' || q.status === 'candidate' || q.status === 'stabilizing') {
        markQuestionSuperseded(q.id, reason)
      }
    }
  }

  /** History for LLM: interviewer + candidate only (+ optional compact lastAnswer for follow-ups). */
  function getLlmHistory({ limit = 12, includeLastAnswer = true } = {}) {
    const turns = speechTurns.slice(-limit).map(t => ({ role: t.role, text: t.text }))
    if (includeLastAnswer && lastAnswer?.text && !lastAnswer.incomplete) {
      // Coding / F7 seeds need more than a 400-char snip or rewrite follow-ups lose the solution.
      const cap = /class |def |function |```|Approach:|Code:/i.test(lastAnswer.text) ? 1200 : 400
      turns.push({ role: 'assistant', text: String(lastAnswer.text).slice(0, cap) })
    }
    return turns
  }

  /** UI projection — committed+ terminal questions never omitted because of loading. */
  function getUiQuestions() {
    return questions
      .filter(q => q.status !== 'candidate' && q.status !== 'stabilizing')
      .map(q => ({
        questionId: q.id,
        text: q.text,
        ts: q.committedAt || q.ts || q.createdAt,
        isQuestion: true,
        status: q.status,
        answer: lastAnswer?.questionId === q.id ? lastAnswer.text : undefined,
        hint: lastAnswer?.questionId === q.id ? lastAnswer.hint : undefined,
        parentQuestionId: q.parentQuestionId,
        questionType: q.questionType,
      }))
  }

  function getDevTrace(questionId = currentQuestionId, generation = null) {
    const q = questionId ? getQuestion(questionId) : null
    return {
      version: INTERVIEW_STATE_VERSION,
      sessionId,
      questionId: q?.id || null,
      question: q?.text || null,
      status: q?.status || null,
      classification: q ? {
        questionType: q.questionType,
        roleFamily: q.roleFamily,
        isFollowUp: q.isFollowUp,
        confidence: q.confidence,
        parentQuestionId: q.parentQuestionId,
        topic: q.topic,
      } : null,
      parent: q?.parentQuestionId || null,
      contextSources: q?.contextSources || [],
      screen: {
        relevant: !!q?.screenRelevant,
        screenContextId: q?.screenContextId || null,
        reason: q?.screenReason || null,
        current: screenContext ? {
          id: screenContext.screenContextId,
          type: screenContext.contentType,
          status: screenContext.status,
        } : null,
      },
      generationId: generation?.generationId || lastAnswer?.generationId || null,
      generationStatus: generation?.status || null,
      validation: lastAnswer?.validation || null,
      answerPreview: lastAnswer?.text ? String(lastAnswer.text).slice(0, 120) : null,
      liveCapture: { ...liveCapture },
    }
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return {
    sessionId,
    getSnapshot,
    setProfile,
    setScreenContext,
    setLiveCapture,
    upsertCaptureCandidate,
    commitQuestion,
    beginQuestion,
    recordCandidate,
    setContextDecision,
    attachClassification,
    commitAnswer,
    markQuestionFailed,
    markQuestionCancelled,
    markQuestionSuperseded,
    supersedeOpenQuestions,
    getLlmHistory,
    getUiQuestions,
    getDevTrace,
    getQuestion,
    getCurrentQuestionId: () => currentQuestionId,
    subscribe,
  }
}
