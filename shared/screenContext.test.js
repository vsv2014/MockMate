import { describe, it, expect } from 'vitest'
import {
  evaluateScreenRelevance,
  buildScreenContextBlock,
  contextNeedsForScreenAnalysis,
  normalizeScreenContentType,
  createScreenContextRecord,
  screenFingerprint,
  previousScreenForContinuation,
  screenContinuationCandidate,
  SCREEN_CONTINUATION_MS,
  SCREEN_CONTINUATION_TEXT_MAX,
  SCREEN_FRESH_MS,
} from './screenContext.js'

describe('screenFingerprint', () => {
  it('invalidates cached analysis when session/profile context changes', () => {
    const image = 'a'.repeat(200)
    const first = screenFingerprint(image, { style: 'balanced', context: '{"role":"QA"}' })
    const second = screenFingerprint(image, { style: 'balanced', context: '{"role":"SDE"}' })
    expect(first).not.toBe(second)
  })
})

describe('multi-capture continuation bounds', () => {
  it('offers a recent capture from the same display as continuation context', () => {
    const previous = createScreenContextRecord({
      analysis: { contentType: 'coding', detectedText: 'Write a function that processes' },
      displayId: '1',
    })
    expect(screenContinuationCandidate(previous, { displayId: '1' }, previous.timestamp + 1000)).toBe(true)
    expect(previousScreenForContinuation(previous)).toMatchObject({
      screenContextId: previous.screenContextId,
      detectedText: 'Write a function that processes',
      captureCount: 1,
    })
  })

  it('rejects stale or different-display captures', () => {
    const previous = createScreenContextRecord({
      analysis: { contentType: 'other', detectedText: 'first half' },
      displayId: '1',
    })
    expect(screenContinuationCandidate(previous, { displayId: '2' }, previous.timestamp + 1000)).toBe(false)
    expect(screenContinuationCandidate(previous, { displayId: '1' }, previous.timestamp + SCREEN_CONTINUATION_MS + 1)).toBe(false)
  })

  it('can preserve a question id when a confirmed continuation replaces its answer', () => {
    const first = createScreenContextRecord({ analysis: { contentType: 'other', detectedText: 'first' } })
    const combined = createScreenContextRecord({
      screenContextId: first.screenContextId,
      analysis: { contentType: 'other', detectedText: 'first second', isContinuation: true },
    })
    expect(combined.screenContextId).toBe(first.screenContextId)
  })

  it('retains long multi-part question text within a bounded budget', () => {
    const longText = 'constraint '.repeat(900)
    const previous = createScreenContextRecord({ analysis: { contentType: 'other', detectedText: longText } })
    const packed = previousScreenForContinuation(previous)
    expect(packed.detectedText.length).toBe(SCREEN_CONTINUATION_TEXT_MAX)
    expect(packed.detectedText.length).toBeGreaterThan(1800)
  })
})
import { classifyTurn } from './interviewClassify.js'
import { pickPlaybook, packCandidateContext } from '../api/_lib/interview.js'

function screen(type, ageMs = 1000) {
  return createScreenContextRecord({
    analysis: {
      contentType: type === 'screen_code' ? 'coding' : type === 'screen_diagram' ? 'system_design' : 'other',
      detectedText: type === 'screen_code' ? 'def two_sum' : 'DB boxes',
      fullAnswer: 'summary',
      code: type === 'screen_code' ? 'def two_sum(a):\n  pass' : null,
    },
  })
}

describe('normalizeScreenContentType', () => {
  it('maps legacy coding → screen_code', () => {
    expect(normalizeScreenContentType('coding')).toBe('screen_code')
  })
})

describe('contextNeedsForScreenAnalysis', () => {
  it('standalone F7 does not dump resume', () => {
    const needs = contextNeedsForScreenAnalysis({
      profile: { resume: 'Built Kafka at Acme' },
    })
    expect(needs.resume).toBe('none')
    const packed = packCandidateContext({ resume: 'Built Kafka at Acme', targetRole: 'SWE' }, '', { contextNeeds: needs })
    expect(packed).not.toMatch(/Kafka/)
  })

  it('behavioral spoken question allows resume', () => {
    const needs = contextNeedsForScreenAnalysis({
      spokenQuestion: 'Tell me about a time you had a conflict',
      profile: { resume: 'Led team through conflict' },
    })
    expect(needs.resume).toBe('full')
  })
})

