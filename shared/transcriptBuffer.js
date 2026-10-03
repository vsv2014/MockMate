/**
 * Speaker-aware transcript fragment buffer (M2).
 * Accumulates interviewer speech until a question boundary is established.
 * Never merges interviewer + candidate into one utterance.
 */

export const TRANSCRIPT_BUFFER_VERSION = 'transcript_buffer_v3_verbatim'

/**
 * Preserve recognized content verbatim. Provider keyterms and downstream semantic reasoning
 * are safer than lexical rewrites such as city→CTE or Chennai→CI, which can corrupt a real
 * interview answer/question. Kept as an API for callers that already invoke it.
 */
export function repairInterviewTerms(value, _priorContext = '') {
  return String(value || '')
}

/** Remove only known control-word artifacts. Do not collapse repeated words: repetition can
 * be intentional speech ("very very", "had had") and belongs in the transcript/evaluation. */
export function sanitizeCaptureText(value) {
  return String(value || '')
    .replace(/\bAI\s+End\b/gi, ' ')
    .replace(/\bAI(?=\s+(?:okay|correct|sorry|wait|so|may|fine)\b)/gi, ' ')
    .replace(/\s+([,?.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

import { nid as makeId } from './id.js'

/** @typedef {'interviewer'|'candidate'|'unknown'} SpeakerRole */

function nid() {
  return makeId('frag', 4)
}

/**
 * @param {{ maxFragments?: number }} [opts]
 */
export function createTranscriptBuffer(opts = {}) {
  const maxFragments = opts.maxFragments || 40
  /** @type {{ id: string, text: string, speaker: SpeakerRole, speakerId: string|null, isFinal: boolean, confidence: number|null, ts: number }[]} */
  let fragments = []
  /** Active accumulation lane (one speaker at a time). */
  let lane = null

  function roleFromMeta(meta = {}) {
    if (meta.isCandidate) return 'candidate'
    if (meta.speakerRole === 'interviewer' || meta.speakerRole === 'candidate' || meta.speakerRole === 'unknown') return meta.speakerRole
    if (meta.diarizationLocked && meta.speaker != null && meta.interviewerSpeaker != null) {
      return String(meta.speaker) === String(meta.interviewerSpeaker) ? 'interviewer' : 'candidate'
    }
    if (meta.diarizationLocked && !meta.isCandidate) return 'interviewer'
    return 'unknown'
  }

  function flushLane() {
    if (!lane || !lane.texts.length) { lane = null; return null }
    const text = lane.texts.join(' ').replace(/\s+/g, ' ').trim()
    const out = { text, speaker: lane.speaker, speakerId: lane.speakerId, startedAt: lane.startedAt, updatedAt: lane.updatedAt, fragmentCount: lane.texts.length, finals: lane.finals }
    lane = null
    return out
  }

  function push({ text, isFinal = false, confidence = null, ts = Date.now(), meta = {} } = {}) {
    const trimmed = sanitizeCaptureText(text)
    if (!trimmed) return { liveText: liveText(), flushed: null, rejected: 'empty' }

    const speaker = roleFromMeta(meta)
    const speakerId = meta.speaker != null ? String(meta.speaker) : null
    const frag = { id: nid(), text: trimmed, speaker, speakerId, isFinal: !!isFinal, confidence: confidence == null ? null : Number(confidence), ts }
    fragments.push(frag)
    if (fragments.length > maxFragments) fragments = fragments.slice(-maxFragments)

    let flushed = null
    if (lane && (lane.speaker !== speaker || (speakerId != null && lane.speakerId != null && lane.speakerId !== speakerId))) flushed = flushLane()

    if (!lane) {
      lane = { speaker, speakerId, texts: [trimmed], startedAt: ts, updatedAt: ts, finals: isFinal ? 1 : 0 }
    } else {
      const prev = lane.texts[lane.texts.length - 1] || ''
      const prevN = normalizeCaptureText(prev)
      const nextN = normalizeCaptureText(trimmed)
      if (nextN === prevN) {
        if (isFinal) lane.finals += 1
      } else if (nextN.startsWith(prevN) || prevN.startsWith(nextN)) {
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
  if (!a) return b
  if (!b) return a
  const an = normalizeCaptureText(a), bn = normalizeCaptureText(b)
  if (an === bn) return a.length >= b.length ? a : b
  if (bn.startsWith(an)) return b
  if (an.startsWith(bn)) return a
  const aw = a.split(/\s+/), bw = b.split(/\s+/)
  const max = Math.min(aw.length, bw.length)
  for (let n = max; n >= 2; n--) {
    const tail = normalizeCaptureText(aw.slice(-n).join(' ')), head = normalizeCaptureText(bw.slice(0, n).join(' '))
    if (tail === head) return [...aw, ...bw.slice(n)].join(' ')
  }
  return `${a} ${b}`.replace(/\s+/g, ' ').trim()
}

export function isContinuation(prev, next) {
  const a = String(prev || '').trim(), b = String(next || '').trim()
  if (!a || !b) return false
  const an = normalizeCaptureText(a), bn = normalizeCaptureText(b)
  if (!an || !bn) return false
  if (bn.startsWith(an) || an.startsWith(bn)) return true
  const aw = an.split(' '), bw = bn.split(' ')
  for (let n = Math.min(aw.length, bw.length); n >= 2; n--) if (aw.slice(-n).join(' ') === bw.slice(0, n).join(' ')) return true
  if (b.split(/\s+/).length <= 12 && !/^[A-Z]/.test(b.replace(/^(okay|so|alright|actually)[,.]?\s+/i, ''))) return true
  if (/^(and|or|with|for|to|that|which|who|when|where|of|the|a|an)\b/i.test(b)) return true
  return false
}

function stripCorrectionLead(text) {
  return String(text || '').replace(/^[\s\S]{0,80}?\b(?:actually[,—-]?\s*|no,?\s*i meant\s*)/i, '').trim() || String(text || '').trim()
}

export function isDuplicateQuestion(a, b, { maxExtraWords = 2 } = {}) {
  const na = normalizeCaptureText(a), nb = normalizeCaptureText(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const wa = na.split(' ').filter(Boolean), wb = nb.split(' ').filter(Boolean)
  if (Math.abs(wa.length - wb.length) > maxExtraWords) return false
  if (na.includes(nb) || nb.includes(na)) return true
  return false
}
