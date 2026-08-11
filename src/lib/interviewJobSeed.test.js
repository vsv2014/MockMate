import { describe, it, expect } from 'vitest'
import {
  buildInterviewJobSeed,
  applyInterviewJobSeed,
  interviewSeedConfirmMessage,
} from './interviewJobSeed.js'

describe('buildInterviewJobSeed', () => {
  it('builds from a job listing via jobAnalysisJd', () => {
    const snip = 'We need a backend engineer with Node and Postgres for payments.'
    const seed = buildInterviewJobSeed({
      job: { title: 'Backend', company: 'Acme', snippet: snip },
    })
    expect(seed.jobDescription).toBe(snip)
    expect(seed.targetRole).toBe('Backend')
    expect(seed.targetCompany).toBe('Acme')
    expect(seed.limited).toBe(false)
    expect(seed.source).toBe('jobs')
  })

  it('builds from Career analysis fields', () => {
    const seed = buildInterviewJobSeed({
      jd: 'Full JD text for the role with requirements and responsibilities listed.',
      role: 'SDE 2',
      company: 'Stripe',
      source: 'career',
    })
    expect(seed.jobDescription).toContain('Full JD')
    expect(seed.targetRole).toBe('SDE 2')
    expect(seed.source).toBe('career')
  })
})

describe('applyInterviewJobSeed', () => {
  it('writes JD + role/company without inventing other fields', () => {
    const next = applyInterviewJobSeed(
      { resume: 'keep me', language: 'English' },
      { jobDescription: 'JD here', targetRole: 'BE', targetCompany: 'Acme' },
    )
    expect(next.resume).toBe('keep me')
    expect(next.jobDescription).toBe('JD here')
    expect(next.targetRole).toBe('BE')
    expect(next.targetCompany).toBe('Acme')
  })

  it('rejects empty JD so we never wipe an existing interview JD', () => {
    expect(() => applyInterviewJobSeed({ jobDescription: 'old' }, { jobDescription: '  ' }))
      .toThrow(/job description/i)
  })
})

describe('interviewSeedConfirmMessage', () => {
  it('names the destination', () => {
    expect(interviewSeedConfirmMessage({ targetRole: 'SWE' }, 'solo')).toMatch(/Solo Practice/)
    expect(interviewSeedConfirmMessage({ limited: true }, 'live')).toMatch(/limited/i)
  })
})
