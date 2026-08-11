/**
 * Resume Studio analysis draft — separate from Live/Solo profile.jobDescription.
 * Survives minimize (App used to unmount Career) and tab switches within Career.
 */
export const CAREER_DRAFT_KEY = 'mm-career-draft'

export function loadCareerDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(CAREER_DRAFT_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return {}
    return {
      jd: typeof raw.jd === 'string' ? raw.jd : '',
      person: typeof raw.person === 'string' ? raw.person : '',
      tab: ['ats', 'tailor', 'referral'].includes(raw.tab) ? raw.tab : undefined,
      limitedJd: !!raw.limitedJd,
      result: raw.result && typeof raw.result === 'object' ? raw.result : null,
      resultTab: ['ats', 'tailor', 'referral'].includes(raw.resultTab) ? raw.resultTab : null,
    }
  } catch {
    return {}
  }
}

export function saveCareerDraft(partial = {}) {
  try {
    const prev = loadCareerDraft()
    const next = {
      ...prev,
      ...partial,
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(CAREER_DRAFT_KEY, JSON.stringify(next))
    return next
  } catch {
    return null
  }
}
