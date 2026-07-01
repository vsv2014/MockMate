import { completeJSON, availableProviders } from './core.js'
import { fetchWithTimeout as fetchT } from './http.js'

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
export function categoryFor(text = '') {
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

// Region tokens the candidate's location belongs to — used to decide which remote
// postings they can realistically take (Remotive jobs are remote but often region-locked
// via `candidate_required_location`, e.g. "Europe", "USA Only"). Worldwide/Anywhere is
// always OK. Errs toward inclusion; only filters out clearly-mismatched regions.
export function userRegionTokens(loc = '') {
  const u = loc.toLowerCase()
  const t = new Set()
  const add = (...xs) => xs.forEach(x => t.add(x))
  if (/\b(india|hyderabad|bangalore|bengaluru|mumbai|delhi|chennai|pune|kolkata|noida|gurgaon|gurugram|telangana|hyd)\b/.test(u)) add('india', 'asia', 'apac', 'asia-pacific', 'south asia')
  if (/\b(usa|u\.s|united states|new york|san francisco|seattle|austin|texas|california|boston|chicago)\b/.test(u)) add('usa', 'united states', ' us', 'north america', 'americas')
  if (/\b(canada|toronto|vancouver|montreal)\b/.test(u)) add('canada', 'north america', 'americas')
  if (/\b(uk|united kingdom|london|england|scotland|britain)\b/.test(u)) add('uk', 'united kingdom', 'europe', 'emea')
  if (/\b(germany|france|spain|netherlands|berlin|paris|amsterdam|poland|portugal|sweden|ireland|europe)\b/.test(u)) add('europe', 'emea', ' eu ')
  if (/\b(australia|sydney|melbourne|new zealand)\b/.test(u)) add('australia', 'apac', 'oceania')
  if (/\b(singapore|malaysia|philippines|indonesia|vietnam|thailand|japan|korea|hong kong)\b/.test(u)) add('asia', 'apac', 'asia-pacific')
  if (/\b(uae|dubai|abu dhabi|saudi|qatar|middle east|israel)\b/.test(u)) add('middle east', 'emea')
  // Always allow the raw country/first token too (e.g. an exact "Brazil" match).
  const first = u.split(/[ ,]+/).filter(Boolean).pop()
  if (first && first.length > 2) add(first)
  return t
}

// True if a posting is open to the candidate's region (or to everyone).
export function locationOk(jobLoc, tokens) {
  const j = (jobLoc || '').toLowerCase().trim()
  if (!j || /worldwide|anywhere|global|^remote$|^remote\b|^100% remote/.test(j)) return true
  if (!tokens || tokens.size === 0) return true
  // NOTE: do NOT trim — some tokens are space-padded (e.g. ' us ') on purpose to force
  // whole-word matching. Trimming made 'us' match 'aUStralia'/'belaRUS'. Pad jobLoc so a
  // padded token can still match at the string edges ("USA only" → " usa only ").
  const jp = ` ${j} `
  for (const tk of tokens) if (tk && jp.includes(tk)) return true
  return false
}

// Live postings from Remotive's public API (no key required). Pulls by category
// (relevant pool), falling back to free-text search if the category is empty.
async function fetchJobs({ category, query }, limit = 100) {
  const get = async qs => {
    const r = await fetchT(`https://remotive.com/api/remote-jobs?${qs}&limit=${limit}`, { headers: { 'User-Agent': 'MockMate/1.0' } })
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
    salaryNum: 0,                                                          // Remotive rarely has structured salary
    postedTs: j.publication_date ? (Date.parse(j.publication_date) || 0) : 0,
    snippet: stripHtml(j.description).slice(0, 600)
  }))
}

// ── Adzuna: real job board incl. LOCAL on-site roles (free API, covers India) ─────
// Needs ADZUNA_APP_ID + ADZUNA_APP_KEY (free at developer.adzuna.com). Unlike Remotive
// (remote-only), this returns city-level local jobs, so a Hyderabad user gets Hyderabad
// roles. Optional — if not configured, we just use the remote source.
export function adzunaConfigured() { return !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) }

// Adzuna requires a country code. Infer it from the candidate's location.
export function countryFor(loc = '') {
  const u = loc.toLowerCase()
  if (/\b(india|hyderabad|bangalore|bengaluru|mumbai|new delhi|delhi|chennai|pune|kolkata|noida|gurgaon|gurugram|telangana|hyd)\b/.test(u)) return 'in'
  if (/\b(united states|usa|u\.s|new york|san francisco|seattle|austin|texas|california|boston|chicago)\b/.test(u)) return 'us'
  if (/\b(united kingdom|uk|london|england|scotland|britain)\b/.test(u)) return 'gb'
  if (/\b(canada|toronto|vancouver|montreal)\b/.test(u)) return 'ca'
  if (/\b(australia|sydney|melbourne)\b/.test(u)) return 'au'
  if (/\b(germany|berlin|munich)\b/.test(u)) return 'de'
  if (/\b(france|paris)\b/.test(u)) return 'fr'
  if (/\b(netherlands|amsterdam)\b/.test(u)) return 'nl'
  if (/\b(singapore)\b/.test(u)) return 'sg'
  if (/\b(new zealand)\b/.test(u)) return 'nz'
  if (/\b(spain|madrid|barcelona)\b/.test(u)) return 'es'
  if (/\b(italy|rome|milan)\b/.test(u)) return 'it'
  if (/\b(brazil|sao paulo)\b/.test(u)) return 'br'
  if (/\b(poland|warsaw)\b/.test(u)) return 'pl'
  return null
}

