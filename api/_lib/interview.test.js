import { describe, it, expect } from 'vitest'
import { pickPlaybook, packCandidateContext, glanceLayers } from './interview.js'

describe('pickPlaybook (question classification)', () => {
  const cases = [
    ['explain temporal dead zone in JavaScript', 'technical'],
    ['what is the difference between let and const', 'technical'],
    ['reverse a linked list', 'dsa'],
    ['find the longest substring without repeating characters', 'dsa'],
    ['design a URL shortener', 'system_design'],
    ['tell me about a time you had a conflict', 'behavioral'],
    ['walk me through your most challenging project', 'project_walkthrough'],
    ['why do you want to work here', 'company'],
  ]
  for (const [q, key] of cases) {
    it(`"${q}" → ${key}`, () => expect(pickPlaybook(q).key).toBe(key))
  }
  it('falls back to general for unclassifiable input', () => {
    expect(pickPlaybook('so anyway').key).toBe('general')
  })
})

describe('packCandidateContext (source hierarchy)', () => {
  it('dumps resume/JD when no RAG block', () => {
    const out = packCandidateContext({
      name: 'Ada',
      targetRole: 'SWE',
      resume: 'Built Kafka pipelines at Acme. '.repeat(20),
      jobDescription: 'Need Kafka + Go experience. '.repeat(10),
    })
    expect(out).toMatch(/CANDIDATE IDENTITY/)
    expect(out).toMatch(/CANDIDATE RESUME/)
    expect(out).toMatch(/JOB DESCRIPTION/)
    expect(out).toMatch(/Kafka/)
  })

  it('prefers retrieved docs and shortens resume when RAG present', () => {
    const longResume = 'PROJECT ALPHA '.repeat(200)
    const rag = 'RELEVANT FROM YOUR DOCUMENTS (ground the answer in these — they were retrieved for THIS question):\n- Doc note about Redis'
    const out = packCandidateContext({ resume: longResume, jobDescription: 'JD text '.repeat(50) }, rag)
    expect(out).toMatch(/RELEVANT FROM YOUR DOCUMENTS/)
    expect(out).toMatch(/RESUME FACT CARD/)
    expect(out).not.toMatch(/CANDIDATE RESUME \(ground truth/)
    // Fact card is capped — should not dump the entire padded resume.
    expect(out.length).toBeLessThan(longResume.length)
  })

  it('includes custom voice instructions', () => {
    const out = packCandidateContext({ customPrompt: 'Sound casual, say "I shipped"' })
    expect(out).toMatch(/CANDIDATE VOICE/)
    expect(out).toMatch(/Sound casual/)
  })
})

describe('glanceLayers (stream/JSON shared contract)', () => {
  it('builds opener + bullets from prose', () => {
    const layers = glanceLayers('First beat. Second beat. Third beat. Fourth keeps going.')
    expect(layers.opener).toBe('First beat.')
    expect(layers.keyPoints.length).toBeGreaterThanOrEqual(2)
    expect(layers.fullAnswer).toMatch(/Fourth/)
  })

  it('honors meta.keyPoints when provided', () => {
    const layers = glanceLayers('Only one sentence here.', { keyPoints: ['A', 'B', 'C'] })
    expect(layers.keyPoints).toEqual(['A', 'B', 'C'])
  })
})
