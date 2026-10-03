import fs from 'node:fs'

function patch(file, before, after, expected = 1) {
  const text = fs.readFileSync(file, 'utf8')
  const count = text.split(before).length - 1
  if (count !== expected) throw new Error(`${file}: expected ${expected} match(es), found ${count}: ${before.slice(0, 120)}`)
  fs.writeFileSync(file, text.replaceAll(before, after))
}

const state = 'shared/interviewState.js'
patch(state,
  "    if (speechTurns.length > 1000) speechTurns.splice(0, speechTurns.length - 1000)",
  "    // Keep the full in-session conversation authoritative; final evaluation must not silently drop opening turns.",
  2,
)
patch(state,
`  /**
   * Commit an answer only for the matching question. Does NOT push AI text into speechTurns.
   */
  function commitAnswer({ questionId, generationId, text, hint = null, validation = null, incomplete = false } = {}) {
    const q = getQuestion(questionId)
    if (!q) return null
    if (!['committed', 'pending', 'answered'].includes(q.status)) return null`,
`  /** Bind the current generation to a question before provider work starts. */
  function setQuestionGeneration(questionId, generationId) {
    const q = getQuestion(questionId)
    if (!q || !generationId) return false
    q.expectedGenerationId = String(generationId)
    emit()
    return true
  }

  /**
   * Commit an answer only for the matching question AND authoritative generation.
   * Does NOT push AI text into speechTurns.
   */
  function commitAnswer({ questionId, generationId, text, hint = null, validation = null, incomplete = false } = {}) {
    const q = getQuestion(questionId)
    if (!q) return null
    if (!['committed', 'pending', 'answered'].includes(q.status)) return null
    if (q.expectedGenerationId && String(generationId || '') !== q.expectedGenerationId) return null
    if (q.committedGenerationId && String(generationId || '') !== q.committedGenerationId) return null`)
patch(state,
`    q.status = incomplete ? 'failed' : 'answered'
    q.answeredAt = Date.now()`,
`    q.status = incomplete ? 'failed' : 'answered'
    q.answeredAt = Date.now()
    if (generationId) q.committedGenerationId = String(generationId)`)
patch(state,
`    attachClassification,
    commitAnswer,`,
`    attachClassification,
    setQuestionGeneration,
    commitAnswer,`)

const live = 'src/LiveCompanion.jsx'
patch(live,
`    const gen = gm.start({
      questionId,
      reason: topicSwitch ? 'topic_switch' : 'new_question',
    })
    activeGenerationRef.current = gen`,
`    const gen = gm.start({
      questionId,
      reason: topicSwitch ? 'topic_switch' : 'new_question',
    })
    state.setQuestionGeneration?.(questionId, gen.generationId)
    activeGenerationRef.current = gen`)

console.log('audit-state-patch complete')
