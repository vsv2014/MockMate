// Single source of truth for the candidate profile stored locally per account.
import { getScopedItem, setScopedItem } from './accountScope'

export const PROFILE_KEY = 'peerMockProfile'

export function loadProfile() {
  try { return JSON.parse(getScopedItem(PROFILE_KEY, '{}')) || {} } catch { return {} }
}

export function saveProfile(p) {
  try { return setScopedItem(PROFILE_KEY, JSON.stringify(p || {})) } catch { return false }
}

// Resume tailoring is intentionally recoverable. The base resume is shared by
// Career, Jobs, Solo and Live, so replacing it without a rollback point can
// contaminate every later flow.
export function applyTailorWithBackup(profile = {}, tailor = {}) {
  const current = String(profile.resume || '')
  return {
    ...profile,
    resume: applyTailorToResume(current, tailor),
    resumeBackup: profile.resumeBackup?.text ? profile.resumeBackup : {
      text: current,
      createdAt: new Date().toISOString(),
      reason: 'before_tailor',
    },
  }
}

export function restoreResumeBackup(profile = {}) {
  const text = profile?.resumeBackup?.text
  if (typeof text !== 'string') return profile
  const next = { ...profile, resume: text }
  delete next.resumeBackup
  return next
}

/**
 * Apply a tailor-resume result into existing resume text without inventing content.
 * Replaces matching bullets; prepends or replaces a short leading summary.
 */
export function applyTailorToResume(resume, tailor) {
  let text = String(resume || '')
  const summary = String(tailor?.summary || '').trim()
  const bullets = Array.isArray(tailor?.rewrittenBullets) ? tailor.rewrittenBullets : []

  for (const b of bullets) {
    const before = String(b?.before || '').trim()
    const after = String(b?.after || '').trim()
    if (!before || !after) continue
    if (text.includes(before)) text = text.split(before).join(after)
  }

  if (summary) {
    const lines = text.split(/\r?\n/)
    const heading = lines.findIndex(l => /^\s*(professional\s+)?(summary|profile)\s*:?\s*$/i.test(l))
    if (heading >= 0) {
      let end = heading + 1
      while (end < lines.length && lines[end].trim() && !/^\s*[A-Z][A-Z &/+-]{2,}\s*:?\s*$/.test(lines[end])) end++
      lines.splice(heading + 1, Math.max(0, end - heading - 1), summary)
      text = lines.join('\n')
    } else {
      const first = lines.findIndex(l => l.trim())
      const next = first >= 0 ? lines.findIndex((l, i) => i > first && l.trim()) : -1
      const firstText = first >= 0 ? lines[first].trim() : ''
      const looksContact = /@|https?:|linkedin|github|\+?\d[\d ()-]{7,}/i.test(firstText)
      const nextLooksBullet = next >= 0 && /^[-•*]|\d+\./.test(lines[next].trim())
      if (first >= 0 && !looksContact && !/^[-•*]|\d+\./.test(firstText) && nextLooksBullet && firstText.length <= 280) {
        lines.splice(first, 1, summary)
        text = lines.join('\n')
      } else {
        text = `${summary}\n\n${text.trimStart()}`
      }
    }
  }

  return text.trim() + (text.trim() ? '\n' : '')
}
