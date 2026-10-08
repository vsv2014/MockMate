import { useRef, useState, useCallback, useEffect } from 'react'
import { diagnostic } from './lib/diagnostics'
import {
  MAX_RECONNECTS,
  KEEPALIVE_MS,
  FATAL_CLOSE,
  PERMANENT_TOKEN_STATUSES,
  computeReconnectDelayMs,
  buildDeepgramListenUrl,
  abandonDeepgramSocket,
  enqueueOrSendPcm,
  flushQueuedPcm,
  createDeepgramAudioGraph,
  requestDeepgramToken,
  deepgramSocketConfig,
  clearDeepgramTokenCache,
} from './lib/deepgramTransport'

// Silence window after the last STT event before we force-flush the open utterance.
const FINALIZE_PAUSE_MS = 900

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
  const connectGen = useRef(0)
  const restartGen = useRef(0)
  const acquiringGen = useRef(null)
  const activeSocketRef = useRef(null)
  const tokenCache = useRef(null)
  const connecting = useRef(false)
  const suspendPaused = useRef(false)
  const attemptsAtSuspend = useRef(0)
  const pcmQueue = useRef([]), pcmQueueBytes = useRef(0), pcmDroppedBytes = useRef(0)
  const keytermsRef = useRef([])
  const langRef = useRef('en-US')
  const sourceIdRef = useRef('microphone')
  const startOptsRef = useRef({})
  const speakerStats = useRef(new Map()), interviewerSpeaker = useRef(null), candidateSpeaker = useRef(null)
  const everConnected = useRef(false), degradedAudio = useRef(false)
  const lastEarlyTrigger = useRef('')
  // Turn-1 Finalize-on-pause: Deepgram can hold the OPENING utterance open across
  // natural pauses, so the interviewer's first question sits in interim land
  // indefinitely. Scope is deliberately narrow (PR review fixes):
  //   1. SYSTEM/LOOPBACK capture only — microphone Live has working endpointing and
  //      a forced 900ms finalization would split natural thinking pauses.
  //   2. Disabled permanently once the first question commits (opener problem solved);
  //      the consumer calls setFinalizeOnPause(false). This decision is SESSION-level:
  //      it survives reconnects, retries and source switches (teardown does not reset
  //      it); only a genuinely new Live session — a fresh hook instance — starts enabled.
  // When active, a pending interim quiet for FINALIZE_PAUSE_MS triggers exactly one
  // { type: 'Finalize' } control frame per utterance.
  const finalizeWatcher = useRef(null)
  const pendingInterim = useRef(false)
  const lastSttAt = useRef(0)
  const finalizeSent = useRef(false)
  const finalizeEnabled = useRef(true)
  const onFinalRef = useRef(onFinal), onFailRef = useRef(onFail), onEarlyRef = useRef(onEarlyQuestion), onReconnectRef = useRef(onReconnect)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  useEffect(() => { onFailRef.current = onFail }, [onFail])
  useEffect(() => { onEarlyRef.current = onEarlyQuestion }, [onEarlyQuestion])
  useEffect(() => { onReconnectRef.current = onReconnect }, [onReconnect])

  const abandonSocket = useCallback(
    sock => abandonDeepgramSocket(sock, activeSocketRef, ws),
    [],
  )

  // One-way kill switch for the Turn-1 Finalize heuristic: called by the consumer
  // after the first question commits so later utterances rely on Deepgram's own
  // endpointing again.
  const setFinalizeOnPause = useCallback(enabled => {
    finalizeEnabled.current = Boolean(enabled)
    if (!finalizeEnabled.current) { pendingInterim.current = false; finalizeSent.current = false }
  }, [])

  const teardown = useCallback(() => {
    clearInterval(keepAlive.current); keepAlive.current = null
    clearInterval(finalizeWatcher.current); finalizeWatcher.current = null
    pendingInterim.current = false; finalizeSent.current = false
    // NOTE (PR review fix): `finalizeEnabled` is deliberately NOT reset here. teardown
    // runs on every reconnect/retry/source-switch mid-session, and the disable-after-
    // first-commit decision is SESSION-level, owned by the consumer via
    // setFinalizeOnPause(). A genuinely new Live session mounts a fresh hook instance,
    // whose useRef(true) starts enabled.
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    clearDeepgramTokenCache(tokenCache)
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
  }, [abandonSocket])

  const stop = useCallback(() => {
    restartGen.current += 1
    userStop.current = true
    connectGen.current += 1
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    teardown()
  }, [teardown])

  const fail = useCallback(reason => {
    if (userStop.current) return
    connectGen.current += 1
    teardown()
    onFailRef.current?.(reason)
  }, [teardown])

  const buildAudioGraph = useCallback(async (audioStream) => {
    const sendPCM = buf => enqueueOrSendPcm(buf, {
      wsRef: ws,
      pcmQueueRef: pcmQueue,
      pcmQueueBytesRef: pcmQueueBytes,
      pcmDroppedBytesRef: pcmDroppedBytes,
    })
    await createDeepgramAudioGraph(audioStream, {
      ctxRef: ctx,
      srcNodeRef: srcNode,
      procRef: proc,
      sendPCM,
      logPrefix: 'audio',
      resumeImmediately: false,
    })
  }, [])

  const connectSocket = useCallback(async () => {
    if (userStop.current || suspendPaused.current || connecting.current) return
    connecting.current = true
    const gen = ++connectGen.current
    abandonSocket(activeSocketRef.current || ws.current)
    activeSocketRef.current = null
    ws.current = null

    const { ok, tokenStatus, tokenRes, networkError } = await requestDeepgramToken({
      mode: 'system_audio',
      generation: gen,
      reconnectAttempt: reconnectAttempts.current,
      cacheRef: tokenCache,
      isCurrent: () => !userStop.current && !suspendPaused.current && gen === connectGen.current,
    })
    if (networkError) {
      connecting.current = false
      if (gen !== connectGen.current) return
      return scheduleReconnect('token fetch failed')
    }
    if (gen !== connectGen.current || userStop.current || suspendPaused.current) {
      connecting.current = false
      return
    }
    if (!ok) {
      connecting.current = false
      diagnostic('stt', 'token_failed', { status: tokenStatus || 0, reconnectAttempt: reconnectAttempts.current }, 'error')
      if (PERMANENT_TOKEN_STATUSES.has(tokenStatus)) return fail(tokenRes?.error || 'Deepgram auth failed — check your API key')
      return scheduleReconnect(`token grant ${tokenStatus || 'error'}`)
    }

    const model = degradedAudio.current ? 'nova-2' : 'nova-3'
    const url = buildDeepgramListenUrl({
      degraded: degradedAudio.current,
      language: langRef.current,
      diarize: true,
      keyterms: keytermsRef.current,
    })
    let sock
    try {
      const connection = deepgramSocketConfig(tokenRes, url)
      sock = new WebSocket(connection.url, connection.protocols)
    } catch (error) {
      connecting.current = false
      return fail(error?.message || 'STT connection setup failed')
    }
    diagnostic('stt', 'socket_connecting', {
      generation: gen, model,
      language: langRef.current, keytermCount: keytermsRef.current.length,
      credentialMode: tokenRes.fallback === 'api_key' ? 'local_key_fallback' : 'grant',
    })
    if (gen !== connectGen.current || suspendPaused.current) {
      abandonSocket(sock)
      connecting.current = false
      return
    }
    ws.current = sock
    activeSocketRef.current = sock

    const owns = () => gen === connectGen.current && activeSocketRef.current === sock

    sock.onopen = () => {
      if (!owns()) { abandonSocket(sock); return }
      // Deepgram speaker IDs are scoped to a socket, not a full interview.
      speakerStats.current = new Map()
      interviewerSpeaker.current = null
      candidateSpeaker.current = null
      setDiarizationLocked(false)
      connecting.current = false
      everConnected.current = true
      // A successful handshake is not proof of a stable connection.
      // Retain the retry budget until this socket has remained healthy for 30s.
      const stableTimer = setTimeout(() => {
        if (owns() && sock.readyState === 1) reconnectAttempts.current = 0
      }, 30_000)
      sock.addEventListener('close', () => clearTimeout(stableTimer), { once: true })
      setActive(true); setReconnecting(false)
      diagnostic('stt', 'socket_open', { generation: gen, degraded: degradedAudio.current, reconnectAttempt: reconnectAttempts.current })
      try { ctx.current?.resume?.() } catch {}
      flushQueuedPcm({
        sock,
        pcmQueueRef: pcmQueue,
        pcmQueueBytesRef: pcmQueueBytes,
        pcmDroppedBytesRef: pcmDroppedBytes,
        mode: 'system_audio',
        model,
        warnOnDrop: true,
      })
      clearInterval(keepAlive.current)
      keepAlive.current = setInterval(() => {
        if (owns() && sock.readyState === 1) { try { sock.send(JSON.stringify({ type: 'KeepAlive' })) } catch {} }
      }, KEEPALIVE_MS)
      clearInterval(finalizeWatcher.current)
      finalizeWatcher.current = setInterval(() => {
        if (!owns()) return
        const isSystemLoopback = Boolean(sourceIdRef.current && sourceIdRef.current !== 'microphone')
        if (
          finalizeEnabled.current && isSystemLoopback &&
          pendingInterim.current && !finalizeSent.current &&
          lastSttAt.current > 0 && Date.now() - lastSttAt.current >= FINALIZE_PAUSE_MS &&
          sock.readyState === 1
        ) {
          finalizeSent.current = true
          try { sock.send(JSON.stringify({ type: 'Finalize' })) } catch {}
          diagnostic('stt', 'finalize_on_pause', { pauseMs: FINALIZE_PAUSE_MS, source: 'system' })
        }
      }, 300)
    }

    sock.onmessage = ev => {
      if (!owns()) return
      let m; try { m = JSON.parse(ev.data) } catch { return }
      if (m.type === 'Error' || m.err_code) {
        diagnostic('stt', 'provider_error', { code: m.err_code || 'unknown' }, 'error')
        return fail(m.err_msg || m.err_code || 'Deepgram error')
      }
      const alt = m.channel?.alternatives?.[0]
      const text = alt?.transcript?.trim()
      if (!text) return
      lastSttAt.current = Date.now()
      const sp = dominantSpeaker(alt?.words)
      let isCandidate = candidateSpeaker.current != null && sp === candidateSpeaker.current
      if (m.is_final) {
        diagnostic('stt', 'final_received', {
          confidence: Number.isFinite(alt?.confidence) ? alt.confidence : null,
          wordCount: text.split(/\s+/).filter(Boolean).length,
          speakerDetected: sp != null, degraded: !!degradedAudio.current,
        })
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
          isCandidate = candidateSpeaker.current != null && sp === candidateSpeaker.current
        }
        lastEarlyTrigger.current = ''
        pendingInterim.current = false
        finalizeSent.current = false
        const isSystemLoopback = Boolean(sourceIdRef.current && sourceIdRef.current !== 'microphone')
        onFinalRef.current?.(text, {
          speaker: sp,
          source: isSystemLoopback ? 'system' : 'microphone',
          isCandidate: isSystemLoopback ? false : !!isCandidate,
          isQuestion: looksLikeQuestion(text),
          confidence: Number.isFinite(alt?.confidence) ? alt.confidence : null,
          diarizationLocked: isSystemLoopback || !!interviewerSpeaker.current,
          interviewerSpeaker: interviewerSpeaker.current,
          speakerRole: isSystemLoopback
            ? 'interviewer'
            : (interviewerSpeaker.current != null && sp != null
              ? (sp === interviewerSpeaker.current ? 'interviewer' : (candidateSpeaker.current != null && sp === candidateSpeaker.current ? 'candidate' : 'unknown'))
              : 'unknown'),
          degraded: !!degradedAudio.current,
        })
        setInterim('')
      } else {
        pendingInterim.current = true
        finalizeSent.current = false
        setInterim(text)
        const confidence = alt?.confidence ?? 0
        const earlyIsInterviewer = sourceIdRef.current !== 'microphone'
          || (interviewerSpeaker.current != null && sp === interviewerSpeaker.current)
        if (earlyIsInterviewer && !isCandidate && confidence > 0.82 && looksLikeQuestion(text) && text !== lastEarlyTrigger.current) {
          lastEarlyTrigger.current = text
          onEarlyRef.current?.(text, { speaker: sp, isCandidate: !!isCandidate, diarizationLocked: !!interviewerSpeaker.current })
        }
      }
    }

    sock.onerror = () => {}
    sock.onclose = (ev) => {
      if (gen !== connectGen.current) return
      if (activeSocketRef.current === sock) activeSocketRef.current = null
      if (ws.current === sock) ws.current = null
      connecting.current = false
      clearInterval(keepAlive.current); keepAlive.current = null
      clearInterval(finalizeWatcher.current); finalizeWatcher.current = null
      pendingInterim.current = false; finalizeSent.current = false
      if (userStop.current || suspendPaused.current) return
      diagnostic('stt', 'socket_closed', { code: ev?.code || 0, clean: !!ev?.wasClean, generation: gen }, FATAL_CLOSE.has(ev?.code) ? 'error' : 'warn')
      if (FATAL_CLOSE.has(ev?.code)) {
        clearDeepgramTokenCache(tokenCache)
        if (ev?.code === 4008) return fail('Your managed voice-transcription allowance is exhausted. Try again next billing period or switch to BYOK.')
        if ([4001, 4003].includes(ev?.code)) return fail('Managed transcription authentication failed. Sign in again.')
        return failOrDegrade(`Deepgram closed the stream (code ${ev.code})`)
      }
      scheduleReconnect('connection dropped')
    }
  }, [abandonSocket, fail]) // eslint-disable-line react-hooks/exhaustive-deps

  function failOrDegrade(reason) {
    if (!degradedAudio.current) {
      degradedAudio.current = true
      setDegraded(true)
      reconnectAttempts.current = 0
      console.warn('[audio] enhanced transcription failed pre-connect — falling back to plain config:', reason)
      diagnostic('stt', 'degraded_fallback', { reason }, 'warn')
      connectSocket()
      return
    }
    fail(reason)
  }

  function scheduleReconnect(reason) {
    if (userStop.current || suspendPaused.current) return
    reconnectAttempts.current += 1
    diagnostic('stt', 'reconnect_scheduled', { attempt: reconnectAttempts.current, reason }, 'warn')
    try { onReconnectRef.current?.(reconnectAttempts.current, reason) } catch {}
    if (reconnectAttempts.current > MAX_RECONNECTS) {
      return failOrDegrade(`${reason} — gave up after ${MAX_RECONNECTS} consecutive reconnect attempts`)
    }
    setActive(false); setReconnecting(true)
    const delay = computeReconnectDelayMs(reconnectAttempts.current)
    clearTimeout(reconnectTimer.current)
    reconnectTimer.current = setTimeout(() => { connectSocket() }, delay)
  }

  const start = useCallback(async (sourceId = 'microphone', opts = {}) => {
    if (ws.current || stream.current) return
    const startGen = connectGen.current
    if (acquiringGen.current === startGen) return // one capture request per generation
    acquiringGen.current = startGen
    userStop.current = false
    suspendPaused.current = false
    reconnectAttempts.current = 0
    everConnected.current = false; degradedAudio.current = false
    setDegraded(false); setDiarizationLocked(false)
    keytermsRef.current = sanitizeKeyterms(opts.keyterms)
    sourceIdRef.current = sourceId || 'microphone'
    startOptsRef.current = { ...opts }
    if (opts.language) langRef.current = opts.language
    speakerStats.current = new Map(); interviewerSpeaker.current = null; candidateSpeaker.current = null
    try {
      const audioStream = await getStream(sourceId)
      // getUserMedia/getDisplayMedia may resolve after Stop, Restart or Suspend.
      // Release that obsolete capture instead of resurrecting a stopped session.
      if (userStop.current || suspendPaused.current || startGen !== connectGen.current) {
        audioStream.getTracks().forEach(t => t.stop())
        return
      }
      if (!audioStream.getAudioTracks().length) {
        audioStream.getTracks().forEach(t => t.stop())
        const linux = (typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent))
        throw new Error(linux
          ? 'No audio from System Audio (not supported on Linux). Switch to Microphone.'
          : 'No audio track from the selected source. Try Microphone.')
      }
      stream.current = audioStream
      await buildAudioGraph(audioStream)
      if (userStop.current || suspendPaused.current || startGen !== connectGen.current) {
        audioStream.getTracks().forEach(t => t.stop())
        if (stream.current === audioStream) teardown()
        return
      }
      await connectSocket()
    } catch (e) {
      if (!userStop.current && !suspendPaused.current && startGen === connectGen.current) fail(e.message)
    } finally {
      if (acquiringGen.current === startGen) acquiringGen.current = null
    }
  }, [buildAudioGraph, connectSocket, fail, teardown])

  const restart = useCallback(async (sourceId = 'microphone', opts = {}) => {
    const rev = ++restartGen.current
    userStop.current = true
    connectGen.current += 1
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    // A source change within the same interview must not reserve another
    // five-minute grant when the previous grant is still valid.
    const existingGrant = tokenCache.current
    teardown()
    if (rev === restartGen.current) tokenCache.current = existingGrant
    await new Promise(r => setTimeout(r, 200))
    if (rev !== restartGen.current) return
    return start(sourceId, opts)
  }, [start, teardown])

  useEffect(() => {
    const resumeAudio = () => { try { if (ctx.current?.state === 'suspended') ctx.current.resume() } catch {} }
    const afterWake = () => {
      resumeAudio()
      const wasSuspended = suspendPaused.current
      suspendPaused.current = false
      if (userStop.current || !ctx.current) return
      if (wasSuspended) reconnectAttempts.current = 0
      attemptsAtSuspend.current = 0
      const sock = activeSocketRef.current || ws.current
      if (sock && sock.readyState === 1 && !wasSuspended) return
      if (connecting.current && sock && sock.readyState === 0) return
      setActive(false)
      setReconnecting(true)
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = setTimeout(() => {
        if (!userStop.current && !suspendPaused.current) connectSocket().catch(() => {})
      }, 400)
    }
    const onSuspend = () => {
      suspendPaused.current = true
      attemptsAtSuspend.current = reconnectAttempts.current
      clearTimeout(reconnectTimer.current); reconnectTimer.current = null
      connectGen.current += 1
      connecting.current = false
      abandonSocket(activeSocketRef.current || ws.current)
      activeSocketRef.current = null
      clearInterval(keepAlive.current); keepAlive.current = null
      setActive(false)
      setReconnecting(false)
    }
    const onDeviceChange = async () => {
      if (userStop.current) return
      const liveTrack = stream.current?.getAudioTracks?.().some(t => t.readyState === 'live')
      if (liveTrack) return afterWake()
      diagnostic('stt', 'audio_device_reacquire', { source: sourceIdRef.current }, 'warn')
      try { await restart(sourceIdRef.current, startOptsRef.current) }
      catch (e) { onFailRef.current?.(e?.message || 'Audio device recovery failed') }
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    const onVis = () => { if (document.visibilityState === 'visible') afterWake() }
    document.addEventListener('visibilitychange', onVis)
    const offPower = window.electronAPI?.onPowerEvent?.(ev => {
      if (ev === 'suspend') onSuspend()
      else if (ev === 'resume' || ev === 'unlock') afterWake()
    })
    const offDisplay = window.electronAPI?.onDisplayChanged?.(() => afterWake())
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
      document.removeEventListener('visibilitychange', onVis)
      try { offPower?.() } catch {}
      try { offDisplay?.() } catch {}
    }
  }, [abandonSocket, connectSocket, restart])

  useEffect(() => () => { userStop.current = true; connectGen.current += 1; teardown() }, [teardown])
  return { supported: true, active, reconnecting, interim, diarizationLocked, degraded, start, stop, restart, setFinalizeOnPause }
}
