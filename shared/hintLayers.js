/** Detect interview META payloads the model sometimes dumps into the answer body. */
export function isHintMetaObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  if (obj.META && typeof obj.META === 'object') return true
  const keys = Object.keys(obj)
  if (!keys.length) return false
  const metaKeys = ['type', 'confidence', 'pattern', 'complexity', 'watch', 'watchOut', 'questionType']
  return metaKeys.some(k => k in obj)
}

export function unwrapHintMeta(obj) {
  if (!obj || typeof obj !== 'object') return {}
  if (obj.META && typeof obj.META === 'object') return { ...obj.META }
  return { ...obj }
}

const CODE_START = /^(?:async\s+)?(?:function\b|def\b|class\b|public\b|private\b|protected\b|static\b|const\b|let\b|var\b|await\b|import\b|from\b|#include\b|package\b|func\b|using\b)/i
const CODE_LANGUAGE_LINE = /^(python|java|c\+\+|javascript|typescript|go|c#|ruby)$/i

/** Convert loose model-emitted code into a fenced block for the Live renderer. */
export function ensureCodingCodeBlock(text, questionType = '') {
  const raw = String(text || '').trim()
  if (!raw || /```/.test(raw) || !/^(?:dsa|coding|screen_code)$/i.test(String(questionType || ''))) return raw
  const lines = raw.split('\n')
  const start = lines.findIndex(line => CODE_START.test(line.trim()))
  if (start < 0) return raw
  let language = ''
  let beforeEnd = start
  if (start > 0 && CODE_LANGUAGE_LINE.test(lines[start - 1].trim())) {
    language = lines[start - 1].trim().toLowerCase().replace('javascript', 'js').replace('typescript', 'ts')
    beforeEnd = start - 1
  }
  const before = lines.slice(0, beforeEnd).join('\n').trimEnd()
  const code = lines.slice(start).join('\n').trim()
  return `${before ? `${before}\n\n` : ''}\`\`\`${language}\n${code}\n\`\`\``
}

/** Pull a balanced {...} starting at index `from` (must be '{'). Returns end index exclusive or -1. */
function findBalancedJsonEnd(text, from = 0) {
  if (text[from] !== '{') return -1
  let depth = 0, inStr = false, esc = false
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1 // incomplete
}

/**
 * Strip leaked META / JSON from model output.
 * Returns { meta, prose }. Safe to call repeatedly on a growing stream buffer.
 * If leading JSON is incomplete, returns { meta: null, prose: '', pending: true }.
 */
export function stripHintMeta(raw = '') {
  let t = String(raw || '').replace(/^\uFEFF/, '')
  let meta = {}
  let pending = false

  // ```json ... ``` wrappers (whole or leading)
  t = t.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '')

  // Leading "META:" line(s)
  while (true) {
    const m = t.match(/^\s*META:\s*/i)
    if (!m) break
    const start = m[0].length
    const brace = t.indexOf('{', start)
    if (brace === -1) { pending = true; return { meta, prose: '', pending } }
    const end = findBalancedJsonEnd(t, brace)
    if (end === -1) { pending = true; return { meta, prose: '', pending } }
    try {
      const parsed = JSON.parse(t.slice(brace, end))
      if (isHintMetaObject(parsed)) meta = { ...meta, ...unwrapHintMeta(parsed) }
    } catch { /* ignore */ }
    t = t.slice(end).replace(/^\s*\n?/, '')
  }

  // Leading bare JSON object / {"META":{...}}
  while (t.trimStart().startsWith('{')) {
    const start = t.search(/\{/)
    const end = findBalancedJsonEnd(t, start)
    if (end === -1) { pending = true; return { meta, prose: '', pending } }
    let parsed
    try { parsed = JSON.parse(t.slice(start, end)) } catch { break }
    if (!isHintMetaObject(parsed)) break
    meta = { ...meta, ...unwrapHintMeta(parsed) }
    t = t.slice(end).replace(/^\s*\n?/, '')
  }

  // Trailing / mid-line duplicate META JSON blobs (models often repeat the header at the end)
  const stripTrailingMeta = () => {
    const re = /\n?\s*(?:META:\s*)?(\{[\s\S]*\}$)/i
    const m = t.match(re)
    if (!m) return false
    const brace = m[1].indexOf('{')
    const chunk = m[1]
    const abs = t.lastIndexOf(chunk)
    if (abs === -1) return false
    const end = findBalancedJsonEnd(t, abs)
    if (end !== abs + chunk.length && end !== t.length) return false
    try {
      const parsed = JSON.parse(t.slice(abs, end === -1 ? abs + chunk.length : end))
      if (!isHintMetaObject(parsed)) return false
      meta = { ...meta, ...unwrapHintMeta(parsed) }
      t = t.slice(0, abs).trimEnd()
      return true
    } catch { return false }
  }
  while (stripTrailingMeta()) { /* repeat */ }

  // Line-wise: drop any line that is ONLY a meta JSON object
  t = t.split('\n').filter(line => {
    const s = line.trim()
    if (!s.startsWith('{') || !s.endsWith('}')) return true
    try {
      const parsed = JSON.parse(s)
      if (isHintMetaObject(parsed)) {
        meta = { ...meta, ...unwrapHintMeta(parsed) }
        return false
      }
    } catch { /* keep */ }
    return true
  }).join('\n')

  // Drop orphaned "META:" labels with no payload
  t = t.replace(/^\s*META:\s*$/gim, '').trim()

  return { meta, prose: t, pending }
}

/** Split spoken answer prose into glance layers: opener → bullets → full. */
export function glanceLayers(prose = '', meta = {}) {
  const cleaned = stripHintMeta(prose)
  const mergedMeta = { ...cleaned.meta, ...meta }
  const full = String(cleaned.prose || '').trim()
  // Never use a JSON leftover as the opener.
  const safeFull = full.startsWith('{') ? stripHintMeta(full).prose.trim() : full
  const sentences = safeFull.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
    .filter(s => !(s.startsWith('{') && s.includes('"type"')))
  const openerRaw = (mergedMeta.opener && String(mergedMeta.opener).trim()) || sentences[0] || safeFull.slice(0, 140)
  const opener = openerRaw.startsWith('{') ? (sentences[0] || safeFull.replace(/^\{[\s\S]*?\}\s*/, '').slice(0, 140)) : openerRaw
  let keyPoints = Array.isArray(mergedMeta.keyPoints) ? mergedMeta.keyPoints.map(String).filter(Boolean).slice(0, 4) : []
  if (!keyPoints.length && sentences.length > 1) {
    keyPoints = sentences.slice(1, 4).map(s => s.replace(/^[-•*]\s*/, '').slice(0, 110))
  }
  // Prefer watch from stripped meta if UI meta lacked it
  const watchOut = mergedMeta.watchOut || mergedMeta.watch || null
  return { opener, keyPoints, fullAnswer: safeFull, meta: mergedMeta, watchOut }
}
