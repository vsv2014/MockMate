import { useEffect, useRef, useState, useCallback } from 'react'
import { diagnostic } from './lib/diagnostics'
import { watchAudioTrackEnded, shouldRecoverEndedTrack } from './lib/audioTrackRecovery'
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

/** Solo / Duo mic transcription via Deepgram. */
export function useDeepgram(onFinal, onFail, lang = 'en-US') {
  const [active, setActive] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [interim, setInterim] = useState('')

  const ws = useRef(null), ctx = useRef(null), proc = useRef(null), stream = useRef(null), srcNode = useRef(null)
  const keepAlive = useRef(null), reconnectTimer = useRef(null), reconnectAttempts = useRef(0)
  const userStop = useRef(false)
  const connectGen = useRef(0)
  const acquiringGen = useRef(null)
  const activeSocketRef = useRef(null)
  const tokenCache = useRef(null)
  const trackWatchOff = useRef(null)
  const trackRecoveryTimer = useRef(null)
  const recoverCaptureRef = useRef(null)
  const connecting = useRef(false)
  const suspendPaused = useRef(false)
  const pcmQueue = useRef([]), pcmQueueBytes = useRef(0), pcmDroppedBytes = useRef(0)
  const everConnected = useRef(false), degradedAudio = useRef(false)
  const langRef = useRef(lang || 'en-US')
  const onFinalRef = useRef(onFinal), onFailRef = useRef(onFail)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  useEffect(() => { onFailRef.current = onFail }, [onFail])
  useEffect(() => { langRef.current = lang || 'en-US' }, [lang])

  const abandonSocket = useCallback(
    sock => abandonDeepgramSocket(sock, activeSocketRef, ws),
    [],
  )

  const teardown = useCallback(() => {
    clearInterval(keepAlive.current); keepAlive.current = null
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    clearTimeout(trackRecoveryTimer.current); trackRecoveryTimer.current = null
    trackWatchOff.current?.(); trackWatchOff.current = null
    clearDeepgramTokenCache(tokenCache)
    abandonSocket(activeSocketRef.current || ws.current)
    activeSocketRef.current = null
    try { proc.current?.disconnect() } catch {}
    try { srcNode.current?.disconnect() } catch {}
    try { ctx.current?.close() } catch {}
    stream.current?.getTracks().forEach(t => t.stop())
    ws.current = ctx.current = proc.current = stream.current = srcNode.current = null
    pcmQueue.current = []; pcmQueueBytes.current = 0; pcmDroppedBytes.current = 0
    connecting.current = false
    setActive(false); setReconnecting(false); setInterim('')
  }, [abandonSocket])

  const stop = useCallback(() => {
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
      // Never send MockMate's own synthesized interviewer audio to paid STT.
      shouldDropFrame: () => Boolean(window.speechSynthesis?.speaking || window.speechSynthesis?.pending),
    })
    await createDeepgramAudioGraph(audioStream, {
      ctxRef: ctx,
      srcNodeRef: srcNode,
      procRef: proc,
      sendPCM,
      logPrefix: 'solo-audio',
      resumeImmediately: true,
    })
  }, [])

  function scheduleReconnect(reason) {
    if (userStop.current || suspendPaused.current) return
    reconnectAttempts.current += 1
    if (reconnectAttempts.current > MAX_RECONNECTS) {
      return failOrDegrade(`${reason} — gave up after ${MAX_RECONNECTS} consecutive reconnect attempts`)
    }
    setActive(false); setReconnecting(true)
    const delay = computeReconnectDelayMs(reconnectAttempts.current)
    clearTimeout(reconnectTimer.current)
    reconnectTimer.current = setTimeout(() => { connectSocket() }, delay)
  }

  const connectSocket = useCallback(async () => {
    if (userStop.current || suspendPaused.current || connecting.current) return
    connecting.current = true
    const gen = ++connectGen.current
    abandonSocket(activeSocketRef.current || ws.current)
    activeSocketRef.current = null
    ws.current = null

    const { ok, tokenStatus, tokenRes, networkError } = await requestDeepgramToken({
      mode: 'microphone',
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
    if (gen !== connectGen.current || userStop.current || suspendPaused.current) { connecting.current = false; return }
    if (!ok) {
      connecting.current = false
      diagnostic('stt', 'token_failed', { mode: 'microphone', status: tokenStatus || 0, reconnectAttempt: reconnectAttempts.current }, 'error')
      if (PERMANENT_TOKEN_STATUSES.has(tokenStatus)) return fail(tokenRes?.error || 'Deepgram auth failed — check your API key')
      return scheduleReconnect(`token grant ${tokenStatus || 'error'}`)
    }

    const model = degradedAudio.current ? 'nova-2' : 'nova-3'
    const url = buildDeepgramListenUrl({ degraded: degradedAudio.current, language: langRef.current, diarize: false })
    let sock
    try {
      const connection = deepgramSocketConfig(tokenRes, url)
      sock = new WebSocket(connection.url, connection.protocols)
    } catch (error) {
      connecting.current = false
      return fail(error?.message || 'STT connection setup failed')
    }
    diagnostic('stt', 'socket_connecting', { mode: 'microphone', generation: gen, model, language: langRef.current, degraded: degradedAudio.current })
    if (gen !== connectGen.current || suspendPaused.current) { abandonSocket(sock); connecting.current = false; return }
    ws.current = sock
    activeSocketRef.current = sock
    const owns = () => gen === connectGen.current && activeSocketRef.current === sock

    sock.onopen = () => {
      if (!owns()) { abandonSocket(sock); return }
      connecting.current = false
      everConnected.current = true
      // A successful handshake is not proof of a stable connection.
      // Retain the retry budget until this socket has remained healthy for 30s.
      const stableTimer = setTimeout(() => {
        if (owns() && sock.readyState === 1) reconnectAttempts.current = 0
      }, 30_000)
      sock.addEventListener('close', () => clearTimeout(stableTimer), { once: true })
      setActive(true); setReconnecting(false)
      diagnostic('stt', 'socket_open', { mode: 'microphone', generation: gen, model, degraded: degradedAudio.current })
      try { ctx.current?.resume?.() } catch {}
      flushQueuedPcm({
        sock,
        pcmQueueRef: pcmQueue,
        pcmQueueBytesRef: pcmQueueBytes,
        pcmDroppedBytesRef: pcmDroppedBytes,
        mode: 'microphone',
        model,
      })
      clearInterval(keepAlive.current)
      keepAlive.current = setInterval(() => {
        if (owns() && sock.readyState === 1) { try { sock.send(JSON.stringify({ type: 'KeepAlive' })) } catch {} }
      }, KEEPALIVE_MS)
    }

    sock.onmessage = ev => {
      if (!owns()) return
      let m; try { m = JSON.parse(ev.data) } catch { return }
      if (m.type === 'Error' || m.err_code) {
        diagnostic('stt', 'provider_error', { mode: 'microphone', code: m.err_code || 'unknown', model }, 'error')
        return failOrDegrade(m.err_msg || m.err_code || 'Deepgram error')
      }
      const alt = m.channel?.alternatives?.[0]
      const text = alt?.transcript?.trim()
      if (!text) return
      if (m.is_final) {
        diagnostic('stt', 'final_received', { mode: 'microphone', model, confidence: Number.isFinite(alt?.confidence) ? alt.confidence : null, wordCount: text.split(/\s+/).filter(Boolean).length, degraded: degradedAudio.current })
        onFinalRef.current?.(text); setInterim('')
      } else setInterim(text)
    }

    sock.onerror = () => {}
    sock.onclose = ev => {
      if (gen !== connectGen.current) return
      if (activeSocketRef.current === sock) activeSocketRef.current = null
      if (ws.current === sock) ws.current = null
      connecting.current = false
      clearInterval(keepAlive.current); keepAlive.current = null
      if (userStop.current || suspendPaused.current) return
      diagnostic('stt', 'socket_closed', { mode: 'microphone', generation: gen, model, code: ev?.code || 0, clean: !!ev?.wasClean }, FATAL_CLOSE.has(ev?.code) ? 'error' : 'warn')
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
      reconnectAttempts.current = 0
      diagnostic('stt', 'degraded_fallback', { mode: 'microphone', fromModel: 'nova-3', toModel: 'nova-2', reason }, 'warn')
      connectSocket()
      return
    }
    fail(reason)
  }

  const start = useCallback(async () => {
    const liveTrack = stream.current?.getAudioTracks?.().some(t => t.readyState === 'live')
    if (stream.current && !liveTrack) teardown()
    if (stream.current && ctx.current) {
      userStop.current = false
      suspendPaused.current = false
      try { await ctx.current.resume() } catch {}
      const sock = activeSocketRef.current || ws.current
      if (sock && sock.readyState === 1) { setActive(true); return }
      if (connecting.current && sock && sock.readyState === 0) return
      if (!connecting.current) await connectSocket()
      return
    }
    if (ws.current || stream.current) return
    const startGen = connectGen.current
    if (acquiringGen.current === startGen) return // prevent duplicate permission prompts
    acquiringGen.current = startGen
    userStop.current = false
    suspendPaused.current = false
    reconnectAttempts.current = 0
    everConnected.current = false
    degradedAudio.current = false
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      if (userStop.current || suspendPaused.current || startGen !== connectGen.current) {
        mic.getTracks().forEach(t => t.stop())
        return
      }
      stream.current = mic
      trackWatchOff.current?.()
      trackWatchOff.current = watchAudioTrackEnded(mic, () => {
        if (!shouldRecoverEndedTrack({
          expectedStream: mic, activeStream: stream.current,
          stopped: userStop.current, suspended: suspendPaused.current,
        })) return
        clearTimeout(trackRecoveryTimer.current)
        trackRecoveryTimer.current = setTimeout(() => {
          if (shouldRecoverEndedTrack({
            expectedStream: mic, activeStream: stream.current,
            stopped: userStop.current, suspended: suspendPaused.current,
          })) recoverCaptureRef.current?.()
        }, 450)
      })
      await buildAudioGraph(mic)
      if (userStop.current || suspendPaused.current || startGen !== connectGen.current) {
        mic.getTracks().forEach(t => t.stop())
        if (stream.current === mic) teardown()
        return
      }
      await connectSocket()
    } catch (e) {
      if (!userStop.current && !suspendPaused.current && startGen === connectGen.current) fail(e.message)
    } finally {
      if (acquiringGen.current === startGen) acquiringGen.current = null
    }
  }, [buildAudioGraph, connectSocket, fail, teardown])

  useEffect(() => {
    recoverCaptureRef.current = async () => {
      if (userStop.current || suspendPaused.current || !stream.current) return
      diagnostic('stt', 'audio_track_ended_reacquire', { mode: 'microphone' }, 'warn')
      connectGen.current += 1
      teardown()
      if (userStop.current || suspendPaused.current) return
      try { await start() } catch (e) {
        onFailRef.current?.(e?.message || 'Microphone recovery failed')
      }
    }
    return () => { recoverCaptureRef.current = null }
  }, [start, teardown])

  useEffect(() => {
    const resumeAudio = () => { try { if (ctx.current?.state === 'suspended') ctx.current.resume() } catch {} }
    const afterWake = () => {
      resumeAudio()
      const wasSuspended = suspendPaused.current
      suspendPaused.current = false
      if (userStop.current || !ctx.current) return
      if (wasSuspended) reconnectAttempts.current = 0
      const sock = activeSocketRef.current || ws.current
      if (sock && sock.readyState === 1 && !wasSuspended) return
      if (connecting.current && sock && sock.readyState === 0) return
      setActive(false); setReconnecting(true)
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = setTimeout(() => { if (!userStop.current && !suspendPaused.current) connectSocket().catch(() => {}) }, 400)
    }
    const onSuspend = () => {
      suspendPaused.current = true
      clearTimeout(reconnectTimer.current); reconnectTimer.current = null
      connectGen.current += 1
      connecting.current = false
      abandonSocket(activeSocketRef.current || ws.current)
      activeSocketRef.current = null
      clearInterval(keepAlive.current); keepAlive.current = null
      setActive(false); setReconnecting(false)
    }
    const onDeviceChange = async () => {
      if (userStop.current) return
      const liveTrack = stream.current?.getAudioTracks?.().some(t => t.readyState === 'live')
      if (liveTrack) return afterWake()
      diagnostic('stt', 'audio_device_reacquire', { mode: 'microphone' }, 'warn')
      connectGen.current += 1
      teardown()
      userStop.current = false
      try { await start() } catch (e) { onFailRef.current?.(e?.message || 'Microphone recovery failed') }
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    const onVis = () => { if (document.visibilityState === 'visible') afterWake() }
    document.addEventListener('visibilitychange', onVis)
    const offPower = window.electronAPI?.onPowerEvent?.(ev => {
      if (ev === 'suspend') onSuspend()
      else if (ev === 'resume' || ev === 'unlock') afterWake()
    })
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
      document.removeEventListener('visibilitychange', onVis)
      try { offPower?.() } catch {}
    }
  }, [abandonSocket, connectSocket, start, teardown])

  useEffect(() => () => { userStop.current = true; connectGen.current += 1; teardown() }, [teardown])
  return { supported: true, active, reconnecting, interim, start, stop }
}
