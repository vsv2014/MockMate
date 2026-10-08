import { apiFetch } from './apiClient'
import { diagnostic } from './diagnostics'
import { toPCM16 } from '../audio-pcm'

export const MAX_RECONNECTS = 150
export const KEEPALIVE_MS = 4000
export const FATAL_CLOSE = new Set([1008, 4001, 4003, 4008])
export const PERMANENT_TOKEN_STATUSES = new Set([401, 402, 403, 429])
export const BYTES_PER_SEC = 16000 * 2
// Cover the maximum 8s reconnect backoff plus token and handshake latency.
export const MAX_QUEUE_BYTES = 15 * BYTES_PER_SEC

export function computeReconnectDelayMs(attempt = 1) {
  const n = Math.max(1, Number(attempt) || 1)
  return Math.min(8000, 500 * 2 ** Math.min(n - 1, 4))
}

export function buildDeepgramListenUrl({
  degraded = false,
  language = 'en-US',
  diarize = false,
  keyterms = [],
} = {}) {
  const model = degraded ? 'nova-2' : 'nova-3'
  const base = `wss://api.deepgram.com/v1/listen?model=${model}&encoding=linear16&sample_rate=16000&channels=1`
    + '&interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=1200&vad_events=true&endpointing=300'
    + `&language=${encodeURIComponent(language || 'en-US')}`
  if (!diarize) return base
  if (degraded) return `${base}&diarize=true`
  const terms = Array.isArray(keyterms)
    ? keyterms.slice(0, 40).map(t => `&keyterm=${encodeURIComponent(t)}`).join('')
    : ''
  return `${base}&diarize=true${terms}`
}

export function abandonDeepgramSocket(sock, activeSocketRef, wsRef) {
  if (!sock) return
  try {
    sock.onclose = null
    sock.onerror = null
    sock.onmessage = null
    sock.onopen = null
    if (sock.readyState === 1) sock.send(JSON.stringify({ type: 'CloseStream' }))
  } catch {}
  try { sock.close() } catch {}
  if (activeSocketRef && activeSocketRef.current === sock) activeSocketRef.current = null
  if (wsRef && wsRef.current === sock) wsRef.current = null
}

export function enqueueOrSendPcm(
  buf,
  { wsRef, pcmQueueRef, pcmQueueBytesRef, pcmDroppedBytesRef, shouldDropFrame } = {},
) {
  if (!buf || (typeof shouldDropFrame === 'function' && shouldDropFrame())) return
  const sock = wsRef?.current
  if (sock && sock.readyState === 1) {
    try {
      sock.send(buf)
      return
    } catch {
      // The socket can close between readyState and send; retain the frame.
    }
  }
  pcmQueueRef.current.push(buf)
  pcmQueueBytesRef.current += buf.byteLength
  while (pcmQueueBytesRef.current > MAX_QUEUE_BYTES && pcmQueueRef.current.length) {
    const old = pcmQueueRef.current.shift()
    pcmQueueBytesRef.current -= old.byteLength
    pcmDroppedBytesRef.current += old.byteLength
  }
}

export function flushQueuedPcm({
  sock,
  pcmQueueRef,
  pcmQueueBytesRef,
  pcmDroppedBytesRef,
  mode = 'microphone',
  model = 'nova-3',
  warnOnDrop = false,
} = {}) {
  if (!pcmQueueRef?.current?.length) return
  const bufferedBytes = pcmQueueBytesRef.current
  const droppedBytes = pcmDroppedBytesRef.current
  diagnostic(
    'stt',
    'audio_buffer_flushed',
    { mode, bufferedBytes, droppedBytes, model },
    droppedBytes > 0 ? 'warn' : 'info',
  )
  if (warnOnDrop && droppedBytes > 0) {
    console.warn(
      `[audio] outage exceeded ${MAX_QUEUE_BYTES / BYTES_PER_SEC}s buffer — dropped ~${(droppedBytes / BYTES_PER_SEC).toFixed(1)}s of oldest audio`,
    )
  }
  const queued = pcmQueueRef.current
  pcmQueueRef.current = []
  pcmQueueBytesRef.current = 0
  pcmDroppedBytesRef.current = 0
  for (const buf of queued) {
    try { sock.send(buf) } catch {}
  }
}

export async function createDeepgramAudioGraph(
  audioStream,
  { ctxRef, srcNodeRef, procRef, sendPCM, logPrefix = 'audio', resumeImmediately = false } = {},
) {
  const AC = window.AudioContext || window.webkitAudioContext
  let ac
  try { ac = new AC({ sampleRate: 16000 }) } catch { ac = new AC() }
  ctxRef.current = ac
  if (resumeImmediately) {
    try { await ac.resume() } catch {}
  }
  const source = ac.createMediaStreamSource(audioStream)
  srcNodeRef.current = source
  const mute = ac.createGain()
  mute.gain.value = 0
  try {
    await ac.audioWorklet.addModule('/dg-worklet.js')
    // Loading the worklet is async; Stop/Restart may have closed this context.
    if (ctxRef.current !== ac || ac.state === 'closed') return
    const node = new AudioWorkletNode(ac, 'pcm-worklet')
    node.port.onmessage = e => sendPCM(e.data)
    source.connect(node)
    node.connect(mute)
    mute.connect(ac.destination)
    procRef.current = node
  } catch (err) {
    if (ctxRef.current !== ac || ac.state === 'closed') return
    console.warn(`[${logPrefix}] AudioWorklet unavailable, ScriptProcessor fallback:`, err?.message)
    const p = ac.createScriptProcessor(4096, 1, 1)
    p.onaudioprocess = e => sendPCM(toPCM16(e.inputBuffer.getChannelData(0), ac.sampleRate))
    source.connect(p)
    p.connect(mute)
    mute.connect(ac.destination)
    procRef.current = p
  }
}

export async function requestDeepgramToken({ mode, generation, reconnectAttempt } = {}) {
  diagnostic('stt', 'token_requested', {
    ...(mode ? { mode } : {}),
    generation,
    reconnectAttempt,
  })
  try {
    const r = await apiFetch('/api/deepgram-token', { method: 'POST' })
    const tokenStatus = r.status
    const tokenRes = await r.json().catch(() => null)
    return { ok: Boolean(tokenRes?.access_token), tokenStatus, tokenRes, networkError: false }
  } catch {
    return { ok: false, tokenStatus: 0, tokenRes: null, networkError: true }
  }
}
