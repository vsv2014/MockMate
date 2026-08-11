/**
 * Speaker-aware transcript fragment buffer (M2).
 * Accumulates interviewer speech until a question boundary is established.
 * Never merges interviewer + candidate into one utterance.
 */

export const TRANSCRIPT_BUFFER_VERSION = 'transcript_buffer_v1'

/** @typedef {'interviewer'|'candidate'|'unknown'} SpeakerRole */

function nid() {
  return `frag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * @param {{ maxFragments?: number }} [opts]
 */
export function createTranscriptBuffer(opts = {}) {
  const maxFragments = opts.maxFragments || 40
  /** @type {{ id: string, text: string, speaker: SpeakerRole, speakerId: string|null, isFinal: boolean, confidence: number|null, ts: number }[]} */
  let fragments = []
  /** Active accumulation lane (one speaker at a time). */
  let lane = null // { speaker, speakerId, texts: string[], startedAt, updatedAt, finals: number }

  function roleFromMeta(meta = {}) {
    if (meta.isCandidate) return 'candidate'
    if (meta.speakerRole === 'interviewer' || meta.speakerRole === 'candidate' || meta.speakerRole === 'unknown') {
      return meta.speakerRole
    }
    if (meta.diarizationLocked && meta.speaker != null && meta.interviewerSpeaker != null) {
      return String(meta.speaker) === String(meta.interviewerSpeaker) ? 'interviewer' : 'candidate'
    }
    if (meta.diarizationLocked && !meta.isCandidate) return 'interviewer'
    return 'unknown'
  }

  function flushLane() {
    if (!lane || !lane.texts.length) {
      lane = null
      return null
    }
    const text = lane.texts.join(' ').replace(/\s+/g, ' ').trim()
    const out = {
      text,
      speaker: lane.speaker,
      speakerId: lane.speakerId,
      startedAt: lane.startedAt,
      updatedAt: lane.updatedAt,
      fragmentCount: lane.texts.length,
      finals: lane.finals,
    }
    lane = null
    return out
  }

  /**
   * Push a STT fragment. Returns { liveText, flushed, rejected }.
   * Speaker change flushes prior lane (does NOT drop it).
   */
  function push({ text, isFinal = false, confidence = null, ts = Date.now(), meta = {} } = {}) {
    const trimmed = String(text || '').trim()
    if (!trimmed) return { liveText: liveText(), flushed: null, rejected: 'empty' }

    const speaker = roleFromMeta(meta)
    const speakerId = meta.speaker != null ? String(meta.speaker) : null

    const frag = {
      id: nid(),
      text: trimmed,
      speaker,
      speakerId,
      isFinal: !!isFinal,
      confidence: confidence == null ? null : Number(confidence),
      ts,
    }
    fragments.push(frag)
    if (fragments.length > maxFragments) fragments = fragments.slice(-maxFragments)

    let flushed = null
    if (lane && (lane.speaker !== speaker || (speakerId != null && lane.speakerId != null && lane.speakerId !== speakerId))) {
      flushed = flushLane()
    }

    if (!lane) {
      lane = {
        speaker,
        speakerId,
        texts: [trimmed],
        startedAt: ts,
        updatedAt: ts,
        finals: isFinal ? 1 : 0,
      }
    } else {
      // Revision / continuation: append if additive; replace if near-duplicate re-final
      const prev = lane.texts[lane.texts.length - 1] || ''
      const prevN = normalizeCaptureText(prev)
      const nextN = normalizeCaptureText(trimmed)
      if (nextN === prevN) {
        // duplicate final — ignore text, bump final count
        if (isFinal) lane.finals += 1
      } else if (nextN.startsWith(prevN) || prevN.startsWith(nextN)) {
        lane.texts[lane.texts.length - 1] = trimmed.length >= prev.length ? trimmed : prev
        if (isFinal) lane.finals += 1
      } else if (isContinuation(prev, trimmed)) {
        lane.texts.push(trimmed)
        if (isFinal) lane.finals += 1
      } else {
        // Likely correction mid-utterance ("actually…")
        if (/\bactually[,—-]?\b/i.test(trimmed) || /\bno,?\s*i meant\b/i.test(trimmed)) {
          lane.texts = [stripCorrectionLead(trimmed)]
        } else {
          lane.texts.push(trimmed)
        }
        if (isFinal) lane.finals += 1
      }
      lane.updatedAt = ts
    }

    return { liveText: liveText(), flushed, rejected: null, fragment: frag, laneSpeaker: lane?.speaker }
  }

  function liveText() {
    if (!lane?.texts?.length) return ''
    return lane.texts.join(' ').replace(/\s+/g, ' ').trim()
  }

  function getLane() {
    if (!lane) return null
    return {
      text: liveText(),
      speaker: lane.speaker,
      speakerId: lane.speakerId,
      startedAt: lane.startedAt,
      updatedAt: lane.updatedAt,
      fragmentCount: lane.texts.length,
      finals: lane.finals,
      ageMs: Date.now() - lane.startedAt,
    }
  }

  function clearLane() {
    lane = null
  }

  function takeLane() {
    return flushLane()
  }

  function recentFragments(n = 20) {
    return fragments.slice(-n).map(f => ({ ...f }))
  }

  return {
    version: TRANSCRIPT_BUFFER_VERSION,
    push,
    liveText,
    getLane,
    clearLane,
    takeLane,
    flushLane,
    recentFragments,
    roleFromMeta,
  }
}

export function normalizeCaptureText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isContinuation(prev, next) {
  const a = String(prev || '').trim()
  const b = String(next || '').trim()
  if (!a || !b) return false
  // Overlap tail/head
  const an = normalizeCaptureText(a)
  const bn = normalizeCaptureText(b)
  if (!an || !bn) return false
  if (bn.startsWith(an) || an.endsWith(bn.slice(0, Math.min(24, bn.length)))) return true
  // Short additive clause
  if (b.split(/\s+/).length <= 12 && !/^[A-Z]/.test(b.replace(/^(okay|so|alright|actually)[,.]?\s+/i, ''))) return true
  if (/^(and|or|with|for|to|that|which|who|when|where|of|the|a|an)\b/i.test(b)) return true
  return false
}

function stripCorrectionLead(text) {
  return String(text || '')
    .replace(/^[\s\S]{0,80}?\b(?:actually[,—-]?\s*|no,?\s*i meant\s*)/i, '')
    .trim() || String(text || '').trim()
}

/** Near-duplicate committed questions (reconnect / re-final). */
export function isDuplicateQuestion(a, b, { maxExtraWords = 2 } = {}) {
  const na = normalizeCaptureText(a)
  const nb = normalizeCaptureText(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const wa = na.split(' ').filter(Boolean)
  const wb = nb.split(' ').filter(Boolean)
  if (Math.abs(wa.length - wb.length) > maxExtraWords) return false
  if (na.includes(nb) || nb.includes(na)) return true
  return false
}
