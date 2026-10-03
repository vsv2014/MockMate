import { useRef, useState, useCallback, useEffect } from 'react'
import { apiFetch } from './lib/apiClient'
import { diagnostic } from './lib/diagnostics'
import { toPCM16 } from './audio-pcm'

async function getStream(sourceId) {
  if (!sourceId || sourceId === 'microphone') {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {}
    return navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true,
      ...(supported.autoGainControl ? { autoGainControl: true } : {}),
      ...(supported.voiceIsolation ? { voiceIsolation: true } : {}),
    } })
  }
  const media = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 1, maxHeight: 1 } },
  })
  media.getVideoTracks().forEach(t => t.stop())
  return media
}

function looksLikeQuestion(text) {
  const t = String(text || '').trim()
  const words = t.split(/\s+/).filter(Boolean).length
  if (words < 2) return false
  return /\?\s*$/.test(t) || /\b(tell me|describe|explain|how would|what is|walk me|can you|why did|why do|have you|give me|what are|how do|what was|what were|when did|where did|could you|would you|what about|how about)\b/i.test(t)
}

export function shouldTriggerHint(text, meta = {}) {
  if (meta?.isCandidate) return false
  const t = String(text || '').trim()
  const words = t.split(/\s+/).filter(Boolean).length
  if (!words) return false
  if (words < 3 && !(meta?.hadPriorQuestion && (/\?\s*$/.test(t) || looksLikeQuestion(t)))) return false
  return !!(meta?.isQuestion || looksLikeQuestion(t) || /\?\s*$/.test(t))
}

function buildDgUrl(keyterms = [], degraded = false, lang = 'en-US') {
  const model = degraded ? 'nova-2' : 'nova-3'
  const base = `wss://api.deepgram.com/v1/listen?model=${model}&encoding=linear16&sample_rate=16000&channels=1`
    + '&interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=1200&vad_events=true&endpointing=300'
    + `&language=${encodeURIComponent(lang || 'en-US')}`
  if (degraded) return base
  return base + '&diarize=true' + keyterms.slice(0, 40).map(t => `&keyterm=${encodeURIComponent(t)}`).join('')
}

function dominantSpeaker(words) {
  if (!Array.isArray(words) || !words.length) return null
  const counts = new Map()
  for (const w of words) if (w?.speaker != null) counts.set(w.speaker, (counts.get(w.speaker) || 0) + 1)
  let best = null, max = 0
  for (const [sp, n] of counts) if (n > max) { max = n; best = sp }
  return best
}
function sanitizeKeyterms(terms) {
  if (!Array.isArray(terms)) return []
  const seen = new Set(), out = []
  for (const raw of terms) {
    const t = String(raw || '').trim(); const key = t.toLowerCase()
    if (t.length < 2 || t.length > 40 || seen.has(key)) continue
    seen.add(key); out.push(t)
    if (out.length >= 40) break
  }
  return out
}

const MAX_RECONNECTS = 150
const KEEPALIVE_MS = 4000
const FATAL_CLOSE = new Set([1008, 4001, 4003, 4008])
const BYTES_PER_SEC = 16000 * 2
// Preserve only the immediate conversational edge. Replaying 30 seconds after recovery creates
// stale questions/hints; five seconds covers a normal Wi-Fi handoff without resurrecting old turns.
const MAX_QUEUE_BYTES = 5 * BYTES_PER_SEC

