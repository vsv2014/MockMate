// Single source of truth for the candidate profile stored in localStorage. Was
// copy-pasted (and had drifted) across Solo / Jobs / LiveCompanion. Shape (all optional):
// { name, currentRole, targetRole, targetCompany, yearsExp, resume, jobDescription,
//   language, codingLanguage, location, customPrompt, interviewType, voiceStyle }
export const PROFILE_KEY = 'peerMockProfile'

export function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {} } catch { return {} }
}

export function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch {}
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
    const firstNonEmpty = lines.findIndex(l => l.trim())
    // Heuristic: first 1–4 non-empty lines without bullet markers ≈ existing summary
    if (firstNonEmpty >= 0) {
      let end = firstNonEmpty
      let count = 0
      for (let i = firstNonEmpty; i < lines.length && count < 4; i++) {
        const t = lines[i].trim()
        if (!t) { if (count > 0) break; continue }
        if (/^[-•*]|\d+\./.test(t) || t.length > 280) break
        end = i
        count++
      }
      if (count >= 1 && count <= 4) {
        const next = [...lines]
        next.splice(firstNonEmpty, end - firstNonEmpty + 1, summary)
        text = next.join('\n')
      } else {
        text = `${summary}\n\n${text.trimStart()}`
      }
    } else {
      text = summary
    }
  }

  return text.trim() + (text.trim() ? '\n' : '')
}
