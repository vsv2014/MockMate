import { useEffect, useRef, useState, useCallback } from 'react'

// Free live speech-to-text using the browser's Web Speech API (Chrome/Edge).
// No API key, no cost — this is the whole reason a *browser* app beats Electron
// for live transcription. Each participant transcribes their OWN mic locally;
// final segments are handed to onFinal() so the room can share them.
//
// Caveats (be honest in the UI): best in Chrome/Edge; Firefox/Safari are spotty.
// Recognition stops on long silence, so we auto-restart while `active`.
export function useSpeech(onFinal, lang = 'en-US') {
  const Rec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  const supported = !!Rec
  const [active, setActive] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef(null)
  const activeRef = useRef(false)
  const onFinalRef = useRef(onFinal)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])
  // Transcribe in the interview's language, not always en-US — wrong-language
  // recognition mangles accuracy. Applied at each start() so a setup change takes effect.
  const langRef = useRef(lang || 'en-US')
  useEffect(() => { langRef.current = lang || 'en-US' }, [lang])

  useEffect(() => {
    if (!supported) return
    const rec = new Rec()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = langRef.current
    rec.onresult = e => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const text = r[0].transcript.trim()
          if (text) onFinalRef.current?.(text)
        } else {
          live += r[0].transcript
        }
      }
      setInterim(live)
    }
    rec.onend = () => {
      // Auto-restart if the user hasn't stopped (Web Speech ends on silence).
      if (activeRef.current) { try { rec.start() } catch {} }
      else setInterim('')
    }
    rec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') stop() }
    recRef.current = rec
    return () => { activeRef.current = false; try { rec.stop() } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported])

  const start = useCallback(() => {
    if (!supported || activeRef.current) return
    activeRef.current = true; setActive(true)
    try { if (recRef.current) recRef.current.lang = langRef.current } catch {}
    try { recRef.current?.start() } catch {}
  }, [supported])

  const stop = useCallback(() => {
    activeRef.current = false; setActive(false); setInterim('')
    try { recRef.current?.stop() } catch {}
  }, [])

  return { supported, active, interim, start, stop }
}