async function fetchAdzuna({ what, where, country }, limit = 50) {
  const params = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID, app_key: process.env.ADZUNA_APP_KEY,
    results_per_page: String(Math.min(50, limit)), 'content-type': 'application/json'
  })
  if (what) params.set('what', what)
  if (where) params.set('where', where)
  const r = await fetchT(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`, { headers: { 'User-Agent': 'MockMate/1.0' } })
  if (!r.ok) { const e = new Error(`Adzuna returned ${r.status}`); e.status = 502; throw e }
  const data = await r.json()
  return (data.results || []).map(j => ({
    id: 'az_' + j.id,
    title: stripHtml(j.title || 'Role'),
    company: j.company?.display_name || 'Company',
    location: j.location?.display_name || where || '',
    jobType: j.contract_time || j.contract_type || '',
    category: j.category?.label || '',
    url: j.redirect_url,
    tags: [],
    salary: (j.salary_min || j.salary_max) ? `${j.salary_min ? Math.round(j.salary_min) : ''}${j.salary_max ? '–' + Math.round(j.salary_max) : ''}`.replace(/^–/, 'up to ') : '',
    salaryNum: Math.round(j.salary_max || j.salary_min || 0),       // for salary sort
    postedTs: j.created ? (Date.parse(j.created) || 0) : 0,         // for recency sort
    snippet: stripHtml(j.description || '').slice(0, 600),
    source: 'local'
  }))
}

// Keyword-overlap fallback (used when no LLM provider is configured). The pool is
// already topically relevant (fetched by category), so reward overlap generously
// and always return the best available rather than filtering down to nothing.
function rankHeuristic(jobs, resume, targetRole, max, tokens) {
  const profileKw = [...new Set(keywords(`${targetRole} ${resume}`, 25))]
  // Use the first MEANINGFUL role word (skip generic seniority terms) so "Senior Test
  // Engineer" matches on "test", not "senior" (which falsely matched unrelated roles).
  const SENIORITY = new Set(['senior', 'junior', 'sr', 'jr', 'lead', 'principal', 'staff', 'mid', 'associate', 'entry', 'chief', 'head'])
  const roleWord = (targetRole || '').toLowerCase().split(/\s+/).filter(w => w && !SENIORITY.has(w))[0]
  const scored = jobs.map(j => {
    const title = (j.title || '').toLowerCase()
    const tagStr = j.tags.join(' ').toLowerCase()
    const snip = (j.snippet || '').toLowerCase()
    // Matches in the TITLE/TAGS are strong signal; matches only in the description are weak
    // (a "Communications Manager" JD mentioning "engineer" shouldn't rank for a dev search).
    const titleTagHits = profileKw.filter(k => title.includes(k) || tagStr.includes(k))
    const snipHits = profileKw.filter(k => !title.includes(k) && !tagStr.includes(k) && snip.includes(k))
    const titleMatch = roleWord && roleWord.length > 2 && title.includes(roleWord)
    let score = Math.min(96, titleTagHits.length * 14 + snipHits.length * 3 + (titleMatch ? 18 : 0))
    // Push region-locked-elsewhere postings down so local/worldwide rises to the top.
    const locOk = locationOk(j.location, tokens)
    if (!locOk) score = Math.max(5, score - 30)
    const allHits = [...new Set([...titleTagHits, ...snipHits])]
    return { ...j, score, reason: allHits.length ? `Overlaps on: ${allHits.slice(0, 6).join(', ')}` : 'Same field as your resume', gaps: locOk ? '' : 'May be region-locked outside your location' }
  }).sort((a, b) => b.score - a.score)
  // Prefer ≥30 matches; if too few clear that bar, still show the top of the pool.
  const strong = scored.filter(j => j.score >= 30)
  return (strong.length >= 3 ? strong : scored).slice(0, max)
}

// LLM ranker — scores each posting 0-100 against the resume with a reason + gap.
async function rankWithLLM(jobs, resume, targetRole, location, provider, max) {
  const list = jobs.map((j, i) =>
    `[${i}] ${j.title} — ${j.company} (${j.location})${j.tags.length ? ` | tags: ${j.tags.join(', ')}` : ''}\n${j.snippet.slice(0, 400)}`
  ).join('\n\n')

  const system = 'You are a precise job-matching assistant. Given a candidate resume and target role, '
    + 'score each job posting 0-100 for how well it fits THIS candidate (skills, seniority, domain, trajectory). '
    + 'Be honest — a generic title match with missing core skills is a low score. '
    + (targetRole ? 'The TARGET ROLE is a HARD filter: a posting in a DIFFERENT discipline than the target — e.g. an AI/ML, Architect, or Data role when the target is a Test/QA Engineer — must score BELOW 40 even if some skills overlap. Only roles in the same job family as the target should score high. ' : '')
    + (location ? `The candidate is based in "${location}". A remote posting region-locked to a DIFFERENT region (not worldwide/anywhere and not open to the candidate's region) must score BELOW 40 — they cannot take it. Worldwide/anywhere or same-region roles are fine. ` : '')
    + 'Return ONLY JSON: {"ranked":[{"index":<number>,"score":<0-100>,"reason":"<=18 words why it fits","gaps":"<=12 words main gap or empty"}]}. '
    + `Include only jobs scoring >= 50, best first, at most ${max}.`

  const user = `TARGET ROLE: ${targetRole || '(not specified — infer from resume)'}\n`
    + `CANDIDATE LOCATION: ${location || '(not specified)'}\n\n`
    + `RESUME:\n${String(resume).slice(0, 6000)}\n\n`
    + `JOB POSTINGS (rank these by index):\n${list}`

  const out = await completeJSON({
    maxTokens: 2000, provider,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  })
  const ranked = Array.isArray(out?.ranked) ? out.ranked : []
  return ranked
    .filter(r => jobs[r.index])
    .map(r => ({ ...jobs[r.index], score: Math.max(0, Math.min(100, Number(r.score) || 0)), reason: r.reason || '', gaps: r.gaps || '' }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
}

export async function findJobs({ resume = '', targetRole = '', query = '', location = '', max = 40 } = {}) {
  if (!resume.trim() && !targetRole.trim() && !query.trim()) {
    const e = new Error('Add your resume (or a target role) first — Solo Practice → setup is where you paste it.')
    e.status = 400; throw e
  }
  // Category is driven by the explicit ROLE/query when given — so typing "Test Engineer"
  // isn't overridden by an AI/ML-heavy resume. Only fall back to the resume when no role.
  const roleText = (query || targetRole).trim()
  const category = categoryFor(roleText || resume)
  const queryText = (roleText || keywords(resume, 4).join(' ') || 'software engineer').trim()
  const loc = location.trim()
  const country = loc ? countryFor(loc) : null
  const localEnabled = adzunaConfigured()
  const search = `${category} · ${queryText}${loc ? ` · ${loc}` : ''}`

  // Fetch LOCAL on-site jobs (Adzuna, city-targeted) and REMOTE jobs (Remotive) IN PARALLEL —
  // they're independent network calls; running them concurrently roughly halves search latency.
  let remoteErr = null
  let [local, remote] = await Promise.all([
    (localEnabled && country)
      ? fetchAdzuna({ what: queryText, where: loc, country }, 50).catch(() => [])   // non-fatal
      : Promise.resolve([]),
    fetchJobs({ category, query: queryText }, 100)
      .then(js => js.map(j => ({ ...j, source: 'remote' })))
      .catch(e => { remoteErr = e; return [] })
  ])
  if (!remote.length && !local.length && remoteErr) throw remoteErr   // only hard-fail if we have nothing at all

  let tokens = null, note = ''
  if (loc) {
    tokens = userRegionTokens(loc)
    const okRemote = remote.filter(j => locationOk(j.location, tokens))
    // If we already have local jobs, only keep region-compatible remote ones. Otherwise
    // keep the broader remote pool (ranker pushes region-mismatched down) so it's not empty.
    remote = (local.length || okRemote.length >= 6) ? okRemote : remote
    if (!local.length && okRemote.length < 6) {
      note = localEnabled
        ? `Few roles matched "${loc}". Showing broader remote results.`
        : `Showing remote roles open to your region. 💡 Add free Adzuna keys in ⚙ Settings to also see LOCAL on-site jobs for "${loc}".`
    }
  }

  // Merge local-first + remote, de-duplicate by title+company.
  const seen = new Set()
  let jobs = [...local, ...remote].filter(j => {
    const k = `${(j.title || '').toLowerCase()}|${(j.company || '').toLowerCase()}`
    if (seen.has(k)) return false; seen.add(k); return true
  })
  if (!jobs.length) return { search, jobs: [], note: note || 'No live postings available right now. Try again shortly.', localEnabled }

  const pool = jobs.slice(0, 50)   // cap the pool sent to the ranker (cost/latency)
  const providers = availableProviders()
  if (providers.length) {
    try {
      const ranked = await rankWithLLM(pool, resume, targetRole, location, providers[0].id, max)
      if (ranked.length) return { search, jobs: ranked, ranker: 'ai', note, localEnabled }
    } catch { /* fall through to heuristic so the feature never hard-fails */ }
  }
  return { search, jobs: rankHeuristic(pool, resume, targetRole, max, tokens), ranker: 'keyword', note, localEnabled }
}
