import { useRef, useState, useCallback, useEffect } from 'react'

function toPCM16(input, inRate, outRate = 16000) {
  let data = input
  if (outRate < inRate) {
    const ratio = inRate / outRate
    const len = Math.round(input.length / ratio)
    const out = new Float32Array(len)
    let pos = 0
    for (let i = 0; i < len; i++) {
      const next = Math.round((i + 1) * ratio)
      let sum = 0, c = 0
      for (let j = pos; j < next && j < input.length; j++) { sum += input[j]; c++ }
      out[i] = c ? sum / c : 0
      pos = next
    }
    data = out
  }
  const pcm = new Int16Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return pcm.buffer
}

async function getStream(sourceId) {
  if (!sourceId || sourceId === 'microphone') {
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
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

const DG_URL = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=1200'
const MAX_RECONNECTS = 8        // give up after this many consecutive failures
const KEEPALIVE_MS = 4000       // Deepgram closes after 10s of no data — ping well within that

// Live transcription via Deepgram with auto-reconnect + KeepAlive (P0-A).
// The mic stream + AudioContext + audio graph are built ONCE and survive socket
// reconnects — only the WebSocket is rebuilt, so audio never has to restart.
export function useSystemAudio(onFinal, onFail, onEarlyQuestion) {
  const [active, setActive] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [interim, setInterim] = useState('')

  const ws = useRef(null), ctx = useRef(null), proc = useRef(null), stream = useRef(null), srcNode = useRef(null)
  const keepAlive = useRef(null), reconnectTimer = useRef(null), reconnectAttempts = useRef(0)
  const userStop = useRef(false)
  const lastEarlyTrigger = useRef('')
  const onFinalRef = useRef(onFinal), onFailRef = useRef(onFail), onEarlyRef = useRef(onEarlyQuestion)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  useEffect(() => { onFailRef.current = onFail }, [onFail])
  useEffect(() => { onEarlyRef.current = onEarlyQuestion }, [onEarlyQuestion])

  // Full teardown — only on user stop / unmount.
  const teardown = useCallback(() => {
    clearInterval(keepAlive.current); keepAlive.current = null
    clearTimeout(reconnectTimer.current); reconnectTimer.current = null
    try { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ type: 'CloseStream' })) } catch {}
    try { ws.current?.close() } catch {}
    try { proc.current?.disconnect() } catch {}
    try { srcNode.current?.disconnect() } catch {}
    try { ctx.current?.close() } catch {}
    stream.current?.getTracks().forEach(t => t.stop())
    ws.current = ctx.current = proc.current = stream.current = srcNode.current = null
    setActive(false); setReconnecting(false); setInterim('')
  }, [])

  const stop = useCallback(() => { userStop.current = true; teardown() }, [teardown])

  // Hard failure — give up and notify the UI.
  const fail = useCallback(reason => {
    if (userStop.current) return
    teardown()
    onFailRef.current?.(reason)
  }, [teardown])

  // Build the audio graph once. PCM is sent to ws.current (a ref) so it keeps
  // working across socket reconnects without rewiring.
  // Preferred: AudioWorklet — runs on a dedicated audio thread, so capture is
  // never starved by React renders / answer streaming (durable for 1h+ sessions).
  // Fallback: deprecated ScriptProcessorNode for runtimes without AudioWorklet.
  const buildAudioGraph = useCallback(async (audioStream) => {
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    ctx.current = ac
    const source = ac.createMediaStreamSource(audioStream)
    srcNode.current = source
    const mute = ac.createGain(); mute.gain.value = 0
    const sendPCM = buf => { const sock = ws.current; if (sock && sock.readyState === 1) sock.send(buf) }

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
    if (userStop.current) return
    let tokenRes
    try {
      tokenRes = await fetch('/api/deepgram-token', { method: 'POST' }).then(r => r.json())
    } catch (e) { return scheduleReconnect('token fetch failed') }
    if (!tokenRes?.access_token) {
      // A missing token usually means a bad/missing key — not worth endless retries.
      return fail(tokenRes?.error || 'No Deepgram token')
    }
    if (userStop.current) return

    const sock = new WebSocket(DG_URL, ['token', tokenRes.access_token])
    ws.current = sock

    sock.onopen = () => {
      reconnectAttempts.current = 0
      setActive(true); setReconnecting(false)
      try { ctx.current?.resume?.() } catch {}
      // KeepAlive: text frame every 4s so a silence gap never trips the 10s idle close.
      clearInterval(keepAlive.current)
      keepAlive.current = setInterval(() => {
        if (ws.current?.readyState === 1) { try { ws.current.send(JSON.stringify({ type: 'KeepAlive' })) } catch {} }
      }, KEEPALIVE_MS)
    }

    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data) } catch { return }
      if (m.type === 'Error' || m.err_code) {
        // Fatal Deepgram errors (auth/quota) shouldn't loop forever.
        return fail(m.err_msg || m.err_code || 'Deepgram error')
      }
      const text = m.channel?.alternatives?.[0]?.transcript?.trim()
      if (!text) return
      if (m.is_final) {
        lastEarlyTrigger.current = ''
        onFinalRef.current?.(text)
        setInterim('')
      } else {
        setInterim(text)
        const confidence = m.channel?.alternatives?.[0]?.confidence ?? 0
        if (confidence > 0.82 && looksLikeQuestion(text) && text !== lastEarlyTrigger.current) {
          lastEarlyTrigger.current = text
          onEarlyRef.current?.(text)
        }
      }
    }

    sock.onerror = () => { /* onclose will follow and trigger reconnect */ }
    sock.onclose = () => {
      clearInterval(keepAlive.current); keepAlive.current = null
      if (userStop.current) return
      scheduleReconnect('connection dropped')
    }
  }, [fail]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reconnect with capped exponential backoff; the mic/AudioContext stay alive.
  function scheduleReconnect(reason) {
    if (userStop.current) return
    reconnectAttempts.current += 1
    if (reconnectAttempts.current > MAX_RECONNECTS) {
      return fail(`${reason} — could not reconnect after ${MAX_RECONNECTS} tries`)
    }
    setActive(false); setReconnecting(true)
    const delay = Math.min(8000, 500 * 2 ** (reconnectAttempts.current - 1))
    clearTimeout(reconnectTimer.current)
    reconnectTimer.current = setTimeout(() => { connectSocket() }, delay)
  }

  const start = useCallback(async (sourceId = 'microphone') => {
    userStop.current = false
    reconnectAttempts.current = 0
    try {
      const audioStream = await getStream(sourceId)
      stream.current = audioStream
      await buildAudioGraph(audioStream)
      await connectSocket()
    } catch (e) {
      fail(e.message)
    }
  }, [buildAudioGraph, connectSocket, fail])

  // Re-resume the AudioContext if the OS suspends it (device change / sleep).
  useEffect(() => {
    const resume = () => { try { if (ctx.current?.state === 'suspended') ctx.current.resume() } catch {} }
    navigator.mediaDevices?.addEventListener?.('devicechange', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])

  useEffect(() => () => { userStop.current = true; teardown() }, [teardown])
  return { supported: true, active, reconnecting, interim, start, stop }
}
