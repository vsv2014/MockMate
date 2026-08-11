import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./core.js', () => ({
  completeJSON: vi.fn(),
}))

import { completeJSON } from './core.js'
import { atsScore, tailorResume, referralMessage, resumeLatex } from './career.js'

describe('career.js contract', () => {
  beforeEach(() => {
    vi.mocked(completeJSON).mockReset()
    vi.mocked(completeJSON).mockResolvedValue({ ok: true })
  })

  it('atsScore requires resume text', async () => {
    await expect(atsScore({ resume: '' })).rejects.toMatchObject({ status: 400 })
    expect(completeJSON).not.toHaveBeenCalled()
  })

  it('atsScore calls completeJSON with role + JD + resume slices', async () => {
    vi.mocked(completeJSON).mockResolvedValue({ overallScore: 72, dimensions: [] })
    const out = await atsScore({
      resume: 'Backend engineer with Node and Postgres experience for many years.',
      targetRole: 'Backend Engineer',
      jobDescription: 'Need Node, Postgres, AWS.',
      provider: 'gemini',
    })
    expect(out.overallScore).toBe(72)
    expect(completeJSON).toHaveBeenCalledOnce()
    const arg = vi.mocked(completeJSON).mock.calls[0][0]
    expect(arg.provider).toBe('gemini')
    expect(arg.messages[0].role).toBe('system')
    expect(arg.messages[1].content).toContain('TARGET ROLE: Backend Engineer')
    expect(arg.messages[1].content).toContain('JOB DESCRIPTION:')
    expect(arg.messages[1].content).toContain('RESUME:')
  })

  it('tailorResume requires resume and returns completeJSON result', async () => {
    await expect(tailorResume({})).rejects.toMatchObject({ status: 400 })
    vi.mocked(completeJSON).mockResolvedValue({
      summary: 'Tailored summary',
      rewrittenBullets: [{ before: 'a', after: 'b' }],
    })
    const out = await tailorResume({ resume: 'Enough resume text here to pass the gate.' })
    expect(out.summary).toBe('Tailored summary')
    expect(out.rewrittenBullets).toHaveLength(1)
  })

  it('referralMessage requires resume and includes company/person in prompt', async () => {
    await expect(referralMessage({ resume: '   ' })).rejects.toMatchObject({ status: 400 })
    vi.mocked(completeJSON).mockResolvedValue({ short: 'Hi', message: 'Please refer me', why: 'fit' })
    const out = await referralMessage({
      resume: 'Senior engineer with distributed systems background.',
      targetRole: 'SDE 2',
      company: 'Acme',
      person: 'Alex',
    })
    expect(out.short).toBe('Hi')
    const user = vi.mocked(completeJSON).mock.calls[0][0].messages[1].content
    expect(user).toContain('COMPANY: Acme')
    expect(user).toContain('PERSON (who you\'re asking, if known): Alex')
  })

  it('resumeLatex requires resume and validates latex output', async () => {
    await expect(resumeLatex({ resume: '' })).rejects.toMatchObject({ status: 400 })
    vi.mocked(completeJSON).mockResolvedValue({ latex: 'not latex', filenameHint: 'x' })
    await expect(resumeLatex({ resume: 'Enough resume text here to pass the gate.' })).rejects.toMatchObject({ status: 502 })
    vi.mocked(completeJSON).mockResolvedValue({
      latex: '\\documentclass{article}\\begin{document}Hello\\end{document}',
      filenameHint: 'jane-doe-backend',
    })
    const out = await resumeLatex({
      resume: 'Jane Doe — Backend engineer with Node.',
      tailor: { summary: 'Backend engineer focused on reliability.' },
    })
    expect(out.latex).toContain('\\documentclass')
    expect(out.filenameHint).toBe('jane-doe-backend')
  })
})
