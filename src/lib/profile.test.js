import { describe, it, expect } from 'vitest'
import { applyTailorToResume } from './profile.js'

describe('applyTailorToResume', () => {
  it('replaces matching bullets', () => {
    const resume = 'SUMMARY\nDid stuff.\n\n- Built APIs\n- Led team'
    const out = applyTailorToResume(resume, {
      rewrittenBullets: [{ before: 'Built APIs', after: 'Built REST APIs serving 1M req/day' }],
    })
    expect(out).toContain('Built REST APIs serving 1M req/day')
    expect(out).not.toContain('- Built APIs\n')
  })

  it('prepends summary when no short summary block', () => {
    const resume = '- Bullet one\n- Bullet two'
    const out = applyTailorToResume(resume, { summary: 'Backend engineer with 5 years experience.' })
    expect(out.startsWith('Backend engineer with 5 years experience.')).toBe(true)
    expect(out).toContain('- Bullet one')
  })

  it('replaces a short leading summary', () => {
    const resume = 'Engineer who ships.\n\n- Built APIs'
    const out = applyTailorToResume(resume, { summary: 'Senior backend engineer focused on reliability.' })
    expect(out).toContain('Senior backend engineer focused on reliability.')
    expect(out).not.toContain('Engineer who ships.')
    expect(out).toContain('- Built APIs')
  })
})
