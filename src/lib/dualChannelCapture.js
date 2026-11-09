// A second microphone channel is exclusively candidate speech; it never
// feeds the interviewer's question detector or generates hints by itself.
// Duplicate final packets on a reconnect must not double-count an answer.
const normalizedSpeech = text => String(text ?? '').toLowerCase().replace(/[^\\p{L}\\p{N}\\s]/gu, ' ').replace(/\\s+/g, ' ').trim()\n\nexport function createCandidateMicGate({ now = () => Date.now(), duplicateWindowMs = 2500, echoWindowMs = 1800 } = {}) {
  let lastText = ''
  let lastAt = 0
  return ({ text, sourceId, sessionActive = true, systemFinal = null } = {}) => {
    if (!sessionActive || !sourceId || sourceId === 'microphone') return null
    const content = String(text ?? '').trim()
    if (content.split(/\s+/).filter(Boolean).length < 2) return null
    const normalized = normalizedSpeech(content)
    const timestamp = now()
    // Conservative echo gate: a microphone packet matching the recent system
    // playback transcript is almost certainly speaker feedback, not candidate speech.
    // Never use approximate similarity to discard independent candidate answers.
    if (normalized.split(' ').length >= 4 && systemFinal &&
      timestamp - Number(systemFinal.at) >= 0 && timestamp - Number(systemFinal.at) <= echoWindowMs &&
      normalized === normalizedSpeech(systemFinal.text)) return null
    if (normalized === lastText && timestamp - lastAt >= 0 && timestamp - lastAt < duplicateWindowMs) return null
    lastText = normalized
    lastAt = timestamp
    return content
  }
}
