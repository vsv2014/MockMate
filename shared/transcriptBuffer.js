/**
 * Speaker-aware transcript fragment buffer.
 * Accumulates interviewer speech until a question boundary is established.
 * Never merges interviewer + candidate into one utterance.
 */
export const TRANSCRIPT_BUFFER_VERSION = 'transcript_buffer_v3_conservative_repair'

/**
 * Repair only high-confidence acoustic confusions. Never rewrite ordinary words such as city
 * names based solely on nearby technical context; a wrong transcript is better than silently
 * changing what the interviewer actually said.
 */
export function repairInterviewTerms(value, priorContext = '') {
  let text = String(value || '')
  const context = `${priorContext} ${text}`
  if (/\b(sql|query|window functions?|sub[ -]?quer(?:y|ies)|with clause|database|common table expression)\b/i.test(context)) {
    text = text.replace(/\bc\s+t\s+e\b/gi, 'CTE')
  }
  if (/\b(wait|retry|interval|timeout|playwright|code|element|api|condition)\b/i.test(context)) {
    text = text.replace(/\bpooling\s+(?:interval|loop|condition)\b/gi, m => m.replace(/^pooling/i, 'polling'))
  }
  if (/\b(security|access|control|role|permission|authori[sz]|user|testing)\b/i.test(context)) {
    text = text.replace(/\br\s*b\s*a\s*c\b/gi, 'RBAC')
  }
  return text
}

