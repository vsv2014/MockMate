import { useRef, useState, useCallback, useEffect } from 'react'
import { apiFetch } from './lib/apiClient'
import { toPCM16 } from './audio-pcm'

async function getStream(sourceId) {
  if (!sourceId || sourceId === 'microphone') {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {}
    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        ...(supported.autoGainControl ? { autoGainControl: true } : {}),
        ...(supported.voiceIsolation ? { voiceIsolation: true } : {}),
      }
    })
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 1, maxHeight: 1 } }
  })
  stream.getVideoTracks().forEach(t => t.stop())
  return stream
}

function looksLikeQuestion(text) {
  const words = text.trim().split(/\s+/).length
  if (words < 6) return false
  return text.endsWith('?') ||
    /\b(tell me|describe|explain|how would|what is|walk me|can you|why did|why do|have you|give me|what are|how do|what was|what were|when did|where did)\b/i.test(text)
}

/** Live hint gate: question-shaped OR short follow-up with `?` / probe phrases (saves tokens on chatter). */
export function shouldTriggerHint(text, meta = {}) {
  if (meta?.isCandidate) return false
  const t = String(text || '').trim()
  const words = t.split(/\s+/).filter(Boolean).length
  if (words < 1) return false
  // Short follow-ups ("Why?", "And then?") after a prior interviewer Q — word gate ≥3 was too strict.
  if (words < 3) {
    if (!(meta?.hadPriorQuestion && (/\?\s*$/.test(t) || looksLikeQuestion(t)))) return false
  }
  if (meta?.isQuestion || looksLikeQuestion(t)) return true
  if (/\?\s*$/.test(t)) return true
  return /\b(tell me|describe|explain|how would|what is|walk me|can you|why|have you|give me|what are|how do|could you|would you|and then|what about|how about)\b/i.test(t)
}

// Build the Deepgram URL. diarize=true tags each word with a speaker so we can tell
// the interviewer from the candidate; keywords=<term>:2 boosts recognition of the
// candidate's domain terms, tech, and proper nouns pulled from their resume.
function buildDgUrl(keyterms = [], degraded = false, lang = 'en-US') {
  const model = degraded ? 'nova-2' : 'nova-3'
  const base = `wss://api.deepgram.com/v1/listen?model=${model}&encoding=linear16&sample_rate=16000&channels=1`
    + '&interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=1200&vad_events=true&endpointing=300'
    + `&language=${encodeURIComponent(lang || 'en-US')}`   // transcribe in the chosen interview language
  if (degraded) return base   // plain proven baseline — drop diarize + keyterms if the enhanced config won't connect
  return base + '&diarize=true' + keyterms.slice(0, 40).map(t => `&keyterm=${encodeURIComponent(t)}`).join('')
}

// Most-frequent speaker label across a diarized word list (Deepgram tags each word).
function dominantSpeaker(words) {
  if (!Array.isArray(words) || !words.length) return null
  const counts = new Map()
  for (const w of words) if (w && w.speaker != null) counts.set(w.speaker, (counts.get(w.speaker) || 0) + 1)
  let best = null, max = 0
  for (const [sp, n] of counts) if (n > max) { max = n; best = sp }
  return best
}

// Normalize resume/role keyterms for Deepgram's keywords param: dedupe, sane length, cap.
function sanitizeKeyterms(terms) {
  if (!Array.isArray(terms)) return []
  const seen = new Set(), out = []
  for (const raw of terms) {
    const t = String(raw || '').trim()
    if (t.length < 2 || t.length > 40) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key); out.push(t)
    if (out.length >= 40) break
  }
  return out
}
const MAX_RECONNECTS = 150      // CONSECUTIVE failures before giving up (counter resets on a successful open).
                                // At the 8s backoff cap this keeps retrying through ~20min of outage — a WiFi
                                // handoff, VPN reconnect, or brief sleep must NOT permanently kill a live interview.
                                // Genuine fatal closes (FATAL_CLOSE / in-band Error / auth) hard-stop separately.
