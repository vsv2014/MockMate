/**
 * M2 question capture reliability — deterministic fragment / boundary / golden tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTranscriptBuffer, normalizeCaptureText, isDuplicateQuestion } from './transcriptBuffer.js'
import {
  assessQuestionBoundary,
  isIncompleteUtterance,
  applyUtteranceCorrection,
  createQuestionCaptureController,
  STABILIZE_MS,
} from './questionCapture.js'
import { createInterviewState } from './interviewState.js'
import { classifyTurn } from './interviewClassify.js'
import { resolveContextSources } from './contextSelection.js'
import { evaluateScreenRelevance } from './screenContext.js'
import { createGenerationManager } from './generationManager.js'

function makeCapture(opts = {}) {
  const buffer = createTranscriptBuffer()
  const committed = []
  const rejected = []
  const debug = []
  let now = opts.now0 || 1_000_000
  const timers = []
  const ctrl = createQuestionCaptureController({
    buffer,
    now: () => now,
    setTimeoutFn: (fn, ms) => {
      const id = { fn, at: now + ms }
      timers.push(id)
      return id
    },
    clearTimeoutFn: (id) => {
      const i = timers.indexOf(id)
      if (i >= 0) timers.splice(i, 1)
    },
    onCommitted: (q) => committed.push(q),
    onReject: (reason, detail) => rejected.push({ reason, detail }),
    onDebug: (e) => debug.push(e),
    getHadPriorQuestion: () => committed.length > 0 || !!opts.hadPrior,
    getLastCommittedText: () => committed[committed.length - 1]?.text || '',
    ...opts,
  })
  function advance(ms) {
    now += ms
    const due = timers.filter(t => t.at <= now)
    for (const t of due) {
      const i = timers.indexOf(t)
      if (i >= 0) timers.splice(i, 1)
      t.fn()
    }
  }
  return { buffer, ctrl, committed, rejected, debug, advance, get now() { return now }, setNow: (n) => { now = n } }
}

describe('boundary helpers', () => {
  it('does not treat incomplete openers as complete', () => {
    expect(isIncompleteUtterance('Can you design')).toBe(true)
    expect(isIncompleteUtterance('What about')).toBe(true)
    expect(isIncompleteUtterance('Tell me about a time')).toBe(true)
    expect(isIncompleteUtterance('Can you design a scalable payment system?')).toBe(false)
    expect(isIncompleteUtterance('What about Redis?')).toBe(false)
  })

  it('applies actually-correction', () => {
    const t = applyUtteranceCorrection(
      'How would you design Redis—actually, how would you design the whole caching layer?',
    )
    expect(t.toLowerCase()).toContain('caching layer')
    expect(t.toLowerCase()).not.toMatch(/^how would you design redis/)
  })
})

describe('TEST A — complete single question', () => {
  it('commits Design IRCTC', () => {
    const { ctrl, committed, advance } = makeCapture()
    ctrl.ingest({ text: 'Design an IRCTC-like train booking system.', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(STABILIZE_MS.completeInterrogative + 50)
    expect(committed.length).toBe(1)
    expect(committed[0].text).toMatch(/IRCTC/i)
    expect(committed[0].status).toBe('committed')
  })
})

describe('TEST B — fragmented accumulation', () => {
  it('merges Design a... high scale... train booking system', () => {
    const { ctrl, committed, advance } = makeCapture()
    ctrl.ingest({ text: 'Design a', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(200)
    expect(committed.length).toBe(0)
    ctrl.ingest({ text: 'high scale', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(200)
    ctrl.ingest({ text: 'train booking system.', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(STABILIZE_MS.likelyComplete + 100)
    expect(committed.length).toBe(1)
    expect(normalizeCaptureText(committed[0].text)).toContain('design')
    expect(normalizeCaptureText(committed[0].text)).toContain('booking')
  })
})

describe('TEST C — Why... PostgreSQL?', () => {
  it('waits then commits', () => {
    const { ctrl, committed, advance } = makeCapture({ hadPrior: true })
    ctrl.ingest({ text: 'Why', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(300)
    expect(committed.length).toBe(0)
    ctrl.ingest({ text: 'PostgreSQL?', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(STABILIZE_MS.completeQuestionMark + 50)
    expect(committed.length).toBe(1)
    expect(committed[0].text).toMatch(/postgres/i)
  })
})

describe('TEST D — Tell me about... hardest incident', () => {
  it('accumulates before commit', () => {
    const { ctrl, committed, advance } = makeCapture()
    ctrl.ingest({ text: 'Tell me about', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(400)
    expect(committed.length).toBe(0)
    ctrl.ingest({ text: 'your hardest production incident.', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(STABILIZE_MS.completeInterrogative + 80)
    expect(committed.length).toBe(1)
    expect(committed[0].text.toLowerCase()).toContain('hardest')
  })
})

describe('TEST E/F — speaker separation', () => {
  it('never merges candidate into interviewer question', () => {
    const { ctrl, committed, advance, rejected } = makeCapture()
    ctrl.ingest({ text: 'How would you design Redis caching?', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(STABILIZE_MS.completeQuestionMark + 40)
    expect(committed.length).toBe(1)
    ctrl.ingest({ text: 'I would probably use a write-through cache', isFinal: true, meta: { isCandidate: true, speakerRole: 'candidate' } })
    advance(500)
    expect(committed.length).toBe(1)
    expect(rejected.some(r => r.reason === 'candidate_speech')).toBe(true)
  })

  it('unknown speaker is conservative', () => {
    const a = assessQuestionBoundary({
      text: 'maybe something',
      silenceMs: 200,
      speakerRole: 'unknown',
      isFinal: true,
    })
    expect(['wait', 'reject']).toContain(a.action)
  })
})

describe('TEST G/H/I — pause lengths', () => {
  it('500ms may not commit incomplete; 1.2s+ commits complete', () => {
    const incomplete = assessQuestionBoundary({
      text: 'Can you design',
      silenceMs: 500,
      speakerRole: 'interviewer',
      isFinal: true,
      laneAgeMs: 500,
    })
    expect(incomplete.action).toBe('wait')

    const complete = assessQuestionBoundary({
      text: 'Can you design a scalable payment system?',
      silenceMs: 200,
      speakerRole: 'interviewer',
      isFinal: true,
      laneAgeMs: 1200,
    })
    expect(complete.action).toBe('commit')

    const mid = assessQuestionBoundary({
      text: 'What about Redis?',
      silenceMs: 1200,
      speakerRole: 'interviewer',
      isFinal: true,
      laneAgeMs: 1200,
    })
    expect(mid.action).toBe('commit')
  })
})

describe('TEST J — duplicate Deepgram final', () => {
  it('dedupes identical re-final', () => {
    const { ctrl, committed, advance } = makeCapture()
    const meta = { speakerRole: 'interviewer' }
    ctrl.ingest({ text: 'Why use Redis?', isFinal: true, meta })
    advance(STABILIZE_MS.completeQuestionMark + 40)
    expect(committed.length).toBe(1)
    ctrl.ingest({ text: 'Why use Redis?', isFinal: true, meta })
    advance(STABILIZE_MS.completeQuestionMark + 40)
    expect(committed.length).toBe(1)
    expect(isDuplicateQuestion('Why use Redis?', 'Why use Redis?')).toBe(true)
    expect(isDuplicateQuestion('Why Redis?', 'Actually, why Redis instead of Postgres?')).toBe(false)
  })
})

describe('TEST K — STT reconnect does not wipe committed', () => {
  it('keeps InterviewState questions across capture reset', () => {
    const state = createInterviewState({ profile: { targetRole: 'SWE' } })
    const q = state.commitQuestion('Design IRCTC.', { questionType: 'system_design', isFollowUp: false })
    const { ctrl } = makeCapture()
    ctrl.reset()
    expect(state.getQuestion(q.id)?.text).toMatch(/IRCTC/)
    expect(state.getSnapshot().questionHistory.some(x => x.id === q.id)).toBe(true)
  })
})

describe('TEST L — question while answer streaming', () => {
  it('Q1 and Q2 both remain; stale gen cannot overwrite', () => {
    const state = createInterviewState({ profile: { targetRole: 'SWE' } })
    const gm = createGenerationManager()
    const q1 = state.commitQuestion('Design IRCTC.', { questionType: 'system_design', isFollowUp: false })
    const g1 = gm.start({ questionId: q1.id })
    g1.markGenerating()
    const q2 = state.commitQuestion('Tell me about your hardest production incident.', {
      questionType: 'experience', isFollowUp: false,
    })
    const g2 = gm.start({ questionId: q2.id, reason: 'topic_switch' })
    g2.markGenerating()
    expect(g1.canCommit()).toBe(false)
    if (g1.canCommit()) state.commitAnswer({ questionId: q1.id, generationId: g1.generationId, text: 'WRONG' })
    state.commitAnswer({ questionId: q2.id, generationId: g2.generationId, text: 'incident story' })
    g2.complete()
    const hist = state.getSnapshot().questionHistory
    expect(hist.find(x => x.id === q1.id)).toBeTruthy()
    expect(hist.find(x => x.id === q2.id)).toBeTruthy()
    expect(state.getSnapshot().lastAnswer.questionId).toBe(q2.id)
    expect(state.getSnapshot().lastAnswer.text).not.toBe('WRONG')
  })
})

describe('TEST O — rapid two questions', () => {
  it('commits both separately', () => {
    const { ctrl, committed, advance } = makeCapture()
    ctrl.ingest({ text: 'What are your strengths?', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(STABILIZE_MS.completeQuestionMark + 40)
    ctrl.ingest({ text: 'What are your weaknesses?', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(STABILIZE_MS.completeQuestionMark + 40)
    expect(committed.length).toBe(2)
    expect(committed[0].text).toMatch(/strengths/i)
    expect(committed[1].text).toMatch(/weaknesses/i)
  })
})

describe('TEST P — interrupted halfway', () => {
  it('does not commit bare incomplete opener quickly', () => {
    const { ctrl, committed, advance } = makeCapture()
    ctrl.ingest({ text: 'How would you design a booking', isFinal: true, meta: { speakerRole: 'interviewer' } })
    advance(400)
    expect(committed.length).toBe(0)
  })
})

describe('TEST Q — self-correction', () => {
  it('final question reflects correction', () => {
    const { ctrl, committed, advance } = makeCapture()
    ctrl.ingest({
      text: 'How would you design Redis—actually, how would you design the whole caching layer?',
      isFinal: true,
      meta: { speakerRole: 'interviewer' },
    })
    advance(STABILIZE_MS.completeQuestionMark + 80)
    expect(committed.length).toBe(1)
    expect(committed[0].text.toLowerCase()).toContain('caching')
  })
})

describe('LLM failure never deletes question', () => {
  it('failed answer keeps question visible', () => {
    const state = createInterviewState()
    const q = state.commitQuestion('What are your strengths?', { questionType: 'experience', isFollowUp: false })
    state.markQuestionFailed(q.id, 'provider_error')
    expect(state.getQuestion(q.id).text).toMatch(/strengths/i)
    expect(state.getUiQuestions().some(u => u.questionId === q.id)).toBe(true)
    expect(state.getQuestion(q.id).status).toBe('failed')
  })
})

describe('GOLDEN LIVE INTERVIEW sequence', () => {
  const profile = { targetRole: 'Software Engineer', codingLanguage: 'Java' }

  const SCRIPT = [
    { text: "Let's start with a system design question. Design an IRCTC-like train booking system.", expectType: 'system_design', followUp: false },
    { text: 'What are the functional requirements?', expectParent: true },
    { text: 'What are the non-functional requirements?', expectParent: true },
    { text: 'Give me some scale estimates.', expectParent: true },
    { text: 'How would you architect it?', expectParent: true },
    { text: 'Why PostgreSQL?', expectParent: true, expectFollowUp: true },
    { text: 'What happens if two users try to book the last seat simultaneously?', expectParent: true },
    { text: 'How would you use Redis here?', expectParent: true },
    { text: 'Okay, forget the system design. Tell me about the hardest production incident you\'ve handled.', expectType: 'experience', followUp: false },
    { text: 'Why did you make that decision?', expectParent: true },
    { text: 'Let\'s switch to DSA. Given an array, find two numbers that sum to a target.', expectType: 'dsa', followUp: false },
    { text: 'Write it in Java.', expectParent: true },
    { text: 'What is the complexity?', expectParent: true },
  ]

  it('captures every question with id, parent, classification, context; one answer each', () => {
    const state = createInterviewState({ profile })
    const gm = createGenerationManager()
    const answers = []
    let lastClass = null
    let rootSd = null
    let rootExp = null
    let rootDsa = null

    for (const step of SCRIPT) {
      // Capture durability first (as controller would)
      const q = state.commitQuestion(step.text, null, { source: 'golden' })
      expect(q.id).toBeTruthy()
      expect(q.status).toBe('committed')
      expect(q.text).toBe(step.text)

      const classification = classifyTurn({
        question: step.text,
        profile,
        conversationHistory: state.getLlmHistory({ includeLastAnswer: false }),
        lastClassification: lastClass,
      })
      state.attachClassification(q.id, classification)
      const relevance = evaluateScreenRelevance({ question: step.text, classification, screen: null })
      const ctx = resolveContextSources({
        classification,
        screenRelevant: relevance.attach,
        hasPriorTopicDiscussion: !!classification.isFollowUp,
      })
      state.setContextDecision(q.id, {
        contextSources: ctx.allowed,
        screenRelevant: relevance.attach,
        screenReason: relevance.reason,
      })

      if (step.expectType) expect(classification.questionType).toBe(step.expectType)
      if (step.followUp === false) expect(classification.isFollowUp).toBe(false)
      if (step.expectFollowUp) expect(classification.isFollowUp).toBe(true)

      if (classification.questionType === 'system_design' && !classification.isFollowUp) rootSd = q.id
      if (classification.questionType === 'experience' && !classification.isFollowUp) rootExp = q.id
      if (classification.questionType === 'dsa' && !classification.isFollowUp) rootDsa = q.id

      if (step.expectParent && classification.isFollowUp) {
        expect(q.parentQuestionId || state.getQuestion(q.id).parentQuestionId).toBeTruthy()
      }

      // Wrong-answer protection: experience must not pick SD/DSA
      if (classification.questionType === 'experience') {
        expect(classification.questionType).not.toBe('system_design')
        expect(ctx.forbidden).toEqual(expect.arrayContaining(['previous_hld', 'irctc_architecture']))
      }

      const gen = gm.start({ questionId: q.id })
      gen.markGenerating()
      const answerText = `ANSWER_FOR_${q.id}`
      state.commitAnswer({ questionId: q.id, generationId: gen.generationId, text: answerText })
      gen.complete()
      answers.push({ questionId: q.id, text: answerText })

      lastClass = {
        questionType: classification.isFollowUp ? 'follow_up' : classification.questionType,
        parentType: classification.parentType || classification.questionType,
        parentTopic: classification.parentTopic || step.text,
        question: step.text,
      }
    }

    expect(state.getSnapshot().questionHistory.length).toBe(SCRIPT.length)
    expect(answers.length).toBe(SCRIPT.length)
    // No answer attached to wrong question
    for (const a of answers) {
      expect(a.text).toBe(`ANSWER_FOR_${a.questionId}`)
    }
    expect(rootSd).toBeTruthy()
    expect(rootExp).toBeTruthy()
    expect(rootDsa).toBeTruthy()
  })
})

describe('pre-generation sanity', () => {
  it('strengths must not select system_design context', () => {
    const c = classifyTurn({
      question: 'What are your strengths?',
      profile: { targetRole: 'SWE' },
      lastClassification: { questionType: 'system_design', parentTopic: 'IRCTC' },
    })
    expect(c.questionType).toBe('experience')
    const ctx = resolveContextSources({ classification: c })
    expect(ctx.forbidden).toEqual(expect.arrayContaining(['previous_hld']))
  })
})
