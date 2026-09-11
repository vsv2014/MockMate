import { describe, it, expect, vi } from 'vitest'
import { applyTailorToResume, applyTailorWithBackup, restoreResumeBackup, saveProfile } from './profile.js'

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

describe('recoverable resume tailoring', () => {
  it('keeps the previous shared resume as a rollback point', () => {
    const profile = { resume: '- Built APIs', targetRole: 'Backend Engineer' }
    const next = applyTailorWithBackup(profile, {
      rewrittenBullets: [{ before: 'Built APIs', after: 'Built reliable APIs' }],
    })
    expect(next.resume).toContain('Built reliable APIs')
    expect(next.resumeBackup.text).toBe('- Built APIs')
    expect(next.resumeBackup.reason).toBe('before_tailor')
  })

  it('restores the backup and clears it', () => {
    const restored = restoreResumeBackup({
      resume: 'Tailored',
      resumeBackup: { text: 'Original', createdAt: '2026-01-01T00:00:00.000Z' },
    })
    expect(restored.resume).toBe('Original')
    expect(restored.resumeBackup).toBeUndefined()
  })

  it('reports profile persistence failure', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    expect(saveProfile({ resume: 'Original' })).toBe(false)
    vi.unstubAllGlobals()
  })
})