const KEEPALIVE_MS = 4000       // Deepgram closes after 10s of no data — ping well within that
// WebSocket close codes that are fatal (auth / quota / policy) — never worth retrying.
const FATAL_CLOSE = new Set([1008, 4001, 4003, 4008])
// Audio captured while the socket is down (cold start + every reconnect) is queued
// and flushed on reopen, so a blip never drops the words spoken during it. Bounded
// so a long outage can't grow memory unbounded — and because replaying a huge backlog
// to Deepgram would only yield stale, already-irrelevant hints.
const BYTES_PER_SEC = 16000 * 2             // 16 kHz mono PCM16
const MAX_QUEUE_BYTES = 30 * BYTES_PER_SEC  // ~30 s of audio (~960 KB)

// Live transcription via Deepgram with auto-reconnect + KeepAlive (P0-A).
// The mic stream + AudioContext + audio graph are built ONCE and survive socket
// reconnects — only the WebSocket is rebuilt, so audio never has to restart.
export function useSystemAudio(onFinal, onFail, onEarlyQuestion, onReconnect) {
  const [active, setActive] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [interim, setInterim] = useState('')
  const [diarizationLocked, setDiarizationLocked] = useState(false)
  const [degraded, setDegraded] = useState(false)

  const ws = useRef(null), ctx = useRef(null), proc = useRef(null), stream = useRef(null), srcNode = useRef(null)
  const keepAlive = useRef(null), reconnectTimer = useRef(null), reconnectAttempts = useRef(0)
  const userStop = useRef(false)
  // Single-flight socket ownership: only the socket whose connectGen matches AND equals
  // activeSocketRef may deliver transcripts / schedule reconnects. Overlapping wake +
  // onclose must never leave two live listeners.
  const connectGen = useRef(0)
  const activeSocketRef = useRef(null)
  const connecting = useRef(false)
  const suspendPaused = useRef(false)   // sleep: pause reconnect budget so long sleep doesn't burn MAX_RECONNECTS
  const attemptsAtSuspend = useRef(0)

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
  // PCM captured while the socket is down — flushed in order on reopen (see sendPCM).
  const pcmQueue = useRef([]), pcmQueueBytes = useRef(0), pcmDroppedBytes = useRef(0)
  // Keyterms (resume/role jargon) boosted in Deepgram, + speaker tracking for diarization.
  const keytermsRef = useRef([])
  const langRef = useRef('en-US')   // Deepgram transcription language (from the interview language)
  const speakerStats = useRef(new Map()), interviewerSpeaker = useRef(null), candidateSpeaker = useRef(null)
  // Graceful-degrade: if the ENHANCED socket (diarize+keyterms) never connects, retry plain.
  const everConnected = useRef(false), degradedAudio = useRef(false)
  const lastEarlyTrigger = useRef('')
  const onFinalRef = useRef(onFinal), onFailRef = useRef(onFail), onEarlyRef = useRef(onEarlyQuestion), onReconnectRef = useRef(onReconnect)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  useEffect(() => { onFailRef.current = onFail }, [onFail])
  useEffect(() => { onEarlyRef.current = onEarlyQuestion }, [onEarlyQuestion])
  useEffect(() => { onReconnectRef.current = onReconnect }, [onReconnect])

  // Full teardown — only on user stop / unmount.
  const teardown = useCallback(() => {
    clearInterval(keepAlive.current); keepAlive.current = null
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    abandonSocket(activeSocketRef.current || ws.current)
    activeSocketRef.current = null
    try { proc.current?.disconnect() } catch {}
    try { srcNode.current?.disconnect() } catch {}
    try { ctx.current?.close() } catch {}
    stream.current?.getTracks().forEach(t => t.stop())
    ws.current = ctx.current = proc.current = stream.current = srcNode.current = null
    pcmQueue.current = []; pcmQueueBytes.current = 0; pcmDroppedBytes.current = 0
    setActive(false); setReconnecting(false); setInterim('')
    setDiarizationLocked(false); setDegraded(false)
    connecting.current = false
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    userStop.current = true
    connectGen.current += 1
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    teardown()
  }, [teardown])

  // Hard failure — give up and notify the UI.
  const fail = useCallback(reason => {
    if (userStop.current) return
    connectGen.current += 1   // invalidate any in-flight connect ownership
    teardown()
    onFailRef.current?.(reason)
  }, [teardown])

  // Build the audio graph once. PCM is sent to ws.current (a ref) so it keeps
  // working across socket reconnects without rewiring.
  // Preferred: AudioWorklet — runs on a dedicated audio thread, so capture is
  // never starved by React renders / answer streaming (helps long sessions; 120m not claimed).
  // Fallback: deprecated ScriptProcessorNode for runtimes without AudioWorklet.
  const buildAudioGraph = useCallback(async (audioStream) => {
    // Pin the context to 16 kHz so the PCM we send matches the sample_rate=16000
    // we declare to Deepgram. If a browser can't honor the hint it falls back to
    // its native rate, and the encoder still downsamples from there — correct either
    // way, and never sends a rate below 16 kHz mislabelled as 16 kHz.
    const AC = window.AudioContext || window.webkitAudioContext
    let ac
    try { ac = new AC({ sampleRate: 16000 }) } catch { ac = new AC() }
    ctx.current = ac
    const source = ac.createMediaStreamSource(audioStream)
    srcNode.current = source
    const mute = ac.createGain(); mute.gain.value = 0
    // Send if the socket is open; otherwise QUEUE (don't drop) so audio captured during
    // cold start / a reconnect window survives and gets flushed on reopen.
    const sendPCM = buf => {
      const sock = ws.current
      if (sock && sock.readyState === 1) { sock.send(buf); return }
      pcmQueue.current.push(buf)
      pcmQueueBytes.current += buf.byteLength
      // Bounded: once past the cap, shed the OLDEST audio (keep the most recent speech).
      while (pcmQueueBytes.current > MAX_QUEUE_BYTES && pcmQueue.current.length) {
        const old = pcmQueue.current.shift()
        pcmQueueBytes.current -= old.byteLength
        pcmDroppedBytes.current += old.byteLength
      }
    }

    try {
      await ac.audioWorklet.addModule('/dg-worklet.js')   // served from public/ (dev + packaged http)
      const node = new AudioWorkletNode(ac, 'pcm-worklet')
      node.port.onmessage = e => sendPCM(e.data)          // e.data = encoded PCM16 ArrayBuffer
      source.connect(node); node.connect(mute); mute.connect(ac.destination)
      proc.current = node
    } catch (err) {
      // AudioWorklet unavailable — fall back to the legacy main-thread processor.
      console.warn('[audio] AudioWorklet unavailable, using ScriptProcessor fallback:', err?.message)
      const p = ac.createScriptProcessor(4096, 1, 1)
      p.onaudioprocess = e => sendPCM(toPCM16(e.inputBuffer.getChannelData(0), ac.sampleRate))
      source.connect(p); p.connect(mute); mute.connect(ac.destination)
      proc.current = p
    }
  }, [])

  // Open (or reopen) the Deepgram socket. Reuses the existing audio graph.
  const connectSocket = useCallback(async () => {
    if (userStop.current || suspendPaused.current) return
    if (connecting.current) return   // single-flight — wake + onclose must not overlap
    connecting.current = true
    const gen = ++connectGen.current
    // Close any prior owned socket before opening a new one (prevents double listeners).
    abandonSocket(activeSocketRef.current || ws.current)
    activeSocketRef.current = null
    ws.current = null

    let tokenRes, tokenStatus
    try {
      const r = await apiFetch('/api/deepgram-token', { method: 'POST' })
      tokenStatus = r.status
      tokenRes = await r.json().catch(() => null)
    } catch (e) {
      connecting.current = false
      if (gen !== connectGen.current) return
      return scheduleReconnect('token fetch failed')
    }
    if (gen !== connectGen.current || userStop.current || suspendPaused.current) {
      connecting.current = false
      return
    }
    if (!tokenRes?.access_token) {
      connecting.current = false
      // 401/403 = bad/missing key (config error) → stop, retrying won't help.
      // 402/429 = over the managed monthly cap → also permanent for this period; reconnecting
      // would loop forever and silently hang Live. Surface the server's message instead.
      // Anything else (5xx grant blip, transient) → reconnect: over a 60-90min session tokens
      // are re-minted on every reconnect, so one transient failure must NOT kill the interview.
      if ([401, 402, 403, 429].includes(tokenStatus)) return fail(tokenRes?.error || 'Deepgram auth failed — check your API key')
      return scheduleReconnect(`token grant ${tokenStatus || 'error'}`)
    }

    const sock = new WebSocket(buildDgUrl(keytermsRef.current, degradedAudio.current, langRef.current), ['token', tokenRes.access_token])
    if (gen !== connectGen.current || suspendPaused.current) {
      abandonSocket(sock)
      connecting.current = false
      return
    }
    // Ownership: this socket is the only one allowed to mutate STT state for `gen`.
    // Stay "connecting" until open/close so a parallel wake cannot open a second socket.
    ws.current = sock
    activeSocketRef.current = sock

    const owns = () => gen === connectGen.current && activeSocketRef.current === sock

    sock.onopen = () => {
      if (!owns()) { abandonSocket(sock); return }
      connecting.current = false
      everConnected.current = true
      reconnectAttempts.current = 0
      setActive(true); setReconnecting(false)
      try { ctx.current?.resume?.() } catch {}
      // Flush audio captured while the socket was down, in FIFO order, BEFORE any live
      // chunk — so words spoken during the reconnect/cold-start gap aren't lost. This
      // runs to completion before any worklet message is processed (single-threaded),
      // so ordering with live audio is guaranteed.
      if (pcmQueue.current.length) {
        if (pcmDroppedBytes.current > 0) {
          console.warn(`[audio] outage exceeded ${MAX_QUEUE_BYTES / BYTES_PER_SEC}s buffer — dropped ~${(pcmDroppedBytes.current / BYTES_PER_SEC).toFixed(1)}s of oldest audio`)
        }
        const queued = pcmQueue.current
        pcmQueue.current = []; pcmQueueBytes.current = 0; pcmDroppedBytes.current = 0
        for (const buf of queued) { try { sock.send(buf) } catch {} }
      }
      // KeepAlive: text frame every 4s so a silence gap never trips the 10s idle close.
      clearInterval(keepAlive.current)
      keepAlive.current = setInterval(() => {
        if (owns() && sock.readyState === 1) { try { sock.send(JSON.stringify({ type: 'KeepAlive' })) } catch {} }
      }, KEEPALIVE_MS)
    }

    sock.onmessage = ev => {
      if (!owns()) return
      let m; try { m = JSON.parse(ev.data) } catch { return }
      if (m.type === 'Error' || m.err_code) {
        // Fatal Deepgram errors (auth/quota) shouldn't loop forever.
        return fail(m.err_msg || m.err_code || 'Deepgram error')
      }
      const alt = m.channel?.alternatives?.[0]
      const text = alt?.transcript?.trim()
      if (!text) return
      const sp = dominantSpeaker(alt?.words)
      const isCandidate = candidateSpeaker.current != null && sp === candidateSpeaker.current
      if (m.is_final) {
        // Update per-speaker stats and (re)derive the interviewer = whoever asks the
        // most question-shaped utterances. We only mark a candidate once the
        // interviewer is positively identified (>=2 questions), so until then Mic mode
        // stays auto-hint suppressed (see LiveCompanion).
        if (sp != null) {
          const st = speakerStats.current.get(sp) || { total: 0, questions: 0 }
          st.total++; if (looksLikeQuestion(text)) st.questions++
          speakerStats.current.set(sp, st)
          let topQ = -1, intv = null
          for (const [s, v] of speakerStats.current) if (v.questions > topQ) { topQ = v.questions; intv = s }
          if (topQ >= 2) {
            interviewerSpeaker.current = intv
            let topT = -1, cand = null
            for (const [s, v] of speakerStats.current) if (s !== intv && v.total > topT) { topT = v.total; cand = s }
            candidateSpeaker.current = cand
            setDiarizationLocked(true)
          }
        }
        lastEarlyTrigger.current = ''
        // Never hint on candidate speech — even if question-shaped ("Can you repeat?").
        onFinalRef.current?.(text, {
          speaker: sp,
          isCandidate: !!isCandidate,
          isQuestion: looksLikeQuestion(text),
          confidence: Number.isFinite(alt?.confidence) ? alt.confidence : null,
          diarizationLocked: !!interviewerSpeaker.current,
          degraded: !!degradedAudio.current,
        })
        setInterim('')
      } else {
        setInterim(text)
        const confidence = alt?.confidence ?? 0
        if (!isCandidate && confidence > 0.82 && looksLikeQuestion(text) && text !== lastEarlyTrigger.current) {
          lastEarlyTrigger.current = text
          onEarlyRef.current?.(text, { speaker: sp, isCandidate: !!isCandidate, diarizationLocked: !!interviewerSpeaker.current })
        }
      }
    }

    sock.onerror = () => { /* onclose will follow and trigger reconnect */ }
    sock.onclose = (ev) => {
      if (gen !== connectGen.current) return
      if (activeSocketRef.current === sock) activeSocketRef.current = null
      if (ws.current === sock) ws.current = null
      connecting.current = false
      clearInterval(keepAlive.current); keepAlive.current = null
      if (userStop.current || suspendPaused.current) return
      // Auth/quota/policy failures can arrive as a WebSocket close code rather than
      // an in-band Error frame — those won't fix themselves, so fail fast instead of
      // looping "Reconnecting…" forever. Transient drops (1006/1011/network) still retry.
      if (FATAL_CLOSE.has(ev?.code)) return failOrDegrade(`Deepgram closed the stream (code ${ev.code})`)
      scheduleReconnect('connection dropped')
    }
  }, [fail]) // eslint-disable-line react-hooks/exhaustive-deps

  // If the ENHANCED transcription socket fails before EVER connecting, the diarize/
  // keyterms config is the likely culprit — drop to the plain proven config and retry
  // once. A drop AFTER a successful connect is just network, so it does NOT degrade.
  function failOrDegrade(reason) {
    if (!degradedAudio.current && !everConnected.current) {
      degradedAudio.current = true
      setDegraded(true)
      reconnectAttempts.current = 0
      console.warn('[audio] enhanced transcription failed pre-connect — falling back to plain config:', reason)
      connectSocket()
      return
    }
    fail(reason)
  }

  // Reconnect with capped exponential backoff; the mic/AudioContext stay alive.
  // A live interview must not give up on a *transient* drop — Deepgram closes
  // idle/long streams routinely and networks blip — so we retry (staying in the
  // "Reconnecting" state) and reset the counter on every successful open, which
  // means a healthy session reconnects indefinitely. Hard stops: a fatal close
  // code (FATAL_CLOSE) or in-band Error frame, a missing token, or MAX_RECONNECTS
  // consecutive failures with no success in between (a genuinely broken stream).
  function scheduleReconnect(reason) {
    if (userStop.current || suspendPaused.current) return
    reconnectAttempts.current += 1
    try { onReconnectRef.current?.(reconnectAttempts.current, reason) } catch {}
    if (reconnectAttempts.current > MAX_RECONNECTS) {
      return failOrDegrade(`${reason} — gave up after ${MAX_RECONNECTS} consecutive reconnect attempts`)
    }
    setActive(false); setReconnecting(true)
    // Backoff grows to 8s then holds there.
    const delay = Math.min(8000, 500 * 2 ** Math.min(reconnectAttempts.current - 1, 4))
    clearTimeout(reconnectTimer.current)
    reconnectTimer.current = setTimeout(() => { connectSocket() }, delay)
  }

  const start = useCallback(async (sourceId = 'microphone', opts = {}) => {
    if (ws.current || stream.current) return  // already running — a 2nd start() would orphan the live mic/socket
    userStop.current = false
    suspendPaused.current = false
    reconnectAttempts.current = 0
    everConnected.current = false; degradedAudio.current = false
    setDegraded(false); setDiarizationLocked(false)
    keytermsRef.current = sanitizeKeyterms(opts.keyterms)
    if (opts.language) langRef.current = opts.language
    speakerStats.current = new Map(); interviewerSpeaker.current = null; candidateSpeaker.current = null
    try {
      const audioStream = await getStream(sourceId)
      // No audio track = nothing to transcribe. On Linux, picking a screen/system
      // source yields exactly this — Chromium can't capture desktop/loopback audio
      // there — so we'd "connect" but hear silence forever. Fail loudly instead.
      if (!audioStream.getAudioTracks().length) {
        audioStream.getTracks().forEach(t => t.stop())
        const linux = (typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent))
        throw new Error(linux
          ? 'No audio from System Audio (not supported on Linux). Switch to Microphone.'
          : 'No audio track from the selected source. Try Microphone.')
      }
      stream.current = audioStream
      await buildAudioGraph(audioStream)
      await connectSocket()
    } catch (e) {
      fail(e.message)
    }
  }, [buildAudioGraph, connectSocket, fail])

  // Mid-session source switch or manual retry: tear down cleanly then start again.
  const restart = useCallback(async (sourceId = 'microphone', opts = {}) => {
    userStop.current = true
    connectGen.current += 1
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    teardown()
    await new Promise(r => setTimeout(r, 200))
    return start(sourceId, opts)
  }, [start, teardown])

  // Re-resume the AudioContext if the OS suspends it (device change / sleep / display hotplug).
  // After laptop sleep the Deepgram socket is usually dead — nudge reconnect without tearing down mic.
  useEffect(() => {
    const resumeAudio = () => { try { if (ctx.current?.state === 'suspended') ctx.current.resume() } catch {} }
    const afterWake = () => {
      resumeAudio()
      const wasSuspended = suspendPaused.current
      suspendPaused.current = false
      if (userStop.current) return
      if (!ctx.current) return   // session not live
      // Sleep must not permanently burn the reconnect budget — always reset on resume.
      reconnectAttempts.current = 0
      attemptsAtSuspend.current = 0
      const sock = activeSocketRef.current || ws.current
      if (sock && sock.readyState === 1 && !wasSuspended) return
      if (connecting.current && sock && sock.readyState === 0) return
      // After sleep (or a dead socket): single-flight reconnect under a fresh generation.
      setActive(false)
      setReconnecting(true)
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = setTimeout(() => {
        if (!userStop.current && !suspendPaused.current) connectSocket().catch(() => {})
      }, 400)
    }
    const onSuspend = () => {
      // Pause reconnect budget + abandon ownership so mid-sleep onclose cannot schedule
      // retries that burn MAX_RECONNECTS across a long lid-close.
      suspendPaused.current = true
      attemptsAtSuspend.current = reconnectAttempts.current
      clearTimeout(reconnectTimer.current); reconnectTimer.current = null
      connectGen.current += 1          // invalidate in-flight connect / stale listeners
      connecting.current = false
      abandonSocket(activeSocketRef.current || ws.current)
      activeSocketRef.current = null
      clearInterval(keepAlive.current); keepAlive.current = null
      setActive(false)
      setReconnecting(false)
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', afterWake)
    const onVis = () => { if (document.visibilityState === 'visible') afterWake() }
    document.addEventListener('visibilitychange', onVis)
    const offPower = window.electronAPI?.onPowerEvent?.(ev => {
      if (ev === 'suspend') onSuspend()
      else if (ev === 'resume' || ev === 'unlock') afterWake()
    })
    const offDisplay = window.electronAPI?.onDisplayChanged?.(() => afterWake())
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', afterWake)
      document.removeEventListener('visibilitychange', onVis)
      try { offPower?.() } catch {}
      try { offDisplay?.() } catch {}
    }
  }, [connectSocket])

  useEffect(() => () => { userStop.current = true; connectGen.current += 1; teardown() }, [teardown])
  return { supported: true, active, reconnecting, interim, diarizationLocked, degraded, start, stop, restart }
}
