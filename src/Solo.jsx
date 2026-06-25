import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useSpeech } from './useSpeech'
import { useDeepgram } from './useDeepgram'
import { analyze, liveNudge } from '../shared/delivery.js'
import Report from './Report'
import { saveSession } from './history'
import { loadProfile, saveProfile as persistProfile } from './lib/profile'
import { fmtClock } from './lib/ui'
import { LANGUAGES, STT_LANG } from './lib/languages'
import { isTransient } from '../shared/llm-errors.js'

function speak(text, on, onDone) {
  // onDone fires when speech finishes (or immediately if TTS is off/unsupported) so the
  // caller can re-open the mic for the user's turn without capturing the interviewer's voice.
  if (!on || !window.speechSynthesis) { onDone?.(); return }
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    if (onDone) { u.onend = onDone; u.onerror = onDone }
    window.speechSynthesis.speak(u)
  } catch { onDone?.() }
}

export default function Solo({ onHome }) {
  const [phase, setPhase] = useState('setup')   // setup | live | report
  const [profile, setProfile] = useState(loadProfile())
  const [focus, setFocus] = useState('')
  const [followupDepth, setFollowupDepth] = useState('normal')
  const [relentless, setRelentless] = useState(false)
  const [tts, setTts] = useState(true)
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState(() => { try { return localStorage.getItem('llmProvider') || '' } catch { return '' } })
  const [dgAvailable, setDgAvailable] = useState(false)
  // Default to the FREE browser engine for Solo: it starts instantly (no token/socket
  // handshake) and uses no Deepgram quota — ideal for practice. Deepgram ("Accurate")
  // stays one click away for noisy mics / accents.
  const [useDg, setUseDg] = useState(false)

  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(d => {
      const list = d.providers || []
      setProviders(list)
      setProvider(p => (p && list.some(x => x.id === p)) ? p : (list[0]?.id || ''))
      setDgAvailable(!!d.deepgram)
    }).catch(() => {})
  }, [])
  useEffect(() => { if (provider) { try { localStorage.setItem('llmProvider', provider) } catch {} } }, [provider])

  const [transcript, setTranscript] = useState([])
  const [answer, setAnswer] = useState('')
  const [thinking, setThinking] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [clock, setClock] = useState(0)
  const [micStarting, setMicStarting] = useState(false)   // "Starting…" until the mic is actually live

  const startedAt = useRef(Date.now())
  const answerStart = useRef(null)
  const bottomRef = useRef(null)
  const transcriptRef = useRef([])
  // Hands-free conversation: once the user starts the mic, the interviewer keeps the
  // loop going — auto-restart the mic after it speaks, and auto-send when the user pauses.
  const voiceRef = useRef(false)        // true while in hands-free voice mode
  const answerRef = useRef('')          // latest draft, readable from timers
  const thinkingRef = useRef(false)
  const phaseRef = useRef('setup')
  const silenceTimer = useRef(null)     // fires submit() after a speech pause
  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => { answerRef.current = answer }, [answer])
  useEffect(() => { thinkingRef.current = thinking }, [thinking])
  useEffect(() => { phaseRef.current = phase }, [phase])
  // Clear any pending auto-send on unmount.
  useEffect(() => () => clearTimeout(silenceTimer.current), [])

  const config = { domainLabel: profile.targetRole ? `${profile.targetRole}` : 'General', roundLabel: 'Interview', focus, followupDepth, relentless }

  const onFinalText = text => {
    if (answerStart.current == null) answerStart.current = Date.now()
    setAnswer(a => (a ? a.trim() + ' ' : '') + text)
    if (voiceRef.current) scheduleAutoSubmit()   // hands-free: auto-send once they pause
  }
  // Auto-send the spoken answer after a short pause, so the interviewer keeps the
  // conversation going without a button press. Reset on every new word; only fires
  // when in voice mode, the interviewer isn't already responding, and there's content.
  function scheduleAutoSubmit() {
    clearTimeout(silenceTimer.current)
    silenceTimer.current = setTimeout(() => {
      if (voiceRef.current && !thinkingRef.current && phaseRef.current === 'live' && answerRef.current.trim()) submit()
    }, 2600)
  }
  const web = useSpeech(onFinalText, STT_LANG[profile.language] || 'en-US')
  // If Deepgram drops mid-session (quota/network/auth), fall back to the free
  // browser engine automatically so you can always keep talking.
  const dg = useDeepgram(onFinalText, reason => {
    setUseDg(false)
    setError(`Accurate speech (Deepgram) stopped — ${reason}. Switched to the free browser engine; you can keep talking.`)
    if (web.supported) web.start()
  }, STT_LANG[profile.language] || 'en-US')
  // Use Deepgram when configured & chosen; otherwise the free browser engine.
  const usingDg = useDg && dgAvailable
  const speech = usingDg ? dg : web

  // While the user is still producing words (interim text), hold off the auto-send timer;
  // re-arm it once they go quiet. This is the endpointing that decides "they finished talking".
  useEffect(() => {
    if (!voiceRef.current) return
    if (speech.interim && speech.interim.trim()) clearTimeout(silenceTimer.current)
    else if (answerRef.current.trim()) scheduleAutoSubmit()
  }, [speech.interim]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-open the mic for the user's turn (after the interviewer finished speaking).
  function resumeMic() {
    if (!voiceRef.current || phaseRef.current !== 'live') return
    try { const r = speech.start(); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch {}
  }

  async function startMic() {
    setError('')
    setMicStarting(true)      // instant feedback — Deepgram's token+socket handshake takes a moment
    voiceRef.current = true   // enter hands-free mode: auto-send on pause + auto-resume after replies
    if (usingDg) {
      try { await dg.start() } catch (e) { setUseDg(false); setError('Could not start Deepgram — using the free browser engine.'); if (web.supported) web.start() }
    } else {
      web.start()
    }
  }

  // User manually stops the mic — leave hands-free mode and cancel any pending auto-send.
  function stopMic() {
    voiceRef.current = false
    clearTimeout(silenceTimer.current)
    setMicStarting(false)
    speech.stop()
  }
  // Clear the "Starting…" label the instant the mic is actually live.
  useEffect(() => { if (speech.active) setMicStarting(false) }, [speech.active])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, thinking, speech.interim])
  useEffect(() => {
    if (phase !== 'live') return
    const id = setInterval(() => setClock(Date.now() - startedAt.current), 1000)
    return () => clearInterval(id)
  }, [phase])

  // live coach on the current draft — memoized so it only recomputes when the text changes
  // (not on every clock tick / unrelated re-render).
  const liveStats = useMemo(
    () => answer.trim() ? analyze(answer + (speech.interim ? ' ' + speech.interim : ''), null) : null,
    [answer, speech.interim]
  )
  const nudge = liveStats ? liveNudge(liveStats, { spoken: true }) : null

  function saveProfile(p) { setProfile(p); persistProfile(p) }

  async function requestTurn(current, attempt = 0) {
    setThinking(true); if (attempt === 0) setError('')
    // A transient provider blip (503/overloaded/timeout/network) shouldn't end a long
    // interview — retry a couple of times before surfacing an error. The server already
    // retries + fails over across providers; this is the last-resort client safety net.
    const retryTransient = async (msg, status) => {
      // Use the SAME classifier the server retries on (shared/llm-errors) so client + server
      // never disagree about what's retryable.
      const transient = isTransient({ status, message: msg })
      if (transient && attempt < 2) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        return requestTurn(current, attempt + 1)
      }
      setThinking(false); setError(msg || `Service error (${status || '?'})`)
      return null
    }
    try {
      const res = await fetch('/api/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, transcript: current, profile, provider, language: profile.language || 'English' })
      })
      let data = {}; try { data = await res.json() } catch { data = {} }   // 503s can arrive with no body
      if (!res.ok || data.error || !data.turn?.say) return await retryTransient(data.error, res.status)
      setThinking(false)
      const turn = data.turn
      setTranscript([...current, { role: 'interviewer', text: turn.say }])
      if (turn.questionNumber) setCurrentQuestion(turn.questionNumber)
      // Speak, then hand the turn back to the user: re-open the mic when the voice finishes
      // (or immediately if TTS is off) so the conversation continues hands-free.
      speak(turn.say, tts, resumeMic)
    } catch (e) { return await retryTransient(e.message, 0) }
  }

  function start() {
    setPhase('live')
    startedAt.current = Date.now()
    requestTurn([])
  }

  async function submit() {
    clearTimeout(silenceTimer.current)            // cancel any pending auto-send
    const text = (answerRef.current || answer).trim()
    if (!text || thinkingRef.current) return
    speech.stop()                                 // pause mic so the interviewer's voice isn't transcribed
    const durationMs = answerStart.current ? Date.now() - answerStart.current : null
    const meta = { ...analyze(text, durationMs), spoken: true }
    const next = [...transcriptRef.current, { role: 'candidate', text, meta }]
    setTranscript(next); setAnswer(''); answerRef.current = ''; answerStart.current = null
    await requestTurn(next)                        // requestTurn re-opens the mic after the reply
  }

  async function end() {
    voiceRef.current = false; clearTimeout(silenceTimer.current)
    speech.stop(); window.speechSynthesis?.cancel()
    if (!transcriptRef.current.some(t => t.role === 'candidate')) { onHome(); return }
    setEvaluating(true)
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, transcript: transcriptRef.current, profile, provider })
      }).then(r => r.json())
      const rep = res.report || { error: res.error }
      setReport(rep); setPhase('report')
      // Persist for later review (transcript + feedback), kept ~3 months on this machine.
      saveSession({ report: rep, transcript: transcriptRef.current, config, profile })
    } catch (e) { setReport({ error: e.message }); setPhase('report') }
    setEvaluating(false)
  }

  // ── report ──
  if (phase === 'report') return <Report report={report} onAgain={onHome} solo transcript={transcriptRef.current} />

  // ── setup ──
  if (phase === 'setup') return (
    <div className="wrap">
      <h1>Solo practice</h1>
      <p className="subtitle">You vs an AI interviewer. It <strong>speaks</strong> the questions, you <strong>answer out loud</strong>, and it keeps going — open-ended, like the real thing. Free in Chrome/Edge.</p>

      <div className="card">
        <div className="field"><label className="label">Your name</label>
          <input type="text" value={profile.name || ''} placeholder="e.g. Vishal" onChange={e => saveProfile({ ...profile, name: e.target.value })} /></div>
        <div className="field"><label className="label">Target role</label>
          <input type="text" value={profile.targetRole || ''} placeholder="e.g. Senior Backend Engineer" onChange={e => saveProfile({ ...profile, targetRole: e.target.value })} /></div>
        <div className="field"><label className="label">Resume <span style={{ color: 'var(--text-faint)' }}>(optional — makes questions about you)</span></label>
          <textarea rows={5} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 12px', borderRadius: 8 }}
            value={profile.resume || ''} placeholder="Paste your resume text…" onChange={e => saveProfile({ ...profile, resume: e.target.value })} /></div>
        <div className="field"><label className="label">Focus <span style={{ color: 'var(--text-faint)' }}>(optional)</span></label>
          <input type="text" value={focus} placeholder='e.g. "system design and tradeoffs"' onChange={e => setFocus(e.target.value)} /></div>
        <div className="field">
          <label className="label">Follow-up depth</label>
          <div className="seg">{[['light', 'Light'], ['normal', 'Normal'], ['deep', 'Deep']].map(([id, l]) =>
            <button key={id} className={followupDepth === id ? 'on' : ''} onClick={() => setFollowupDepth(id)}>{l}</button>)}</div>
        </div>
        {dgAvailable && (
          <div className="field">
            <label className="label">Speech recognition</label>
            <div className="seg">
              <button className={useDg ? 'on' : ''} onClick={() => setUseDg(true)}>🎯 Accurate (Deepgram)</button>
              <button className={!useDg ? 'on' : ''} onClick={() => setUseDg(false)}>Free (browser)</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>Deepgram is far more accurate and works in any browser; the free browser engine is Chrome/Edge only.</p>
          </div>
        )}
        {providers.length > 0 && (
          <div className="field">
            <label className="label">AI model</label>
            <select value={provider} onChange={e => setProvider(e.target.value)} style={{ maxWidth: 360 }}>
              {providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>Groq is fastest with the highest free limits; GPT-4o is the most capable.</p>
          </div>
        )}
        <div className="field">
          <label className="label">Interview language</label>
          <select value={profile.language || 'English'} onChange={e => saveProfile({ ...profile, language: e.target.value })} style={{ maxWidth: 360 }}>
            {LANGUAGES.map(l =>
              <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="row" style={{ alignItems: 'center', marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={relentless} onChange={() => setRelentless(v => !v)} /> 🔥 Beat-the-copilot (challenge canned answers)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={tts} onChange={() => setTts(v => !v)} /> 🔊 Interviewer speaks aloud
          </label>
        </div>
      </div>

      {!speech.supported && <div className="banner warn"><span>⚠</span><span>Speaking needs <strong>Chrome or Edge</strong>. You can still type your answers here.</span></div>}

      <button className="btn" onClick={start}>Start interview →</button>
      <button className="btn-ghost" style={{ marginLeft: 10 }} onClick={onHome}>Back</button>
    </div>
  )

  // ── live ──
  return (
    <div className="room-wrap">
      <div className="room-top">
        <h2 style={{ margin: 0 }}>{profile.targetRole || 'Interview'}</h2>
        <span className="meta">· Question {currentQuestion || 1} · open-ended</span>
        <span className="meta" style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>⏱ {fmtClock(clock)}</span>
        <span className="spacer" />
        <button className="btn-danger" onClick={end} disabled={evaluating}>{evaluating ? 'Scoring…' : 'End & get feedback'}</button>
      </div>

      <div className="transcript" style={{ height: 'auto', minHeight: 320, maxHeight: '52vh' }}>
        {transcript.map((t, i) => (
          <div key={i} className={`t-seg ${t.role === 'interviewer' ? 'interviewer' : 'candidate'}`}>
            <div className="t-who">{t.role === 'interviewer' ? 'Interviewer' : 'You'}</div>
            <div>{t.text}</div>
          </div>
        ))}
        {thinking && <div className="t-seg"><div className="t-interim">interviewer is thinking…</div></div>}
        {error && <div className="banner warn" style={{ marginTop: 10 }}><span>⚠</span><span>{error}</span></div>}
        <div ref={bottomRef} />
      </div>

      {liveStats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0' }}>
          <span className="chip">🗣 {liveStats.words} words</span>
          {liveStats.fillers.count > 0 && <span className="chip">{liveStats.fillers.count} fillers</span>}
          {liveStats.jargon.count > 0 && <span className="chip">{liveStats.jargon.count} buzzwords</span>}
          {nudge && <span className="chip" style={{ color: nudge.rating === 'good' ? 'var(--good)' : nudge.rating === 'weak' ? 'var(--bad)' : 'var(--warn)' }}>{nudge.text}</span>}
        </div>
      )}

      <textarea rows={3} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 12px', borderRadius: 8, marginTop: 10 }}
        placeholder={speech.active ? 'Listening… speak your answer' : 'Click the mic and speak — or type here'}
        value={answer + (speech.interim ? ' ' + speech.interim : '')}
        onChange={e => setAnswer(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />

      <div className="mic-bar" style={{ marginTop: 10 }}>
        <button className={speech.active ? 'btn-danger' : 'btn-ghost'} onClick={() => speech.active ? stopMic() : startMic()} disabled={!speech.supported || micStarting}>
          {micStarting ? '⏳ Starting…' : speech.active ? '⏹ Stop' : '🎤 Speak'}
        </button>
        <button className="btn" onClick={submit} disabled={!answer.trim() || thinking}>Send answer</button>
        {speech.active && <><span className="rec-dot" /><span className="meta">listening — auto-sends when you pause</span></>}
        <span className="spacer" />
        <span className="meta">The interviewer won’t tell you if you’re right — feedback comes at the end.</span>
      </div>
    </div>
  )
}
