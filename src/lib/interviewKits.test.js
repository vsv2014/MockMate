import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activeInterviewKit,
  createInterviewKit,
  interviewKitFromProfile,
  loadInterviewKitState,
  profileFromInterviewKit,
  saveInterviewKitState,
} from './interviewKits.js'

const local = new Map()
const session = new Map()
vi.stubGlobal('localStorage', {
  getItem: key => local.get(key) ?? null,
  setItem: (key, value) => local.set(key, String(value)),
  removeItem: key => local.delete(key),
})
vi.stubGlobal('sessionStorage', {
  getItem: key => session.get(key) ?? null,
  setItem: (key, value) => session.set(key, String(value)),
  removeItem: key => session.delete(key),
})

beforeEach(() => { local.clear(); session.clear() })

describe('account-scoped Interview Kits', () => {
  it('seeds a separate first Kit from the shared profile exactly once', () => {
    session.set('mm-active-account-scope', 'account-a')
    const first = loadInterviewKitState({ targetRole: 'Staff Engineer', resume: 'Resume text' })
    expect(activeInterviewKit(first)).toMatchObject({ targetRole: 'Staff Engineer', resume: 'Resume text' })
    expect(local.get('mm-interview-kits::account-a')).toBeTruthy()

    const next = loadInterviewKitState({ targetRole: 'Changed shared role' })
    expect(activeInterviewKit(next).targetRole).toBe('Staff Engineer')
  })

  it('isolates stored Kits by account and falls back to a valid active Kit', () => {
    session.set('mm-active-account-scope', 'account-a')
    const kit = createInterviewKit({}, { id: 'kit-a', title: 'Platform role' })
    expect(saveInterviewKitState({ kits: [kit], activeKitId: 'missing' })).toBe(true)
    expect(activeInterviewKit(loadInterviewKitState()).id).toBe('kit-a')

    session.set('mm-active-account-scope', 'account-b')
    expect(loadInterviewKitState().kits).toEqual([])
  })

  it('builds and updates a Kit-owned profile without losing the rest of the Kit', () => {
    const kit = createInterviewKit({}, {
      id: 'kit-1', title: 'Backend at Acme', targetRole: 'Backend Engineer',
      targetCompany: 'Acme', resume: 'Original resume',
    })
    const profile = profileFromInterviewKit(kit, { modelStrategy: 'fast' })
    expect(profile).toMatchObject({ targetRole: 'Backend Engineer', resume: 'Original resume', modelStrategy: 'fast' })

    const updated = interviewKitFromProfile(kit, { ...profile, resume: 'Kit-only edit' })
    expect(updated.resume).toBe('Kit-only edit')
    expect(updated.targetCompany).toBe('Acme')
    expect(kit.resume).toBe('Original resume')
  })
})
