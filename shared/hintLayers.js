/** Split spoken answer prose into glance layers: opener → bullets → full. */
export function glanceLayers(prose = '', meta = {}) {
  const full = String(prose || '').trim()
  const sentences = full.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
  const opener = (meta.opener && String(meta.opener).trim()) || sentences[0] || full.slice(0, 140)
  let keyPoints = Array.isArray(meta.keyPoints) ? meta.keyPoints.map(String).filter(Boolean).slice(0, 4) : []
  if (!keyPoints.length && sentences.length > 1) {
    keyPoints = sentences.slice(1, 4).map(s => s.replace(/^[-•*]\s*/, '').slice(0, 110))
  }
  return { opener, keyPoints, fullAnswer: full }
}
