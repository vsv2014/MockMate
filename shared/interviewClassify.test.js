import { describe, it, expect } from 'vitest'
import { classifyTurn, inferRoleFamily, contextNeedsFor, shouldRetrieveDocs, isLogisticalCheck } from './interviewClassify.js'

describe('inferRoleFamily', () => {
  it('detects product from targetRole', () => {
    expect(inferRoleFamily({ targetRole: 'Senior Product Manager' })).toBe('product')
  })
  it('detects sales', () => {
    expect(inferRoleFamily({ targetRole: 'Account Executive' })).toBe('sales')
  })
  it('unknown when empty', () => {
    expect(inferRoleFamily({})).toBe('unknown')
  })
})

describe('classifyTurn P0 experience vs technical', () => {
  const qs = [
    'What do you do in your current role?',
    'What are your strengths?',
    'What are your weaknesses?',
    'Tell me about yourself.',
    'Tell me about your experience.',
    'What did you personally build?',
    'What was your biggest challenge?',
    'Tell me about a production incident.',
    'Why are you looking for a change?',
  ]
  for (const q of qs) {
    it(`does not route to technical: ${q}`, () => {
      const c = classifyTurn({ question: q })
      expect(c.playbookKey).not.toBe('technical')
      expect(['intro', 'experience', 'behavioral', 'project_walkthrough']).toContain(c.playbookKey)
    })
  }

  it('pure concept still technical', () => {
    expect(classifyTurn({ question: 'What is the CAP theorem?' }).playbookKey).toBe('technical')
  })

  it('assignment-at-company is project walkthrough, not technical', () => {
    const c = classifyTurn({ question: 'what is the assignment you did in optra' })
    expect(c.questionType).toBe('project_walkthrough')
    expect(c.contextNeeds.rag).toBe(true)
    expect(shouldRetrieveDocs(c)).toBe(true)
  })

  it('routes a coding request in the middle of a QA interview to coding', () => {
    const c = classifyTurn({
      question: 'Give me Playwright JS code for Amazon where you search, scroll, select an item and add it to cart',
      profile: { targetRole: 'QA Automation Engineer' },
      lastClassification: { questionType: 'experience', parentTopic: 'Tell me about your QA work' },
      conversationHistory: [{ role: 'interviewer', text: 'Tell me about your QA work' }],
    })
    expect(c.questionType).toBe('coding')
    expect(c.playbookKey).toBe('dsa')
    expect(c.contextNeeds.codingLanguage).toBe(true)
  })
})

describe('contextNeedsFor (soft advisory)', () => {
  it('system_design keeps soft resume fact card + unrestricted RAG', () => {
    const n = contextNeedsFor('system_design')
    expect(n.resume).toBe('short')
    expect(n.rag).toBe(true)
    expect(n.ragTypes).toBe(null)
    expect(shouldRetrieveDocs({ contextNeeds: n })).toBe(true)
  })
  it('full resume for behavioral', () => {
    expect(contextNeedsFor('behavioral').resume).toBe('full')
    expect(shouldRetrieveDocs({ contextNeeds: contextNeedsFor('behavioral') })).toBe(true)
  })
  it('dsa keeps soft fact card + coding language; no type veto', () => {
    const n = contextNeedsFor('dsa')
    expect(n.resume).toBe('short')
    expect(n.ragTypes).toBe(null)
    expect(n.codingLanguage).toBe(true)
    expect(shouldRetrieveDocs({ contextNeeds: n })).toBe(true)
  })
  it('shouldRetrieveDocs never hard-blocks', () => {
    expect(shouldRetrieveDocs({ contextNeeds: { rag: false } })).toBe(true)
    expect(shouldRetrieveDocs(null)).toBe(true)
  })
})

describe('long Live technical interview benchmark — short turns', () => {
  const dsaRoot = {
    questionType: 'dsa',
    question: 'Given a jump array, determine whether the last index is reachable.',
    parentTopic: 'Given a jump array, determine whether the last index is reachable.',
  }
  const history = [{ role: 'interviewer', text: dsaRoot.question }]

  it.each([
    'Hello.',
    'Okay.',
    'Yes. Yes. Yeah.',
    'Good enough.',
    'Absolutely.',
    'Give me one minute.',
    "I'll come back in a minute.",
  ])('suppresses clear non-questions without paid model generation: %s', utterance => {
    expect(isLogisticalCheck(utterance)).toBe(true)
  })

  it.each([
    'Okay, can you write the code?',
    'Can you print the result?',
    'Write console.',
    'I want jump count.',
    'How many jumps do we need?',
    'Can you hear me from the other service?',
  ])('does not discard actionable speech because of a greeting/short length: %s', utterance => {
    expect(isLogisticalCheck(utterance)).toBe(false)
  })

  it.each([
    'console',
    'write console',
    'paste the code',
    'code it',
    'I want jump count',
    'minimum number of jumps needed',
    'instead of boolean, return a count',
  ])('retains the active coding parent for terse instructions: %s', question => {
    const c = classifyTurn({ question, lastClassification: dsaRoot, conversationHistory: history })
    expect(c.questionType).toBe('follow_up')
    expect(c.parentType).toBe('dsa')
    expect(c.playbookKey).toBe('follow_up')
  })

  it('a named binary-search question starts a new DSA problem instead of repeating Jump Game', () => {
    const c = classifyTurn({
      question: 'How exactly do you perform binary search in a sorted array?',
      lastClassification: dsaRoot,
      conversationHistory: history,
    })
    expect(c.questionType).toBe('dsa')
    expect(c.isFollowUp).toBe(false)
  })
})
