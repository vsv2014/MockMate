import { useEffect, useRef, useState, useCallback } from 'react'

// Downsample Float32 mic audio to 16 kHz mono PCM16 (Deepgram linear16 input).
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

// Accurate live transcription via Deepgram. The browser gets a short-lived token
// from our server, then streams audio straight to Deepgram over a WebSocket.
// Same interface as useSpeech: { supported, active, interim, start, stop }.
export function useDeepgram(onFinal, onFail) {
  const [active, setActive] = useState(false)
  const [interim, setInterim] = useState('')
  const ws = useRef(null), ctx = useRef(null), proc = useRef(null), stream = useRef(null)
  const userStop = useRef(false), connected = useRef(false)
  const onFinalRef = useRef(onFinal), onFailRef = useRef(onFail)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  useEffect(() => { onFailRef.current = onFail }, [onFail])

  const teardown = useCallback(() => {
    try { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ type: 'CloseStream' })) } catch {}
    try { proc.current?.disconnect() } catch {}
    try { ctx.current?.close() } catch {}
    stream.current?.getTracks().forEach(t => t.stop())
    try { ws.current?.close() } catch {}
    ws.current = ctx.current = proc.current = stream.current = null
    connected.current = false
    setActive(false); setInterim('')
  }, [])

  const stop = useCallback(() => { userStop.current = true; teardown() }, [teardown])

  // Deepgram dropped unexpectedly (quota exceeded, network, auth) — hand off.
  const fail = useCallback(reason => {
    if (userStop.current) return
    teardown()
    onFailRef.current?.(reason)
  }, [teardown])

  const start = useCallback(async () => {
    if (ws.current) return  // already running — guard against concurrent calls
    userStop.current = false
    try {
    const res = await fetch('/api/deepgram-token', { method: 'POST' }).then(r => r.json())
    if (!res.access_token) throw new Error(res.error || 'No Deepgram token')
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    stream.current = mic
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    ctx.current = ac
    const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true'
    const sock = new WebSocket(url, ['token', res.access_token])
    ws.current = sock
    sock.binaryType = 'arraybuffer'
    sock.onopen = () => {
      const source = ac.createMediaStreamSource(mic)
      const p = ac.createScriptProcessor(4096, 1, 1)
      proc.current = p
      const mute = ac.createGain(); mute.gain.value = 0
      p.onaudioprocess = e => { if (sock.readyState === 1) sock.send(toPCM16(e.inputBuffer.getChannelData(0), ac.sampleRate, 16000)) }
      source.connect(p); p.connect(mute); mute.connect(ac.destination)
      connected.current = true
      setActive(true)
    }
    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data) } catch { return }
      // Deepgram sends a metadata/error frame on quota or auth problems.
      if (m.type === 'Error' || m.err_code) { fail(m.err_msg || m.err_code || 'deepgram error'); return }
      const text = m.channel?.alternatives?.[0]?.transcript?.trim()
      if (!text) return
      if (m.is_final) { onFinalRef.current?.(text); setInterim('') }
      else setInterim(text)
    }
    sock.onerror = () => fail('connection error')
    sock.onclose = ev => { if (!userStop.current) fail(ev?.reason || `closed (${ev?.code || '?'})`) }
    } catch (e) {
      fail(e.message)
    }
  }, [fail])

  useEffect(() => () => { userStop.current = true; teardown() }, [teardown])
  return { supported: true, active, interim, start, stop }
}
