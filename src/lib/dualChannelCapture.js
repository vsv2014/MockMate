// A second microphone channel is exclusively candidate speech; it never
// feeds the interviewer's question detector or generates hints by itself.
// Duplicate final packets on a reconnect must not double-count an answer.
export function createCandidateMicGate({ now = () => Date.now(), duplicateWindowMs = 2500 } = {}) {
  let lastText = ''
  let lastAt = 0
  return ({ text, sourceId, sessionActive = true } = {}) => {
    if (!sessionActive || !sourceId || sourceId === 'microphone') return null
    const content = String(text ?? '').trim()
    if (content.split(/\s+/).filter(Boolean).length < 2) return null
    const normalized = content.replace(/\s+/g, ' ').toLowerCase()
    const timestamp = now()
    if (normalized === lastText && timestamp - lastAt >= 0 && timestamp - lastAt < duplicateWindowMs) return null
    lastText = normalized
    lastAt = timestamp
    return content
  }
}
