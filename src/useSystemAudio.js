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

// Get an audio MediaStream from either:
//   sourceId = 'microphone'        → getUserMedia mic
//   sourceId = desktopCapturer id  → Electron system audio (what comes through speakers)
async function getStream(sourceId) {
  if (!sourceId || sourceId === 'microphone') {
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    })
  }
  // Electron: Chrome requires video to be requested alongside desktop audio.
  // We stop the video tracks immediately after — we only care about audio.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 1, maxHeight: 1 } }
  })
  stream.getVideoTracks().forEach(t => t.stop())
  return stream
}

// Detect whether an interim transcript looks like a complete question —
// enough to start the LLM call early rather than waiting for is_final.
function looksLikeQuestion(text) {
  const words = text.trim().split(/\s+/).length
  if (words < 6) return false
  return text.endsWith('?') ||
    /\b(tell me|describe|explain|how would|what is|walk me|can you|why did|why do|have you|give me|what are|how do|what was|what were|when did|where did)\b/i.test(text)
}

// Live transcription via Deepgram, feeding either the microphone or system audio.
// Interface matches useSpeech / useDeepgram: { supported, active, interim, start(sourceId), stop }
// onEarlyQuestion fires on a high-confidence interim that looks like a complete question,
// before is_final — lets the UI start the LLM call ~1-2s earlier.
export function useSystemAudio(onFinal, onFail, onEarlyQuestion) {
  const [active, setActive] = useState(false)
  const [interim, setInterim] = useState('')
  const ws = useRef(null), ctx = useRef(null), proc = useRef(null), stream = useRef(null)
  const userStop = useRef(false)
  const lastEarlyTrigger = useRef('')
  const onFinalRef = useRef(onFinal), onFailRef = useRef(onFail), onEarlyRef = useRef(onEarlyQuestion)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  useEffect(() => { onFailRef.current = onFail }, [onFail])
  useEffect(() => { onEarlyRef.current = onEarlyQuestion }, [onEarlyQuestion])

  const teardown = useCallback(() => {
    try { if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ type: 'CloseStream' })) } catch {}
    try { proc.current?.disconnect() } catch {}
    try { ctx.current?.close() } catch {}
    stream.current?.getTracks().forEach(t => t.stop())
    try { ws.current?.close() } catch {}
    ws.current = ctx.current = proc.current = stream.current = null
    setActive(false); setInterim('')
  }, [])

  const stop = useCallback(() => { userStop.current = true; teardown() }, [teardown])

  const fail = useCallback(reason => {
    if (userStop.current) return
    teardown()
    onFailRef.current?.(reason)
  }, [teardown])

  const start = useCallback(async (sourceId = 'microphone') => {
    userStop.current = false
    try {
      const tokenRes = await fetch('/api/deepgram-token', { method: 'POST' }).then(r => r.json())
      if (!tokenRes.access_token) throw new Error(tokenRes.error || 'No Deepgram token')

      const audioStream = await getStream(sourceId)
      stream.current = audioStream

      const ac = new (window.AudioContext || window.webkitAudioContext)()
      ctx.current = ac

      const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&utterance_end_ms=1200'
      const sock = new WebSocket(url, ['token', tokenRes.access_token])
      ws.current = sock

      sock.onopen = () => {
        const source = ac.createMediaStreamSource(audioStream)
        const p = ac.createScriptProcessor(4096, 1, 1)
        proc.current = p
        const mute = ac.createGain(); mute.gain.value = 0
        p.onaudioprocess = e => {
          if (sock.readyState === 1) sock.send(toPCM16(e.inputBuffer.getChannelData(0), ac.sampleRate))
        }
        source.connect(p); p.connect(mute); mute.connect(ac.destination)
        setActive(true)
      }

      sock.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data) } catch { return }
        if (m.type === 'Error' || m.err_code) { fail(m.err_msg || m.err_code || 'Deepgram error'); return }
        const text = m.channel?.alternatives?.[0]?.transcript?.trim()
        if (!text) return
        if (m.is_final) {
          lastEarlyTrigger.current = ''   // reset so next question can early-trigger
          onFinalRef.current?.(text)
          setInterim('')
        } else {
          setInterim(text)
          // Fire early if this interim looks like a complete question we haven't triggered yet.
          const confidence = m.channel?.alternatives?.[0]?.confidence ?? 0
          if (confidence > 0.82 && looksLikeQuestion(text) && text !== lastEarlyTrigger.current) {
            lastEarlyTrigger.current = text
            onEarlyRef.current?.(text)
          }
        }
      }

      sock.onerror = () => fail('connection error')
      sock.onclose = ev => { if (!userStop.current) fail(ev?.reason || `closed (${ev?.code})`) }
    } catch (e) {
      fail(e.message)
    }
  }, [fail])

  useEffect(() => () => { userStop.current = true; teardown() }, [teardown])
  return { supported: true, active, interim, start, stop }
}
