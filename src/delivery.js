// ── Delivery analysis engine ───────────────────────────────────────────────────
// Pure, dependency-free analysis of the CANDIDATE's own speech. Shared by the
// live coach HUD (during practice), the post-interview replay timeline, and any
// other delivery feedback. It coaches HOW you speak — it never produces answers.

// High-signal verbal fillers. Multiword phrases are matched as phrases.
export const FILLERS = [
  'um', 'uh', 'er', 'ah', 'hmm', 'like', 'you know', 'i mean',
  'basically', 'literally', 'actually', 'honestly', 'kind of', 'sort of',
  'i guess', 'or whatever', 'stuff like that'
]

// Hollow corporate buzzwords that weaken technical answers (mirrors the
// evaluator's list in electron/main.js so live + final feedback agree).
export const JARGON = [
  'leverage', 'robust', 'seamless', 'delve', 'comprehensive', 'facilitate',
  'utilize', 'best-in-class', 'cutting-edge', 'synergy', 'holistic', 'paradigm',
  'ecosystem', 'streamline', 'move the needle', 'circle back', 'low-hanging fruit',
  'deep dive', 'think outside the box', 'game changer', 'mission critical'
]

// Hedging / low-confidence markers.
export const HEDGES = [
  'i think', 'i guess', 'i feel like', 'maybe', 'perhaps', 'probably',
  'possibly', 'sort of', 'kind of', 'i suppose', "i'm not sure", 'might be', 'just'
]

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// Count whole-word / whole-phrase occurrences of each term in `text`.
// Returns { count, items: [{ term, count }] } sorted by frequency.
function countTerms(text, terms) {
  const lower = ` ${text.toLowerCase()} `
  const items = []
  let count = 0
  for (const term of terms) {
    const re = new RegExp(`(?<![\\w-])${escapeRegExp(term)}(?![\\w-])`, 'g')
    const n = (lower.match(re) || []).length
    if (n > 0) { items.push({ term, count: n }); count += n }
  }
  items.sort((a, b) => b.count - a.count)
  return { count, items }
}

export function countWords(text) {
  const m = (text || '').trim().match(/[A-Za-z0-9'’-]+/g)
  return m ? m.length : 0
}

function splitSentences(text) {
  return (text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// Core analysis. `durationMs` (optional) enables words-per-minute / pace.
export function analyze(text = '', durationMs = null) {
  const words = countWords(text)
  const fillers = countTerms(text, FILLERS)
  const jargon = countTerms(text, JARGON)
  const hedges = countTerms(text, HEDGES)
  const sentences = splitSentences(text)
  const sentenceLens = sentences.map(countWords)
  const longSentences = sentenceLens.filter(n => n > 40).length
  const avgSentenceLen = sentences.length ? Math.round(words / sentences.length) : 0

  const seconds = durationMs ? durationMs / 1000 : null
  const wpm = seconds && seconds > 2 && words > 3 ? Math.round((words / seconds) * 60) : null

  return {
    words,
    durationMs: durationMs || null,
    seconds: seconds ? Math.round(seconds) : null,
    wpm,
    fillers,
    jargon,
    hedges,
    sentences: sentences.length,
    avgSentenceLen,
    longSentences,
    fillerPer100: words ? Math.round((fillers.count / words) * 1000) / 10 : 0
  }
}

// ── Ratings (good | ok | weak) ────────────────────────────────────────────────
// Spoken-pace bands. Conversational interview speech sits ~120–160 wpm.
export function paceRating(wpm) {
  if (wpm == null) return null
  if (wpm < 105) return { rating: 'ok', label: 'a bit slow' }
  if (wpm <= 165) return { rating: 'good', label: 'natural pace' }
  if (wpm <= 190) return { rating: 'ok', label: 'a touch fast' }
  return { rating: 'weak', label: 'too fast' }
}

export function fillerRating(per100) {
  if (per100 <= 2) return 'good'
  if (per100 <= 5) return 'ok'
  return 'weak'
}

export function lengthRating(words, spoken) {
  // Spoken answers should land in a focused window; typed answers can run longer.
  const ceiling = spoken ? 230 : 320
  if (words === 0) return null
  if (words < 12) return { rating: 'ok', label: 'very short' }
  if (words <= ceiling) return { rating: 'good', label: 'focused' }
  if (words <= ceiling * 1.5) return { rating: 'ok', label: 'getting long' }
  return { rating: 'weak', label: 'rambling' }
}

// The single most useful live nudge for the answer being drafted right now.
// Returns { rating, text } or null when there's nothing worth saying yet.
export function liveNudge(stats, { spoken = false } = {}) {
  if (!stats || stats.words < 6) return null
  const len = lengthRating(stats.words, spoken)
  if (len && len.rating === 'weak') return { rating: 'weak', text: `You're rambling (${stats.words} words) — land your point and stop.` }
  if (stats.fillers.count >= 4) {
    const top = stats.fillers.items[0]
    return { rating: 'weak', text: `${stats.fillers.count} fillers${top ? ` (“${top.term}” ×${top.count})` : ''} — slow down and pause instead.` }
  }
  if (stats.jargon.count >= 2) {
    return { rating: 'ok', text: `Sounds buzzwordy: ${stats.jargon.items.slice(0, 2).map(j => `“${j.term}”`).join(', ')} — say it plainly.` }
  }
  if (spoken && stats.wpm && paceRating(stats.wpm)?.rating === 'weak') {
    return { rating: 'weak', text: `Speaking fast (${stats.wpm} wpm) — breathe and slow down.` }
  }
  if (len && len.rating === 'ok' && len.label === 'getting long') {
    return { rating: 'ok', text: `Getting long — start wrapping up.` }
  }
  if (stats.hedges.count >= 3) {
    return { rating: 'ok', text: `A lot of hedging — commit to your answer.` }
  }
  if (len && len.rating === 'good' && stats.fillers.count <= 1) {
    return { rating: 'good', text: `Concise and clear — keep it up.` }
  }
  return null
}
