// ── YC startup jobs via the public HN "Who is hiring" pipeline ──────────────
// Y Combinator publishes NO public jobs JSON API (their board would require
// scraping — we don't scrape). But every month "Ask HN: Who is hiring?" goes
// up and hundreds of startups post there, YC companies tagging themselves
// "(YC W25)". The Algolia HN Search API is public, keyless and stable — the
// ToS-friendly, innovative way to surface live YC startup openings.

function stripHtml(s = '') {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// This month's "Ask HN: Who is hiring?" story id; falls back to last month
// (thread is posted on the 1st, so early-month searches still resolve).
export async function findHiringStoryId(fetchImpl, when = new Date()) {
  const prevMonth = (when.getMonth() + 11) % 12
  const candidates = [
    `${MONTHS[when.getMonth()]} ${when.getFullYear()}`,
    `${MONTHS[prevMonth]} ${prevMonth === 11 ? when.getFullYear() - 1 : when.getFullYear()}`,
  ]
  for (const label of candidates) {
    try {
      const q = encodeURIComponent(`"Ask HN: Who is hiring? (${label})"`)
      const r = await fetchImpl(`https://hn.algolia.com/api/v1/search?query=${q}&tags=story&hitsPerPage=1`)
      if (!r.ok) continue
      const d = await r.json()
      const id = d?.hits?.[0]?.objectID
      if (id) return id
    } catch { /* try previous month */ }
  }
  return null
}

const ROLE_RE = /\b(engineers?|developers?|designers?|product|data|scientists?|analysts?|managers?|lead|architects?|intern(ship)?s?|qa|sdet|sre|devops|security|growth|marketing|founder|generalists?|ml|ai)\b/i
const LOC_RE = /\b(remote|worldwide|anywhere|on-site|onsite|hybrid|india|usa|u\.s\.?|us only|north america|europe|emea|uk|canada|australia|singapore|germany|france|netherlands|ireland|bengaluru|bangalore|hyderabad|mumbai|delhi|pune|chennai|kolkata|toronto|vancouver|london|berlin|paris|amsterdam|dublin|sydney|melbourne|austin|seattle|new york|boston|chicago|san francisco)\b/i

// Parses one top-level hiring comment; null when it isn't a YC-tagged posting.
export function parseHiringComment(text = '', comment = {}) {
  const raw = String(text || '')
  const head = stripHtml(raw.split(/<\/?p[^>]*>/i)[0] || raw)
  if (!head) return null
  const isYc = /\(?\bYC\s+[A-Z]{1,2}\s?\d{2}\b\)?/i.test(head) || /\by combinator\b|\bwork at a startup\b/i.test(head)
  if (!isYc) return null

  const parts = head.split('|').map(stripHtml).filter(Boolean)
  const company = (parts[0] || head)
    .replace(/\(?\bYC\s+[A-Z]{1,2}\s?\d{2}\b\)?/i, '')
    .replace(/[,:(].*$/, '')
    .trim() || 'YC startup'
  const role = parts.slice(1).find(p => ROLE_RE.test(p)) || parts[1] || 'Engineer'
  const loc = parts.slice(1).filter(p => p !== role).find(p => LOC_RE.test(p))
    || ((/remote|worldwide|anywhere/i.test(head) ? 'Remote' : ''))
  const url = (raw.match(/https?:\/\/[^\s<>"')\]]+/) || [])[0]
    || `https://news.ycombinator.com/item?id=${comment.id || ''}`

  return {
    id: `hn_${comment.id || Math.abs([...head].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))}`,
    title: role,
    company,
    location: loc || '',
    jobType: parts.slice(1).find(p => /full-?time|part-?time|contract|internship/i.test(p)) || '',
    category: '',
    url,
    tags: [],
    salary: '',
    salaryNum: 0,
    postedTs: comment.created_at_i ? comment.created_at_i * 1000 : 0,
    snippet: stripHtml(raw).slice(0, 600),
    source: /remote|worldwide|anywhere|hybrid/i.test(loc || head) ? 'remote' : 'local',
    sourceName: 'YC startups (HN)',
  }
}

// Live YC-tagged openings from the current monthly hiring thread (max 40).
export async function fetchYcJobs(fetchImpl = fetch, when = new Date()) {
  const storyId = await findHiringStoryId(fetchImpl, when)
  if (!storyId) return []
  const r = await fetchImpl(`https://hn.algolia.com/api/v1/items/${storyId}`)
  if (!r.ok) { const e = new Error(`HN hiring thread returned ${r.status}`); e.status = 502; throw e }
  const d = await r.json()
  const comments = Array.isArray(d?.children) ? d.children : []
  const jobs = []
  for (const c of comments.slice(0, 500)) {
    const j = parseHiringComment(c.text || '', c)
    if (j) jobs.push(j)
    if (jobs.length >= 40) break
  }
  return jobs
}
