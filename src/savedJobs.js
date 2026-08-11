// Saved jobs — a local bookmark list of roles the user wants to track, stored only on
// this machine (localStorage). Same shape/retention discipline as history.js. Jobs come
// from the /api/jobs ranker, so each already has { id, title, company, url, score, ... }.

const KEY = 'mm-saved-jobs'
// Generous safety bound so localStorage never bloats (~1KB/entry → <0.5MB at the cap, well under
// the ~5MB quota). High enough that real users won't hit it; when they do, the UI warns rather
// than silently dropping the oldest bookmark (see the Saved tab in Jobs.jsx).
export const SAVED_MAX = 500

export const SAVED_STATUSES = ['interested', 'applied', 'interviewing', 'offer', 'passed']

// A stable key for dedupe — prefer the job's own id, fall back to the apply URL.
const keyOf = j => j?.id || j?.url || ''

// Newest-saved first.
export function loadSavedJobs() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr.sort((a, b) => (b.savedTs || 0) - (a.savedTs || 0)) : []
  } catch { return [] }
}

// Bookmark a job (no-op if already saved). Returns the updated list.
export function saveJob(job) {
  if (!keyOf(job)) return loadSavedJobs()
  try {
    const list = loadSavedJobs()
    if (list.some(j => keyOf(j) === keyOf(job))) return list
    const next = [{
      ...job,
      savedTs: Date.now(),
      status: SAVED_STATUSES.includes(job.status) ? job.status : 'interested',
      notes: typeof job.notes === 'string' ? job.notes : '',
    }, ...list].slice(0, SAVED_MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
    return next
  } catch { return loadSavedJobs() }   // quota exceeded etc. — non-fatal
}

export function removeSavedJob(jobOrId) {
  const k = typeof jobOrId === 'string' ? jobOrId : keyOf(jobOrId)
  try {
    const next = loadSavedJobs().filter(j => keyOf(j) !== k)
    localStorage.setItem(KEY, JSON.stringify(next))
    return next
  } catch { return loadSavedJobs() }
}

/** Patch status / notes on a saved job. Returns the updated list. */
export function updateSavedJob(jobOrId, patch = {}) {
  const k = typeof jobOrId === 'string' ? jobOrId : keyOf(jobOrId)
  if (!k) return loadSavedJobs()
  try {
    const list = loadSavedJobs()
    const next = list.map(j => {
      if (keyOf(j) !== k) return j
      const updated = { ...j }
      if (patch.status != null) {
        updated.status = SAVED_STATUSES.includes(patch.status) ? patch.status : j.status || 'interested'
      }
      if (patch.notes != null) updated.notes = String(patch.notes)
      return updated
    })
    localStorage.setItem(KEY, JSON.stringify(next))
    return next
  } catch { return loadSavedJobs() }
}

// A Set of saved keys — cheap membership checks while rendering the results list.
export function savedKeySet() {
  return new Set(loadSavedJobs().map(keyOf))
}

export const savedKeyOf = keyOf
