/** Session / generation identity helpers — stale async callbacks must not mutate state. */

export function createSessionId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Mutable generation counter: bump to invalidate all prior async work for that lane. */
export function createGeneration(label = 'gen') {
  let n = 0
  return {
    label,
    current: () => n,
    bump: () => ++n,
    isCurrent: (g) => g === n,
  }
}

/** True if text length is enough for a Solo answer (space-split fails for CJK). */
export function hasEnoughAnswerLength(text) {
  const t = String(text || '').trim()
  if (!t) return false
  const words = t.split(/\s+/).filter(Boolean).length
  if (words >= 3) return true
  // CJK / dense scripts: use character count instead of spaces
  const chars = [...t.replace(/\s/g, '')].length
  return chars >= 8
}