describe('evaluateScreenRelevance', () => {
  it('1) visible code + What does this code do? → attach', () => {
    const q = 'What does this code do?'
    const c = classifyTurn({ question: q })
    const r = evaluateScreenRelevance({ question: q, classification: c, screen: screen('screen_code') })
    expect(r.attach).toBe(true)
  })

  it('2) visible code + strengths → NOT attach', () => {
    const q = 'What are your strengths?'
    const c = classifyTurn({ question: q })
    const r = evaluateScreenRelevance({ question: q, classification: c, screen: screen('screen_code') })
    expect(r.attach).toBe(false)
  })

  it('3) diagram + Explain this architecture → attach', () => {
    const q = 'Explain this architecture.'
    const c = classifyTurn({ question: q })
    const r = evaluateScreenRelevance({ question: q, classification: c, screen: screen('screen_diagram') })
    expect(r.attach).toBe(true)
  })

  it('4) diagram + hardest project → NOT attach', () => {
    const q = 'Tell me about your hardest project.'
    const c = classifyTurn({ question: q })
    const r = evaluateScreenRelevance({ question: q, classification: c, screen: screen('screen_diagram') })
    expect(r.attach).toBe(false)
    expect(['experience', 'project_walkthrough']).toContain(pickPlaybook(q).key)
  })

  it('5) no screen + What does this code do? → no attach / no hallucination block', () => {
    const q = 'What does this code do?'
    const c = classifyTurn({ question: q })
    const r = evaluateScreenRelevance({ question: q, classification: c, screen: null })
    expect(r.attach).toBe(false)
    expect(buildScreenContextBlock(null)).toBe('')
  })

  it('6) stale screenshot + new question → not attached', () => {
    const s = screen('screen_code')
    s.timestamp = Date.now() - SCREEN_FRESH_MS - 1000
    const q = 'What does this code do?'
    const r = evaluateScreenRelevance({ question: q, classification: classifyTurn({ question: q }), screen: s })
    expect(r.attach).toBe(false)
    expect(r.reason).toBe('stale_screen')
  })

  it('7) new screenshot replaces old — latest used when fresh', () => {
    const oldS = screen('screen_diagram')
    oldS.timestamp = Date.now() - 60_000
    const newS = screen('screen_code')
    const q = 'What does this code do?'
    const rOld = evaluateScreenRelevance({ question: q, classification: classifyTurn({ question: q }), screen: oldS })
    const rNew = evaluateScreenRelevance({ question: q, classification: classifyTurn({ question: q }), screen: newS })
    expect(rNew.attach).toBe(true)
    // old diagram may still attach for deictic code ask with low score — prefer new
    expect(rNew.score).toBeGreaterThanOrEqual(rOld.score)
  })

  it('8) IRCTC HLD + unrelated desktop → ignore', () => {
    const q = 'Design an IRCTC-like train booking system.'
    const r = evaluateScreenRelevance({
      question: q,
      classification: classifyTurn({ question: q }),
      screen: screen('screen_unknown'),
    })
    expect(r.attach).toBe(false)
    expect(pickPlaybook(q).key).toBe('system_design')
  })

  it('9) PM feature + UI mockup may attach', () => {
    const q = 'Design a feature for food delivery.'
    const c = classifyTurn({ question: q, profile: { targetRole: 'Product Manager' } })
    const ui = createScreenContextRecord({
      analysis: { contentType: 'other', screenFamily: 'screen_ui', fullAnswer: 'checkout mock' },
    })
    ui.contentType = 'screen_ui'
    const r = evaluateScreenRelevance({ question: q, classification: c, screen: ui })
    expect(r.attach).toBe(true)
  })

  it('10) coding transform after F7 keeps screen attached', () => {
    const q = 'can you do it without using any data structures'
    const s = screen('screen_code')
    const c = classifyTurn({
      question: q,
      recentScreen: s,
      lastClassification: { questionType: 'screen_code', playbookKey: 'dsa' },
    })
    expect(c.isFollowUp || c.questionType === 'screen_code' || c.questionType === 'follow_up').toBe(true)
    const r = evaluateScreenRelevance({ question: q, classification: c, screen: s })
    expect(r.attach).toBe(true)
    expect(r.reason).toMatch(/coding_transform|followup_coding|deictic|soft_fresh/)
  })

  it('soft: general question still gets fresh code screen (no classifier veto)', () => {
    const q = 'how would you approach that differently'
    const c = classifyTurn({ question: q })
    const r = evaluateScreenRelevance({ question: q, classification: c, screen: screen('screen_code') })
    expect(r.attach).toBe(true)
    expect(r.reason).toMatch(/soft_fresh|coding_transform|deictic/)
  })

  it('11) Sales objection + coding screen → ignore', () => {
    const q = 'A customer says your product is too expensive.'
    const c = classifyTurn({ question: q, profile: { targetRole: 'Account Executive' } })
    const r = evaluateScreenRelevance({ question: q, classification: c, screen: screen('screen_code') })
    expect(r.attach).toBe(false)
  })

  it('12) failed screen → no attach', () => {
    const failed = createScreenContextRecord({ error: 'Vision model is rate-limited', status: 'failed' })
    const q = 'What does this code do?'
    const r = evaluateScreenRelevance({ question: q, classification: classifyTurn({ question: q }), screen: failed })
    expect(r.attach).toBe(false)
  })
})

describe('golden spoken/screen sequence (routing)', () => {
  it('IRCTC → Why PostgreSQL follow_up → Explain architecture attach → code attach → incident experience → Two Sum dsa', () => {
    const hist = []
    let last = null
    const step = (q, screenObj) => {
      const c = classifyTurn({ question: q, conversationHistory: hist, lastClassification: last })
      const pb = pickPlaybook(q, { classification: c })
      const rel = evaluateScreenRelevance({ question: q, classification: c, screen: screenObj })
      hist.push({ role: 'interviewer', text: q })
      last = { ...c, parentTopic: c.isFollowUp ? c.parentTopic : q, questionType: c.questionType }
      return { key: pb.key, attach: rel.attach, type: c.questionType }
    }

    expect(step('Design an IRCTC-like train booking system.', null)).toMatchObject({ key: 'system_design', attach: false })
    expect(step('Why PostgreSQL?', null)).toMatchObject({ key: 'follow_up', attach: false })
    expect(step('Explain this architecture.', screen('screen_diagram')).attach).toBe(true)
    expect(step('What does this code do?', screen('screen_code')).attach).toBe(true)
    expect(step('Tell me about your hardest production incident.', screen('screen_code'))).toMatchObject({ key: 'experience', attach: false })
    const dsa = step("Let's do a coding question. Two Sum.", null)
    expect(dsa.key).toBe('dsa')
    expect(dsa.attach).toBe(false)
  })
})
