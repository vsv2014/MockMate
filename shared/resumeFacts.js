// ── Structured resume fact extraction ────────────────────────────────────────
// The matching core used to treat the resume as flat text. This extracts the
// few facts that materially change ranking quality — total experience (from
// explicit "N years" mentions AND employment date spans), a seniority band,
// education level and certifications — so BOTH rankers (LLM and keyword
// fallback) can enforce seniority fit honestly, without inventing anything.
// Everything here is extractive/advisory: nothing is ever fabricated.

const CURRENT_YEAR = new Date().getFullYear()

function parseYear(y) {
  const n = parseInt(y, 10)
  return Number.isFinite(n) ? n : null
}

// Longest employment date span, e.g. "2019 – Present", "2016-2021".
export function maxDateSpan(text = '') {
  let best = 0
  const re = /\b((?:19|20)\d{2})\s*(?:-|–|—|to|through)\s*((?:19|20)\d{2}|present|current|today)\b/gi
  for (const m of String(text).matchAll(re)) {
    const start = parseYear(m[1])
    const end = /present|current|today/i.test(m[2]) ? CURRENT_YEAR : parseYear(m[2])
    if (start == null || end == null || end < start) continue
    best = Math.max(best, end - start)
  }
  return best
}

// Largest explicit "N years / N+ yrs" mention (capped at a sane 45).
export function maxExplicitYears(text = '') {
  let best = 0
  const re = /\b(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?\.?)\b/gi
  for (const m of String(text).matchAll(re)) {
    const n = parseInt(m[1], 10)
    if (n <= 45) best = Math.max(best, n)
  }
  return best
}

// Total experience proxy: the more conservative of the two signals is WRONG
// here — resumes under-state in either direction, so take the max but cap it.
export function extractYearsTotal(text = '') {
  const y = Math.max(maxExplicitYears(text), maxDateSpan(text))
  return y > 0 ? Math.min(y, 45) : null
}

// 0 junior · 1 mid · 2 senior · 3 staff/lead — null when unknown.
export function bandForYears(years) {
  if (years == null || !Number.isFinite(years)) return null
  if (years < 2) return 0
  if (years < 5) return 1
  if (years < 9) return 2
  return 3
}

export function titleBand(title = '') {
  const t = String(title).toLowerCase()
  if (/\b(intern|internship|trainee)\b/.test(t)) return 0
  if (/\b(junior|jr|associate|entry|graduate|apprentice)\b/.test(t)) return 0
  if (/\b(staff|principal|lead|architect|director|head|vp|chief|fellow)\b/.test(t)) return 3
  if (/\b(senior|sr)\b/.test(t)) return 2
  return 1
}

export function extractEducation(text = '') {
  const t = String(text).toLowerCase()
  const out = []
  if (/\b(ph\.?d|doctorate)\b/.test(t)) out.push('phd')
  if (/\b(mba|master|ms|m\.?sc|m\.?tech|postgrad)\b/.test(t)) out.push('masters')
  if (/\b(bachelor|bs|b\.?sc|b\.?tech|b\.?e|undergrad|bca)\b/.test(t)) out.push('bachelors')
  return out
}

const CERT_PATTERNS = [
  ['aws', /\b(aws|amazon web services)[^.\n]{0,40}(certified|associate|professional)\b|\b(aws certified)\b/i],
  ['gcp', /\b(google cloud|gcp)[^.\n]{0,40}certified\b|\b(gcp certified)\b/i],
  ['azure', /\b(azure)[^.\n]{0,40}(certified|administrator|developer)\b|\b(az-\d{3})\b/i],
  ['cka', /\b(cka|ckad|certified kubernetes)\b/i],
  ['pmp', /\bpmp\b|\bproject management professional\b/i],
  ['csm', /\bcsm\b|\bcertified scrum master\b/i],
  ['terraform', /\bterraform associate\b/i],
]

export function extractCerts(text = '') {
  return CERT_PATTERNS.filter(([, re]) => re.test(String(text))).map(([id]) => id)
}

// One structured, honest read of the resume.
export function resumeFacts(text = '') {
  const years = extractYearsTotal(text)
  return {
    years,
    band: bandForYears(years),
    education: extractEducation(text),
    certs: extractCerts(text),
  }
}

// First integer of a user-typed experience string ("5-8 years" → 5).
export function parseYearsExpInput(s = '') {
  const m = String(s).match(/\d{1,2}/)
  return m ? parseInt(m[0], 10) : null
}
