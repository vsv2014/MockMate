import { describe, it, expect } from 'vitest'
import { jobAnalysisJd } from './jobsHandoff.js'

describe('jobAnalysisJd', () => {
  it('uses snippet when long enough', () => {
    const snip = 'We need a backend engineer with Node and Postgres experience for our payments team.'
    const { jd, limited } = jobAnalysisJd({ title: 'BE', snippet: snip })
    expect(limited).toBe(false)
    expect(jd).toBe(snip)
  })

  it('builds a limited stub when snippet missing', () => {
    const { jd, limited } = jobAnalysisJd({ title: 'SWE', company: 'Acme', url: 'https://x.test/j' })
    expect(limited).toBe(true)
    expect(jd).toContain('Role: SWE')
    expect(jd).toContain('Acme')
    expect(jd).toMatch(/Limited JD/i)
  })
})
