// ── Company career-page adapters (the RIGHT way to "go to all career pages") ──
// Scraping arbitrary career pages is a trap: hundreds of ATS vendors, constant
// DOM churn, ToS violations and IP bans. Instead we read the PUBLIC JSON board
// APIs that the major ATS platforms expose for exactly this purpose — the same
// data the company's own careers site renders. Supported today:
//   • Greenhouse  — boards-api.greenhouse.io (used by ~5k companies: Zoom, Airtable, Coinbase…)
//   • Lever       — api.lever.co/v0/postings (used by Atlassian-adjacent, Notion, Ramp…)
// Detection accepts any career URL containing the board slug:
//   https://boards.greenhouse.io/zoom, https://job-boards.greenhouse.io/x, https://jobs.lever.co/notion
// Both endpoints are public, keyless, JSON, and ToS-friendly.

function stripHtml(s = '') {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function detectBoard(url = '') {
  const u = String(url || '').trim().toLowerCase()
  if (!u) return null
  let m
  if ((m = u.match(/greenhouse\.io\/([a-z0-9_-]+)/))) {
    const org = m[1]
    if (!['v1', 'jobs', 'job'].includes(org)) return { kind: 'greenhouse', org }
  }
  if ((m = u.match(/lever\.co\/([a-z0-9_.-]+)/))) {
    const org = m[1]
    if (!['v0', 'postings'].includes(org)) return { kind: 'lever', org }
  }
  return null
}

async function fetchGreenhouse(org, fetchImpl) {
  const r = await fetchImpl(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(org)}/jobs?content=true`)
  if (!r.ok) { const e = new Error(`Greenhouse board returned ${r.status}`); e.status = 502; throw e }
  const d = await r.json()
  return (Array.isArray(d.jobs) ? d.jobs : []).slice(0, 60).map(j => ({
    id: `gh_${j.id}`,
    title: j.title || 'Role',
    company: d.name || org,
    location: j.location?.name || '',
    jobType: '',
    category: '',
    url: j.absolute_url || '',
    tags: [],
    salary: '',
    salaryNum: 0,
    postedTs: j.updated_at ? (Date.parse(j.updated_at) || 0) : 0,
    snippet: stripHtml(j.content || '').slice(0, 600),
    source: 'company',
    sourceName: 'Company board',
  }))
}

async function fetchLever(org, fetchImpl) {
  const r = await fetchImpl(`https://api.lever.co/v0/postings/${encodeURIComponent(org)}?mode=json`)
  if (!r.ok) { const e = new Error(`Lever board returned ${r.status}`); e.status = 502; throw e }
  const d = await r.json()
  return (Array.isArray(d) ? d : []).slice(0, 60).map(j => ({
    id: `lv_${j.id}`,
    title: j.text || 'Role',
    company: org,
    location: [j.categories?.location, j.categories?.workplace].filter(Boolean).join(' · '),
    jobType: j.categories?.employment || '',
    category: j.categories?.team || '',
    url: j.hostedUrl || '',
    tags: [],
    salary: '',
    salaryNum: 0,
    postedTs: Number(j.createdAt) || 0,
    snippet: stripHtml(j.description || '').slice(0, 600),
    source: 'company',
    sourceName: 'Company board',
  }))
}

// Normalized postings from a company career URL; [] when the ATS isn't supported
// (caller keeps its other sources). Never throws for a bad URL — detection is null.
export async function fetchCompanyBoard(url, fetchImpl = fetch) {
  const b = detectBoard(url)
  if (!b) return []
  return b.kind === 'greenhouse' ? fetchGreenhouse(b.org, fetchImpl) : fetchLever(b.org, fetchImpl)
}
