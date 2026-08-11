import { describe, it, expect } from 'vitest'
import { classifyTurn, inferRoleFamily, contextNeedsFor, shouldRetrieveDocs } from './interviewClassify.js'

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
