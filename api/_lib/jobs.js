import { completeJSON, availableProviders } from './core.js'

// ── Agentic job matching ─────────────────────────────────────────────────────
// Upload a resume → we fetch live job postings and rank them for relevance to
// the candidate, with a short reason + the main gap for each. Reuses the same
// LLM provider stack as the rest of MockMate (OpenAI/Groq/Gemini); if no key is
// configured it falls back to a keyword-overlap ranker so the feature still works.

const STOP = new Set(('a an and the to of in for with on at by from is are be as or your you we our i '
  + 'work working experience years year team teams using used use strong excellent ability able skills '
  + 'role responsibilities requirements including etc across into over per via was were will would can').split(/\s+/))

function stripHtml(s = '') {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function keywords(text = '', limit = 12) {
  const freq = new Map()
  for (const raw of String(text).toLowerCase().match(/[a-z][a-z+#.]{2,}/g) || []) {
    if (STOP.has(raw)) continue
    freq.set(raw, (freq.get(raw) || 0) + 1)
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w)
}

// Map a role/resume to a Remotive category slug — its free-text `search` is too
// loose (a "backend" query returns analysts and writers), so we pull a topically
// relevant pool by category and let the ranker handle personal fit.
function categoryFor(text = '') {
  const t = text.toLowerCase()
  if (/\b(devops|sre|site reliability|infrastructure|platform engineer|sysadmin)\b/.test(t)) return 'devops-sysadmin'
  if (/\b(data scientist|machine learning|ml engineer|data engineer|data analyst|analytics)\b/.test(t)) return 'data'
  if (/\b(ux|ui|product design|graphic|designer)\b/.test(t)) return 'design'
  if (/\b(product manager|product owner)\b/.test(t)) return 'product'
  if (/\b(qa|quality assurance|test engineer|sdet)\b/.test(t)) return 'qa'
  if (/\b(marketing|seo|growth|content marketing)\b/.test(t)) return 'marketing'
  if (/\b(sales|account executive|business development)\b/.test(t)) return 'sales'
  if (/\b(writer|editor|copywriter|technical writer)\b/.test(t)) return 'writing'
  return 'software-dev'   // default — engineers, developers, backend/frontend/fullstack
}

// Live postings from Remotive's public API (no key required). Pulls by category
// (relevant pool), falling back to free-text search if the category is empty.
async function fetchJobs({ category, query }, limit = 50) {
  const get = async qs => {
    const r = await fetch(`https://remotive.com/api/remote-jobs?${qs}&limit=${limit}`, { headers: { 'User-Agent': 'MockMate/1.0' } })
    if (!r.ok) { const e = new Error(`Job source returned ${r.status}`); e.status = 502; throw e }
    return (await r.json()).jobs || []
  }
  let jobs = await get(`category=${encodeURIComponent(category)}`)
  if (!jobs.length && query) jobs = await get(`search=${encodeURIComponent(query)}`)
  return jobs.map(j => ({
    id: j.id,
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || 'Remote',
    jobType: j.job_type || '',
    category: j.category || '',
    url: j.url,
    tags: Array.isArray(j.tags) ? j.tags.slice(0, 8) : [],
    snippet: stripHtml(j.description).slice(0, 600)
  }))
}

// Keyword-overlap fallback (used when no LLM provider is configured). The pool is
// already topically relevant (fetched by category), so reward overlap generously
// and always return the best available rather than filtering down to nothing.
function rankHeuristic(jobs, resume, targetRole, max) {
  const profileKw = [...new Set(keywords(`${targetRole} ${resume}`, 25))]
  const roleWord = (targetRole || '').toLowerCase().split(/\s+/)[0]
  const scored = jobs.map(j => {
    const hay = `${j.title} ${j.tags.join(' ')} ${j.snippet}`.toLowerCase()
    const hits = profileKw.filter(k => hay.includes(k))
    const titleMatch = roleWord && roleWord.length > 2 && j.title.toLowerCase().includes(roleWord)
    const score = Math.min(96, hits.length * 9 + (titleMatch ? 12 : 0))
    return { ...j, score, reason: hits.length ? `Overlaps on: ${hits.slice(0, 6).join(', ')}` : 'Same field as your resume', gaps: '' }
  }).sort((a, b) => b.score - a.score)
  // Prefer ≥30 matches; if too few clear that bar, still show the top of the pool.
  const strong = scored.filter(j => j.score >= 30)
  return (strong.length >= 3 ? strong : scored).slice(0, max)
}

// LLM ranker — scores each posting 0-100 against the resume with a reason + gap.
async function rankWithLLM(jobs, resume, targetRole, provider, max) {
  const list = jobs.map((j, i) =>
    `[${i}] ${j.title} — ${j.company} (${j.location})${j.tags.length ? ` | tags: ${j.tags.join(', ')}` : ''}\n${j.snippet}`
  ).join('\n\n')

  const system = 'You are a precise job-matching assistant. Given a candidate resume and target role, '
    + 'score each job posting 0-100 for how well it fits THIS candidate (skills, seniority, domain, trajectory). '
    + 'Be honest — a generic title match with missing core skills is a low score. '
    + 'Return ONLY JSON: {"ranked":[{"index":<number>,"score":<0-100>,"reason":"<=18 words why it fits","gaps":"<=12 words main gap or empty"}]}. '
    + `Include only jobs scoring >= 50, best first, at most ${max}.`

  const user = `TARGET ROLE: ${targetRole || '(not specified — infer from resume)'}\n\n`
    + `RESUME:\n${String(resume).slice(0, 6000)}\n\n`
    + `JOB POSTINGS (rank these by index):\n${list}`

  const out = await completeJSON({
    maxTokens: 1800, provider,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  })
  const ranked = Array.isArray(out?.ranked) ? out.ranked : []
  return ranked
    .filter(r => jobs[r.index])
    .map(r => ({ ...jobs[r.index], score: Math.max(0, Math.min(100, Number(r.score) || 0)), reason: r.reason || '', gaps: r.gaps || '' }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
}

export async function findJobs({ resume = '', targetRole = '', query = '', max = 12 } = {}) {
  if (!resume.trim() && !targetRole.trim()) {
    const e = new Error('Add your resume (or a target role) first — Solo Practice → setup is where you paste it.')
    e.status = 400; throw e
  }
  // Pull a topically relevant pool by category; keep a free-text query as fallback.
  const category = categoryFor(`${targetRole} ${resume}`)
  const queryText = (query || targetRole || keywords(resume, 4).join(' ') || 'software engineer').trim()
  const jobs = await fetchJobs({ category, query: queryText })
  const search = `${category} · ${queryText}`
  if (!jobs.length) return { search, jobs: [], note: 'No live postings available right now. Try again shortly.' }

  const providers = availableProviders()
  if (providers.length) {
    try {
      const ranked = await rankWithLLM(jobs, resume, targetRole, providers[0].id, max)
      if (ranked.length) return { search, jobs: ranked, ranker: 'ai' }
    } catch { /* fall through to heuristic so the feature never hard-fails */ }
  }
  return { search, jobs: rankHeuristic(jobs, resume, targetRole, max), ranker: 'keyword' }
}