/** Remove only known control-marker artifacts. Intentional repeated words are preserved. */
export function sanitizeCaptureText(value) {
  return String(value || '')
    .replace(/\bAI\s+End\b/gi, ' ')
    .replace(/\bAI(?=\s+(?:okay|correct|sorry|wait|so|may|fine)\b)/gi, ' ')
    .replace(/\s+([,?.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function nid() { return `frag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` }

export function createTranscriptBuffer(opts = {}) {
  const maxFragments = opts.maxFragments || 40
  let fragments = []
  let lane = null

  function roleFromMeta(meta = {}) {
    if (meta.isCandidate) return 'candidate'
    if (['interviewer', 'candidate', 'unknown'].includes(meta.speakerRole)) return meta.speakerRole
    if (meta.diarizationLocked && meta.speaker != null && meta.interviewerSpeaker != null) {
      return String(meta.speaker) === String(meta.interviewerSpeaker) ? 'interviewer' : 'candidate'
    }
    if (meta.diarizationLocked && !meta.isCandidate) return 'interviewer'
    return 'unknown'
  }

  function flushLane() {
    if (!lane?.texts?.length) { lane = null; return null }
    const out = {
      text: lane.texts.join(' ').replace(/\s+/g, ' ').trim(), speaker: lane.speaker, speakerId: lane.speakerId,
      startedAt: lane.startedAt, updatedAt: lane.updatedAt, fragmentCount: lane.texts.length, finals: lane.finals,
    }
    lane = null
    return out
  }

  function push({ text, isFinal = false, confidence = null, ts = Date.now(), meta = {} } = {}) {
    const trimmed = sanitizeCaptureText(text)
    if (!trimmed) return { liveText: liveText(), flushed: null, rejected: 'empty' }
    const speaker = roleFromMeta(meta); const speakerId = meta.speaker != null ? String(meta.speaker) : null
    const frag = { id: nid(), text: trimmed, speaker, speakerId, isFinal: !!isFinal, confidence: confidence == null ? null : Number(confidence), ts }
    fragments.push(frag); if (fragments.length > maxFragments) fragments = fragments.slice(-maxFragments)

    let flushed = null
    if (lane && (lane.speaker !== speaker || (speakerId != null && lane.speakerId != null && lane.speakerId !== speakerId))) flushed = flushLane()
    if (!lane) {
      lane = { speaker, speakerId, texts: [trimmed], startedAt: ts, updatedAt: ts, finals: isFinal ? 1 : 0 }
    } else {
      const prev = lane.texts[lane.texts.length - 1] || ''
      const prevN = normalizeCaptureText(prev), nextN = normalizeCaptureText(trimmed)
      if (nextN === prevN) { if (isFinal) lane.finals += 1 }
      else if (nextN.startsWith(prevN) || prevN.startsWith(nextN)) {
        lane.texts[lane.texts.length - 1] = trimmed.length >= prev.length ? trimmed : prev
        if (isFinal) lane.finals += 1
      } else if (isContinuation(prev, trimmed)) {
        lane.texts[lane.texts.length - 1] = mergeOverlappingText(prev, trimmed)
        if (isFinal) lane.finals += 1
      } else {
        if (/\bactually[,—-]?\b/i.test(trimmed) || /\bno,?\s*i meant\b/i.test(trimmed)) lane.texts = [stripCorrectionLead(trimmed)]
        else lane.texts.push(trimmed)
        if (isFinal) lane.finals += 1
      }
      lane.updatedAt = ts
    }
    return { liveText: liveText(), flushed, rejected: null, fragment: frag, laneSpeaker: lane?.speaker }
  }

  function liveText() { return lane?.texts?.length ? lane.texts.join(' ').replace(/\s+/g, ' ').trim() : '' }
  function getLane() {
    if (!lane) return null
    return { text: liveText(), speaker: lane.speaker, speakerId: lane.speakerId, startedAt: lane.startedAt, updatedAt: lane.updatedAt, fragmentCount: lane.texts.length, finals: lane.finals, ageMs: Date.now() - lane.startedAt }
  }
  function clearLane() { lane = null }
  function takeLane() { return flushLane() }
  function recentFragments(n = 20) { return fragments.slice(-n).map(f => ({ ...f })) }
  return { version: TRANSCRIPT_BUFFER_VERSION, push, liveText, getLane, clearLane, takeLane, flushLane, recentFragments, roleFromMeta }
}

export function normalizeCaptureText(s) {
  return sanitizeCaptureText(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}
export function mergeOverlappingText(prev, next) {
  const a = sanitizeCaptureText(prev), b = sanitizeCaptureText(next)
  if (!a) return b; if (!b) return a
  const an = normalizeCaptureText(a), bn = normalizeCaptureText(b)
  if (an === bn) return a.length >= b.length ? a : b
  if (bn.startsWith(an)) return b; if (an.startsWith(bn)) return a
  const aw = a.split(/\s+/), bw = b.split(/\s+/)
  for (let n = Math.min(aw.length, bw.length); n >= 2; n--) {
    if (normalizeCaptureText(aw.slice(-n).join(' ')) === normalizeCaptureText(bw.slice(0, n).join(' '))) return [...aw, ...bw.slice(n)].join(' ')
  }
  return `${a} ${b}`.replace(/\s+/g, ' ').trim()
}
export function isContinuation(prev, next) {
  const a = String(prev || '').trim(), b = String(next || '').trim(); if (!a || !b) return false
  const an = normalizeCaptureText(a), bn = normalizeCaptureText(b); if (!an || !bn) return false
  if (bn.startsWith(an) || an.startsWith(bn)) return true
  const aw = an.split(' '), bw = bn.split(' ')
  for (let n = Math.min(aw.length, bw.length); n >= 2; n--) if (aw.slice(-n).join(' ') === bw.slice(0, n).join(' ')) return true
  if (b.split(/\s+/).length <= 12 && !/^[A-Z]/.test(b.replace(/^(okay|so|alright|actually)[,.]?\s+/i, ''))) return true
  return /^(and|or|with|for|to|that|which|who|when|where|of|the|a|an)\b/i.test(b)
}
function stripCorrectionLead(text) {
  return String(text || '').replace(/^[\s\S]{0,80}?\b(?:actually[,—-]?\s*|no,?\s*i meant\s*)/i, '').trim() || String(text || '').trim()
}
export function isDuplicateQuestion(a, b, { maxExtraWords = 2 } = {}) {
  const na = normalizeCaptureText(a), nb = normalizeCaptureText(b); if (!na || !nb) return false
  if (na === nb) return true
  const wa = na.split(' ').filter(Boolean), wb = nb.split(' ').filter(Boolean)
  if (Math.abs(wa.length - wb.length) > maxExtraWords) return false
  return na.includes(nb) || nb.includes(na)
}
