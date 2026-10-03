import { describe, expect, it } from 'vitest'
import {
  assessQuestionBoundary, applyUtteranceCorrection, createQuestionCaptureController,
  isRevisionSignal, isRefinementSignal,
} from './questionCapture.js'
import {
  createTranscriptBuffer, isDuplicateQuestion, mergeOverlappingText,
  repairInterviewTerms, sanitizeCaptureText,
} from './transcriptBuffer.js'
import { createInterviewState } from './interviewState.js'

// Tiny deterministic clock/timer harness for controller tests.
function harness(opts = {}) {
  let now = 1_000
  let id = 0
  const timers = new Map()
  const buffer = createTranscriptBuffer()
  const committed = [], rejected = [], candidates = [], revisions = [], refinements = []
  const controller = createQuestionCaptureController({
    buffer,
    now: () => now,
    setTimeoutFn: (fn, ms) => { const k = ++id; timers.set(k, { fn, at: now + ms }); return k },
    clearTimeoutFn: k => timers.delete(k),
    onCommitted: q => committed.push(q),
    onReject: (reason, detail) => rejected.push({ reason, detail }),
    onCandidate: q => candidates.push(q),
    onRevision: x => revisions.push(x),
    onRefinement: x => refinements.push(x),
    getHadPriorQuestion: () => !!opts.hadPriorQuestion,
    getLastCommittedText: () => opts.lastCommitted || committed.at(-1)?.text || '',
  })
  const advance = ms => {
    now += ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)
      if (!due.length) break
      for (const [k, t] of due) { timers.delete(k); t.fn() }
    }
  }
  return { controller, buffer, committed, rejected, candidates, revisions, refinements, advance, now: () => now }
}

describe('boundary helpers', () => {
  it('does not treat incomplete openers as complete', () => {
    const r = assessQuestionBoundary({ text: 'How would you design', isFinal: true, silenceMs: 1000, speakerRole: 'interviewer' })
    expect(['wait', 'stabilize']).toContain(r.action)
  })

  it('applies actually-correction', () => {
    const t = applyUtteranceCorrection('How would you design Redis—actually, how would you design the whole caching layer?')
    expect(t.toLowerCase()).toContain('caching layer')
    expect(t.toLowerCase()).not.toMatch(/^how would you design redis/)
  })

  it('keeps only the corrected question after repeated wait markers', () => {
    const t = applyUtteranceCorrection('Some data validation. Wait. Wait. So write a Python function to validate an API response against JSON schema?')
    expect(t).toMatch(/^So write a Python function/i)
    expect(t).not.toMatch(/some data validation/i)
  })

  it('cleans control-marker STT artifacts without deleting legitimate repeated words or AI terms', () => {
    expect(sanitizeCaptureText('AI Okay. AI So can you write write a Python function AI End')).toBe('Okay. So can you write write a Python function')
    expect(sanitizeCaptureText('This is very very important')).toBe('This is very very important')
    expect(sanitizeCaptureText('I had had that experience before')).toBe('I had had that experience before')
    expect(sanitizeCaptureText('How do you validate AI models?')).toBe('How do you validate AI models?')
  })

  it('repairs only unambiguous technical acoustic spellings and preserves ordinary words', () => {
    expect(repairInterviewTerms('What is c t e in a SQL query?')).toMatch(/What is CTE/i)
    expect(repairInterviewTerms('How would you implement pooling interval retry logic?')).toMatch(/polling interval/i)
    expect(repairInterviewTerms('What is r b a c in security testing?')).toMatch(/RBAC/i)
    expect(repairInterviewTerms('Chennai. So how did you set up the Jenkins pipeline?')).toMatch(/^Chennai\./i)
    expect(repairInterviewTerms('What is the city? What are window functions and a sub query?')).toContain('city')
    expect(repairInterviewTerms('Which city do you currently work in?')).toContain('city')
    expect(repairInterviewTerms('The city is Hyderabad', 'Earlier we discussed SQL window functions')).toContain('city')
    expect(repairInterviewTerms('We use connection pooling for the database')).toContain('pooling')
  })

  it('merges overlapping refinals instead of duplicating words', () => {
    expect(mergeOverlappingText('How would you automate testing for an API', 'for an API that serves ML predictions?'))
      .toBe('How would you automate testing for an API that serves ML predictions?')
  })

  it('recognizes interviewer revision controls', () => {
    expect(isRevisionSignal('Wait. Wait. I will repeat')).toBe(true)
    expect(isRevisionSignal('How does wait notify work?')).toBe(false)
  })

  it('recognizes format refinements as part of the previous question', () => {
    expect(isRefinementSignal('Can you write it in Python?')).toBe(true)
    expect(isRefinementSignal('Be brief')).toBe(true)
  })

  it('commits a viable incomplete-marked question at the bounded deadline', () => {
    const r = assessQuestionBoundary({ text: 'How would you design a booking platform', isFinal: true, silenceMs: 1500, speakerRole: 'interviewer', laneAgeMs: 5000 })
    expect(r.action).toBe('commit')
  })

  it('expires a stale unusable fragment instead of carrying it for minutes', () => {
    const r = assessQuestionBoundary({ text: 'tell me about', isFinal: true, silenceMs: 7000, speakerRole: 'interviewer', laneAgeMs: 7000 })
    expect(r.action).toBe('reject')
  })

  it('dedupes identical questions', () => {
    expect(isDuplicateQuestion('How would you design a cache?', 'How would you design a cache?')).toBe(true)
  })
})

describe('capture controller', () => {
  it('commits interviewer questions after stabilization', () => {
    const h = harness()
    h.controller.ingest({ text: 'How would you design a rate limiter?', isFinal: true, meta: { speakerRole: 'interviewer' } })
    h.advance(1200)
    expect(h.committed).toHaveLength(1)
    expect(h.committed[0].text).toMatch(/rate limiter/i)
  })

  it('never merges candidate into interviewer question', () => {
    const h = harness()
    h.controller.ingest({ text: 'How would you design a cache?', isFinal: true, meta: { speakerRole: 'interviewer' } })
    h.controller.ingest({ text: 'I would start with Redis', isFinal: true, meta: { speakerRole: 'candidate', isCandidate: true } })
    expect(h.buffer.getLane()?.speaker).toBe('candidate')
  })

  it('revision signal cancels the pending lane', () => {
    const h = harness()
    h.controller.ingest({ text: 'How would you design a cache', isFinal: true, meta: { speakerRole: 'interviewer' } })
    h.controller.ingest({ text: 'Wait. I will repeat', isFinal: true, meta: { speakerRole: 'interviewer' } })
    expect(h.revisions.length).toBeGreaterThanOrEqual(1)
  })
})

describe('InterviewState integration', () => {
  it('keeps multiple committed questions and prevents later answer overwrite', () => {
    const s = createInterviewState()
    const q1 = s.commitQuestion('Tell me about yourself?', { questionType: 'behavioral', isFollowUp: false })
    s.commitAnswer({ questionId: q1.id, generationId: 'g1', text: 'Answer one' })
    const q2 = s.commitQuestion('How would you design a cache?', { questionType: 'system_design', isFollowUp: false })
    s.commitAnswer({ questionId: q2.id, generationId: 'g2', text: 'Answer two' })
    expect(s.getUiQuestions().map(q => q.answer)).toEqual(['Answer one', 'Answer two'])
    expect(s.commitAnswer({ questionId: q1.id, generationId: 'stale', text: 'stale' })).toBeNull()
  })
})
