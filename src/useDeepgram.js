import { useEffect, useRef, useState, useCallback } from 'react'
import { apiFetch } from './lib/apiClient'
import { diagnostic } from './lib/diagnostics'
import { toPCM16 } from './audio-pcm'

const MAX_RECONNECTS = 150
const KEEPALIVE_MS = 4000
const FATAL_CLOSE = new Set([1008, 4001, 4003, 4008])
const BYTES_PER_SEC = 16000 * 2
const MAX_QUEUE_BYTES = 30 * BYTES_PER_SEC

/**
 * Solo / Duo mic transcription via Deepgram — KeepAlive + reconnect + worklet
 * parity with Live's useSystemAudio (mic-only, no diarization).
 */
export function useDeepgram(onFinal, onFail, lang = 'en-US') {
  const [active, setActive] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [interim, setInterim] = useState('')

  const ws = useRef(null), ctx = useRef(null), proc = useRef(null), stream = useRef(null), srcNode = useRef(null)
  const keepAlive = useRef(null), reconnectTimer = useRef(null), reconnectAttempts = useRef(0)
  const userStop = useRef(false)
  const connectGen = useRef(0)
  const activeSocketRef = useRef(null)
  const connecting = useRef(false)
  const suspendPaused = useRef(false)
  const pcmQueue = useRef([]), pcmQueueBytes = useRef(0), pcmDroppedBytes = useRef(0)
  const everConnected = useRef(false), degradedAudio = useRef(false)
  const langRef = useRef(lang || 'en-US')
  const onFinalRef = useRef(onFinal), onFailRef = useRef(onFail)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  useEffect(() => { onFailRef.current = onFail }, [onFail])
  useEffect(() => { langRef.current = lang || 'en-US' }, [lang])

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
  }, [])

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
    const AC = window.AudioContext || window.webkitAudioContext
    let ac
    try { ac = new AC({ sampleRate: 16000 }) } catch { ac = new AC() }
    ctx.current = ac
    try { await ac.resume() } catch {}
    const source = ac.createMediaStreamSource(audioStream)
    srcNode.current = source
    const mute = ac.createGain(); mute.gain.value = 0
    const sendPCM = buf => {
      const sock = ws.current
      if (sock && sock.readyState === 1) { sock.send(buf); return }
      pcmQueue.current.push(buf)
      pcmQueueBytes.current += buf.byteLength
      while (pcmQueueBytes.current > MAX_QUEUE_BYTES && pcmQueue.current.length) {
        const old = pcmQueue.current.shift()
        pcmQueueBytes.current -= old.byteLength
        pcmDroppedBytes.current += old.byteLength
      }
    }
    try {
      await ac.audioWorklet.addModule('/dg-worklet.js')
      const node = new AudioWorkletNode(ac, 'pcm-worklet')
      node.port.onmessage = e => sendPCM(e.data)
      source.connect(node); node.connect(mute); mute.connect(ac.destination)
      proc.current = node
    } catch (err) {
      console.warn('[solo-audio] AudioWorklet unavailable, ScriptProcessor fallback:', err?.message)
      const p = ac.createScriptProcessor(4096, 1, 1)
      p.onaudioprocess = e => sendPCM(toPCM16(e.inputBuffer.getChannelData(0), ac.sampleRate))
      source.connect(p); p.connect(mute); mute.connect(ac.destination)
      proc.current = p
    }
  }, [])

  function scheduleReconnect(reason) {
    if (userStop.current || suspendPaused.current) return
    reconnectAttempts.current += 1
    if (reconnectAttempts.current > MAX_RECONNECTS) {
      return failOrDegrade(`${reason} — gave up after ${MAX_RECONNECTS} consecutive reconnect attempts`)
    }
    setActive(false); setReconnecting(true)
    const delay = Math.min(8000, 500 * 2 ** Math.min(reconnectAttempts.current - 1, 4))
    clearTimeout(reconnectTimer.current)
    reconnectTimer.current = setTimeout(() => { connectSocket() }, delay)
  }

  const connectSocket = useCallback(async () => {
    if (userStop.current || suspendPaused.current) return
    if (connecting.current) return
    connecting.current = true
    const gen = ++connectGen.current
    abandonSocket(activeSocketRef.current || ws.current)
    activeSocketRef.current = null
    ws.current = null

    let tokenRes, tokenStatus
    diagnostic('stt', 'token_requested', { mode: 'microphone', generation: gen, reconnectAttempt: reconnectAttempts.current })
    try {
      const r = await apiFetch('/api/deepgram-token', { method: 'POST' })
      tokenStatus = r.status
      tokenRes = await r.json().catch(() => null)
    } catch {
      connecting.current = false
      if (gen !== connectGen.current) return
      return scheduleReconnect('token fetch failed')
    }
    if (gen !== connectGen.current || userStop.current || suspendPaused.current) { connecting.current = false; return }
    if (!tokenRes?.access_token) {
      connecting.current = false
      diagnostic('stt', 'token_failed', { mode: 'microphone', status: tokenStatus || 0, reconnectAttempt: reconnectAttempts.current }, 'error')
      if ([401, 402, 403, 429].includes(tokenStatus)) return fail(tokenRes?.error || 'Deepgram auth failed — check your API key')
      return scheduleReconnect(`token grant ${tokenStatus || 'error'}`)
    }

    const model = degradedAudio.current ? 'nova-2' : 'nova-3'
    const url = `wss://api.deepgram.com/v1/listen?model=${model}&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=1200&vad_events=true&endpointing=300&language=${encodeURIComponent(langRef.current)}`
    const sock = new WebSocket(url, ['token', tokenRes.access_token])
    diagnostic('stt', 'socket_connecting', { mode: 'microphone', generation: gen, model, language: langRef.current, degraded: degradedAudio.current })
    if (gen !== connectGen.current || suspendPaused.current) { abandonSocket(sock); connecting.current = false; return }
    ws.current = sock
    activeSocketRef.current = sock
    const owns = () => gen === connectGen.current && activeSocketRef.current === sock

    sock.onopen = () => {
      if (!owns()) { abandonSocket(sock); return }
      connecting.current = false
      everConnected.current = true
      reconnectAttempts.current = 0
      setActive(true); setReconnecting(false)
      diagnostic('stt', 'socket_open', { mode: 'microphone', generation: gen, model, degraded: degradedAudio.current })
      try { ctx.current?.resume?.() } catch {}
      if (pcmQueue.current.length) {
        diagnostic('stt', 'audio_buffer_flushed', {
          mode: 'microphone', bufferedBytes: pcmQueueBytes.current,
          droppedBytes: pcmDroppedBytes.current, model,
        }, pcmDroppedBytes.current > 0 ? 'warn' : 'info')
        const queued = pcmQueue.current
        pcmQueue.current = []; pcmQueueBytes.current = 0; pcmDroppedBytes.current = 0
        for (const buf of queued) { try { sock.send(buf) } catch {} }
      }
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
        diagnostic('stt', 'final_received', {
          mode: 'microphone', model, confidence: Number.isFinite(alt?.confidence) ? alt.confidence : null,
          wordCount: text.split(/\s+/).filter(Boolean).length, degraded: degradedAudio.current,
        })
        onFinalRef.current?.(text); setInterim('')
      }
      else setInterim(text)
    }

    sock.onerror = () => {}
    sock.onclose = (ev) => {
      if (gen !== connectGen.current) return
      if (activeSocketRef.current === sock) activeSocketRef.current = null
      if (ws.current === sock) ws.current = null
      connecting.current = false
      clearInterval(keepAlive.current); keepAlive.current = null
      if (userStop.current || suspendPaused.current) return
      diagnostic('stt', 'socket_closed', { mode: 'microphone', generation: gen, model, code: ev?.code || 0, clean: !!ev?.wasClean }, FATAL_CLOSE.has(ev?.code) ? 'error' : 'warn')
      if (FATAL_CLOSE.has(ev?.code)) return failOrDegrade(`Deepgram closed the stream (code ${ev.code})`)
      scheduleReconnect('connection dropped')
    }
  }, [fail]) // eslint-disable-line react-hooks/exhaustive-deps

  function failOrDegrade(reason) {
    if (!degradedAudio.current && !everConnected.current) {
      degradedAudio.current = true
      reconnectAttempts.current = 0
      diagnostic('stt', 'degraded_fallback', { mode: 'microphone', fromModel: 'nova-3', toModel: 'nova-2', reason }, 'warn')
      connectSocket()
      return
    }
    fail(reason)
  }

  const start = useCallback(async () => {
    // Resume existing graph if mic already live (after TTS) — don't rebuild / re-prompt getUserMedia.
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
    userStop.current = false
    suspendPaused.current = false
    reconnectAttempts.current = 0
    everConnected.current = false
    degradedAudio.current = false
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      stream.current = mic
      await buildAudioGraph(mic)
      await connectSocket()
    } catch (e) {
      fail(e.message)
    }
  }, [buildAudioGraph, connectSocket, fail])

  useEffect(() => {
    const resumeAudio = () => { try { if (ctx.current?.state === 'suspended') ctx.current.resume() } catch {} }
    const afterWake = () => {
      resumeAudio()
      const wasSuspended = suspendPaused.current
      suspendPaused.current = false
      if (userStop.current || !ctx.current) return
      reconnectAttempts.current = 0
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
      clearTimeout(reconnectTimer.current); reconnectTimer.current = null
      connectGen.current += 1
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
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', afterWake)
      document.removeEventListener('visibilitychange', onVis)
      try { offPower?.() } catch {}
    }
  }, [connectSocket])

  useEffect(() => () => { userStop.current = true; connectGen.current += 1; teardown() }, [teardown])
  return { supported: true, active, reconnecting, interim, start, stop }
}