export function useSystemAudio(onFinal, onFail, onEarlyQuestion, onReconnect) {
  const [active, setActive] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [interim, setInterim] = useState('')
  const [diarizationLocked, setDiarizationLocked] = useState(false)
  const [degraded, setDegraded] = useState(false)

  const ws = useRef(null), ctx = useRef(null), proc = useRef(null), stream = useRef(null), srcNode = useRef(null)
  const keepAlive = useRef(null), reconnectTimer = useRef(null), reconnectAttempts = useRef(0)
  const userStop = useRef(false), connectGen = useRef(0), activeSocketRef = useRef(null), connecting = useRef(false)
  const suspendPaused = useRef(false), attemptsAtSuspend = useRef(0)
  const pcmQueue = useRef([]), pcmQueueBytes = useRef(0), pcmDroppedBytes = useRef(0)
  const keytermsRef = useRef([]), langRef = useRef('en-US')
  const sourceRef = useRef('microphone'), startOptionsRef = useRef({})
  const speakerStats = useRef(new Map()), interviewerSpeaker = useRef(null), candidateSpeaker = useRef(null)
  const degradedAudio = useRef(false), lastEarlyTrigger = useRef('')
  const onFinalRef = useRef(onFinal), onFailRef = useRef(onFail), onEarlyRef = useRef(onEarlyQuestion), onReconnectRef = useRef(onReconnect)
  const reacquireRef = useRef(null)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  useEffect(() => { onFailRef.current = onFail }, [onFail])
  useEffect(() => { onEarlyRef.current = onEarlyQuestion }, [onEarlyQuestion])
  useEffect(() => { onReconnectRef.current = onReconnect }, [onReconnect])

  function abandonSocket(sock) {
    if (!sock) return
    try {
      sock.onclose = null; sock.onerror = null; sock.onmessage = null; sock.onopen = null
      if (sock.readyState === 1) sock.send(JSON.stringify({ type: 'CloseStream' }))
    } catch {}
    try { sock.close() } catch {}
    if (activeSocketRef.current === sock) activeSocketRef.current = null
    if (ws.current === sock) ws.current = null
  }

  const teardown = useCallback(() => {
    clearInterval(keepAlive.current); keepAlive.current = null
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    abandonSocket(activeSocketRef.current || ws.current); activeSocketRef.current = null
    try { proc.current?.disconnect() } catch {}
    try { srcNode.current?.disconnect() } catch {}
    try { ctx.current?.close() } catch {}
    stream.current?.getTracks().forEach(t => { try { t.onended = null; t.stop() } catch {} })
    ws.current = ctx.current = proc.current = stream.current = srcNode.current = null
    pcmQueue.current = []; pcmQueueBytes.current = 0; pcmDroppedBytes.current = 0
    connecting.current = false
    setActive(false); setReconnecting(false); setInterim('')
    setDiarizationLocked(false); setDegraded(false)
  }, [])

  const stop = useCallback(() => {
    userStop.current = true; connectGen.current += 1
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    teardown()
  }, [teardown])
  const fail = useCallback(reason => {
    if (userStop.current) return
    connectGen.current += 1; teardown(); onFailRef.current?.(reason)
  }, [teardown])

  const buildAudioGraph = useCallback(async audioStream => {
    const AC = window.AudioContext || window.webkitAudioContext
    let ac; try { ac = new AC({ sampleRate: 16000 }) } catch { ac = new AC() }
    ctx.current = ac
    try { await ac.resume() } catch {}
    const source = ac.createMediaStreamSource(audioStream); srcNode.current = source
    const mute = ac.createGain(); mute.gain.value = 0
    const sendPCM = buf => {
      const sock = ws.current
      if (sock?.readyState === 1) { try { sock.send(buf) } catch {}; return }
      pcmQueue.current.push(buf); pcmQueueBytes.current += buf.byteLength
      while (pcmQueueBytes.current > MAX_QUEUE_BYTES && pcmQueue.current.length) {
        const old = pcmQueue.current.shift(); pcmQueueBytes.current -= old.byteLength; pcmDroppedBytes.current += old.byteLength
      }
    }
    try {
      await ac.audioWorklet.addModule('/dg-worklet.js')
      const node = new AudioWorkletNode(ac, 'pcm-worklet'); node.port.onmessage = e => sendPCM(e.data)
      source.connect(node); node.connect(mute); mute.connect(ac.destination); proc.current = node
    } catch (err) {
      console.warn('[audio] AudioWorklet unavailable, using ScriptProcessor fallback:', err?.message)
      const p = ac.createScriptProcessor(4096, 1, 1)
      p.onaudioprocess = e => sendPCM(toPCM16(e.inputBuffer.getChannelData(0), ac.sampleRate))
      source.connect(p); p.connect(mute); mute.connect(ac.destination); proc.current = p
    }
  }, [])

  // Require stable interviewer evidence rather than simply "speaker with most questions". The
  // previous rule could lock to a candidate who asked two clarification questions early.
  function updateSpeakerRoles(sp, text) {
    if (sp == null || degradedAudio.current) return
    const st = speakerStats.current.get(sp) || { total: 0, questions: 0 }
    st.total += 1; if (looksLikeQuestion(text)) st.questions += 1
    speakerStats.current.set(sp, st)
    const ranked = [...speakerStats.current.entries()].sort((a, b) => (b[1].questions - a[1].questions) || (b[1].total - a[1].total))
    if (ranked.length < 2) return
    const [best, second] = ranked
    const [bestId, bestStats] = best; const secondStats = second[1]
    const enoughEvidence = bestStats.questions >= 2 && (bestStats.questions >= secondStats.questions + 1 || bestStats.questions >= 3)
    if (!enoughEvidence) return
    // Once locked, avoid oscillating on one later candidate question. Switch only on a clear margin.
    if (interviewerSpeaker.current != null && interviewerSpeaker.current !== bestId) {
      const old = speakerStats.current.get(interviewerSpeaker.current) || { questions: 0 }
      if (bestStats.questions < old.questions + 2) return
    }
    interviewerSpeaker.current = bestId
    const candidate = ranked.filter(([id]) => id !== bestId).sort((a, b) => b[1].total - a[1].total)[0]?.[0] ?? null
    candidateSpeaker.current = candidate
    setDiarizationLocked(candidate != null)
  }

  function scheduleReconnect(reason) {
    if (userStop.current || suspendPaused.current) return
    reconnectAttempts.current += 1
    diagnostic('stt', 'reconnect_scheduled', { attempt: reconnectAttempts.current, reason }, 'warn')
    try { onReconnectRef.current?.(reconnectAttempts.current, reason) } catch {}
    if (reconnectAttempts.current > MAX_RECONNECTS) return failOrDegrade(`${reason} — gave up after ${MAX_RECONNECTS} consecutive reconnect attempts`)
    setActive(false); setReconnecting(true)
    const delay = Math.min(8000, 500 * 2 ** Math.min(reconnectAttempts.current - 1, 4))
    clearTimeout(reconnectTimer.current)
    reconnectTimer.current = setTimeout(() => connectSocket(), delay)
  }

  function failOrDegrade(reason) {
    // Enhanced Nova-3 can become unavailable mid-session too. Degrade once regardless of whether
    // this session connected successfully earlier; a successful historical connection is not proof
    // that the current model/config remains healthy.
    if (!degradedAudio.current) {
      degradedAudio.current = true; setDegraded(true); setDiarizationLocked(sourceRef.current !== 'microphone')
      reconnectAttempts.current = 0
      diagnostic('stt', 'degraded_fallback', { fromModel: 'nova-3', toModel: 'nova-2', reason }, 'warn')
      connectSocket(); return
    }
    fail(reason)
  }

  const connectSocket = useCallback(async () => {
    if (userStop.current || suspendPaused.current || connecting.current) return
    connecting.current = true
    const gen = ++connectGen.current
    abandonSocket(activeSocketRef.current || ws.current); activeSocketRef.current = null; ws.current = null

    let tokenRes, tokenStatus
    diagnostic('stt', 'token_requested', { generation: gen, reconnectAttempt: reconnectAttempts.current })
    try {
      const r = await apiFetch('/api/deepgram-token', { method: 'POST' }); tokenStatus = r.status; tokenRes = await r.json().catch(() => null)
    } catch {
      connecting.current = false
      if (gen !== connectGen.current) return
      return scheduleReconnect('token fetch failed')
    }
    if (gen !== connectGen.current || userStop.current || suspendPaused.current) { connecting.current = false; return }
    if (!tokenRes?.access_token) {
      connecting.current = false
      diagnostic('stt', 'token_failed', { status: tokenStatus || 0, reconnectAttempt: reconnectAttempts.current }, 'error')
      if ([401, 402, 403, 429].includes(tokenStatus)) return fail(tokenRes?.error || 'Deepgram auth failed — check your API key')
      return scheduleReconnect(`token grant ${tokenStatus || 'error'}`)
    }

    const model = degradedAudio.current ? 'nova-2' : 'nova-3'
    const sock = new WebSocket(buildDgUrl(keytermsRef.current, degradedAudio.current, langRef.current), ['token', tokenRes.access_token])
    diagnostic('stt', 'socket_connecting', { generation: gen, model, language: langRef.current, keytermCount: keytermsRef.current.length, credentialMode: tokenRes.fallback === 'api_key' ? 'local_key_fallback' : 'grant' })
    if (gen !== connectGen.current || suspendPaused.current) { abandonSocket(sock); connecting.current = false; return }
    ws.current = sock; activeSocketRef.current = sock
    const owns = () => gen === connectGen.current && activeSocketRef.current === sock

    sock.onopen = () => {
      if (!owns()) { abandonSocket(sock); return }
      connecting.current = false; reconnectAttempts.current = 0; setActive(true); setReconnecting(false)
      diagnostic('stt', 'socket_open', { generation: gen, degraded: degradedAudio.current, model })
      try { ctx.current?.resume?.() } catch {}
      if (pcmQueue.current.length) {
        diagnostic('stt', 'audio_buffer_flushed', { mode: 'system_audio', bufferedBytes: pcmQueueBytes.current, droppedBytes: pcmDroppedBytes.current, model }, pcmDroppedBytes.current ? 'warn' : 'info')
        const queued = pcmQueue.current; pcmQueue.current = []; pcmQueueBytes.current = 0; pcmDroppedBytes.current = 0
        for (const buf of queued) { try { sock.send(buf) } catch {} }
      }
      clearInterval(keepAlive.current)
      keepAlive.current = setInterval(() => { if (owns() && sock.readyState === 1) { try { sock.send(JSON.stringify({ type: 'KeepAlive' })) } catch {} } }, KEEPALIVE_MS)
    }

    sock.onmessage = ev => {
      if (!owns()) return
      let m; try { m = JSON.parse(ev.data) } catch { return }
      if (m.type === 'Error' || m.err_code) {
        diagnostic('stt', 'provider_error', { code: m.err_code || 'unknown', model }, 'error')
        return failOrDegrade(m.err_msg || m.err_code || 'Deepgram error')
      }
      const alt = m.channel?.alternatives?.[0]
      const text = alt?.transcript?.trim(); if (!text) return
      const sp = dominantSpeaker(alt?.words)
      if (m.is_final) {
        diagnostic('stt', 'final_received', { confidence: Number.isFinite(alt?.confidence) ? alt.confidence : null, wordCount: text.split(/\s+/).filter(Boolean).length, speakerDetected: sp != null, degraded: !!degradedAudio.current })
        updateSpeakerRoles(sp, text)
        // Compute role AFTER the utterance has updated/possibly established the lock.
        const locked = degradedAudio.current ? sourceRef.current !== 'microphone' : interviewerSpeaker.current != null && candidateSpeaker.current != null
        const isCandidate = locked && !degradedAudio.current && candidateSpeaker.current != null && sp === candidateSpeaker.current
        lastEarlyTrigger.current = ''
        onFinalRef.current?.(text, {
          speaker: sp, isCandidate: !!isCandidate, isQuestion: looksLikeQuestion(text),
          confidence: Number.isFinite(alt?.confidence) ? alt.confidence : null,
          diarizationLocked: !!locked, degraded: !!degradedAudio.current,
        })
        setInterim('')
      } else {
        setInterim(text)
        const locked = degradedAudio.current ? sourceRef.current !== 'microphone' : interviewerSpeaker.current != null && candidateSpeaker.current != null
        const isCandidate = locked && !degradedAudio.current && candidateSpeaker.current != null && sp === candidateSpeaker.current
        const confidence = alt?.confidence ?? 0
        if (!isCandidate && confidence > 0.82 && looksLikeQuestion(text) && text !== lastEarlyTrigger.current) {
          lastEarlyTrigger.current = text
          onEarlyRef.current?.(text, { speaker: sp, isCandidate: !!isCandidate, diarizationLocked: !!locked, degraded: !!degradedAudio.current })
        }
      }
    }
    sock.onerror = () => {}
    sock.onclose = ev => {
      if (gen !== connectGen.current) return
      if (activeSocketRef.current === sock) activeSocketRef.current = null
      if (ws.current === sock) ws.current = null
      connecting.current = false; clearInterval(keepAlive.current); keepAlive.current = null
      if (userStop.current || suspendPaused.current) return
      diagnostic('stt', 'socket_closed', { code: ev?.code || 0, clean: !!ev?.wasClean, generation: gen, model }, FATAL_CLOSE.has(ev?.code) ? 'error' : 'warn')
      if (FATAL_CLOSE.has(ev?.code)) return failOrDegrade(`Deepgram closed the stream (code ${ev.code})`)
      scheduleReconnect('connection dropped')
    }
  }, [fail]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async (sourceId = 'microphone', opts = {}) => {
    const liveTrack = stream.current?.getAudioTracks?.().some(t => t.readyState === 'live')
    if ((ws.current || stream.current) && liveTrack) return
    if (stream.current && !liveTrack) teardown()
    userStop.current = false; suspendPaused.current = false; reconnectAttempts.current = 0
    degradedAudio.current = false; setDegraded(false); setDiarizationLocked(false)
    sourceRef.current = sourceId || 'microphone'; startOptionsRef.current = { ...opts }
    keytermsRef.current = sanitizeKeyterms(opts.keyterms); if (opts.language) langRef.current = opts.language
    speakerStats.current = new Map(); interviewerSpeaker.current = null; candidateSpeaker.current = null
    try {
      const audioStream = await getStream(sourceRef.current)
      if (!audioStream.getAudioTracks().length) {
        audioStream.getTracks().forEach(t => t.stop())
        const linux = typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent)
        throw new Error(linux ? 'No audio from System Audio (not supported on Linux). Switch to Microphone.' : 'No audio track from the selected source. Try Microphone.')
      }
      stream.current = audioStream
      for (const track of audioStream.getAudioTracks()) track.onended = () => { if (!userStop.current) reacquireRef.current?.('track-ended') }
      await buildAudioGraph(audioStream); await connectSocket()
    } catch (e) { fail(e?.message || 'Could not start audio capture') }
  }, [buildAudioGraph, connectSocket, fail, teardown])

  const restart = useCallback(async (sourceId = sourceRef.current, opts = startOptionsRef.current) => {
    userStop.current = true; connectGen.current += 1
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null; teardown()
    await new Promise(r => setTimeout(r, 120))
    return start(sourceId, opts)
  }, [start, teardown])

  useEffect(() => {
    reacquireRef.current = async reason => {
      if (userStop.current) return
      diagnostic('stt', 'audio_device_reacquire', { source: sourceRef.current, reason }, 'warn')
      try { await restart(sourceRef.current, startOptionsRef.current) } catch (e) { onFailRef.current?.(e?.message || 'Audio-device recovery failed') }
    }
    return () => { reacquireRef.current = null }
  }, [restart])

  useEffect(() => {
    const resumeAudio = () => { try { if (ctx.current?.state === 'suspended') ctx.current.resume() } catch {} }
    const afterWake = () => {
      resumeAudio(); const wasSuspended = suspendPaused.current; suspendPaused.current = false
      if (userStop.current || !ctx.current) return
      const liveTrack = stream.current?.getAudioTracks?.().some(t => t.readyState === 'live')
      if (!liveTrack) { reacquireRef.current?.('wake-dead-track'); return }
      reconnectAttempts.current = 0; attemptsAtSuspend.current = 0
      const sock = activeSocketRef.current || ws.current
      if (sock?.readyState === 1 && !wasSuspended) return
      if (connecting.current && sock?.readyState === 0) return
      setActive(false); setReconnecting(true); clearTimeout(reconnectTimer.current)
      reconnectTimer.current = setTimeout(() => { if (!userStop.current && !suspendPaused.current) connectSocket().catch(() => {}) }, 400)
    }
    const onSuspend = () => {
      suspendPaused.current = true; attemptsAtSuspend.current = reconnectAttempts.current
      clearTimeout(reconnectTimer.current); reconnectTimer.current = null; connectGen.current += 1; connecting.current = false
      abandonSocket(activeSocketRef.current || ws.current); activeSocketRef.current = null
      clearInterval(keepAlive.current); keepAlive.current = null; setActive(false); setReconnecting(false)
    }
    const onDeviceChange = () => {
      if (userStop.current) return
      const liveTrack = stream.current?.getAudioTracks?.().some(t => t.readyState === 'live')
      if (!liveTrack) reacquireRef.current?.('devicechange')
      else afterWake()
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    const onVis = () => { if (document.visibilityState === 'visible') afterWake() }
    document.addEventListener('visibilitychange', onVis)
    const offPower = window.electronAPI?.onPowerEvent?.(ev => { if (ev === 'suspend') onSuspend(); else if (ev === 'resume' || ev === 'unlock') afterWake() })
    const offDisplay = window.electronAPI?.onDisplayChanged?.(() => afterWake())
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange); document.removeEventListener('visibilitychange', onVis)
      try { offPower?.() } catch {}; try { offDisplay?.() } catch {}
    }
  }, [connectSocket])

  useEffect(() => () => { userStop.current = true; connectGen.current += 1; teardown() }, [teardown])
  return { supported: true, active, reconnecting, interim, diarizationLocked, degraded, start, stop, restart }
}
