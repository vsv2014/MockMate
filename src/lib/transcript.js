// Pure transcript helpers (no React/DOM) — extracted from LiveCompanion so they can be
// unit-tested and reused. Behavior identical to the originals.

// Collapse consecutive same-speaker segments into clean turns, so a session review reads
// as a real interviewer ↔ candidate conversation.
export function mergeTurns(log) {
  const out = []
  for (const e of log || []) {
    if (!e?.text?.trim()) continue
    const last = out[out.length - 1]
    if (last && last.role === e.role) last.text += ' ' + e.text.trim()
    else out.push({ role: e.role, text: e.text.trim() })
  }
  return out
}

// Normalize a question for dedup (lowercase, strip punctuation/extra spaces).
export function normalizeQ(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

// A late STRAGGLER of the SAME spoken sentence — normalized-equal, or one contains the
// other with only a tiny (<=2 word) difference (Deepgram re-emitting a corrected final).
// Deliberately NOT broad substring matching: a real rephrase or a later verbatim re-ask
// must still get a fresh answer.
export function isStragglerDuplicate(a, b) {
  const x = normalizeQ(a), y = normalizeQ(b)
  if (!x || !y) return false
  if (x === y) return true
  const lx = x.split(' ').length, ly = y.split(' ').length
  return (x.includes(y) || y.includes(x)) && Math.abs(lx - ly) <= 2
}
