import React, { useState, useRef, useEffect } from 'react'
import { useSpeech } from './useSpeech'
import { useDeepgram } from './useDeepgram'
import { analyze, liveNudge } from './delivery'
import Report from './Report'

const PROFILE_KEY = 'peerMockProfile'
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {} } catch { return {} }
}
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function speak(text, on) {
  if (!on || !window.speechSynthesis) return
  try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)) } catch {}
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
  const [useDg, setUseDg] = useState(true)   // prefer Deepgram when available

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

  const startedAt = useRef(Date.now())
  const answerStart = useRef(null)
  const bottomRef = useRef(null)
  const transcriptRef = useRef([])
  useEffect(() => { transcriptRef.current = transcript }, [transcript])

  const config = { domainLabel: profile.targetRole ? `${profile.targetRole}` : 'General', roundLabel: 'Interview', focus, followupDepth, relentless }

  const onFinalText = text => {
    if (answerStart.current == null) answerStart.current = Date.now()
    setAnswer(a => (a ? a.trim() + ' ' : '') + text)
  }
  const web = useSpeech(onFinalText)
  // If Deepgram drops mid-session (quota/network/auth), fall back to the free
  // browser engine automatically so you can always keep talking.
  const dg = useDeepgram(onFinalText, reason => {
    setUseDg(false)
    setError(`Accurate speech (Deepgram) stopped — ${reason}. Switched to the free browser engine; you can keep talking.`)
    if (web.supported) web.start()
  })
  // Use Deepgram when configured & chosen; otherwise the free browser engine.
  const usingDg = useDg && dgAvailable
  const speech = usingDg ? dg : web

  async function startMic() {
    setError('')
    if (usingDg) {
      try { await dg.start() } catch (e) { setUseDg(false); setError('Could not start Deepgram — using the free browser engine.'); if (web.supported) web.start() }
    } else {
      web.start()
    }
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, thinking, speech.interim])
  useEffect(() => {
    if (phase !== 'live') return
    const id = setInterval(() => setClock(Date.now() - startedAt.current), 1000)
    return () => clearInterval(id)
  }, [phase])

  // live coach on the current draft
  const liveStats = answer.trim() ? analyze(answer + (speech.interim ? ' ' + speech.interim : ''), null) : null
  const nudge = liveStats ? liveNudge(liveStats, { spoken: true }) : null

  function saveProfile(p) { setProfile(p); try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch {} }

  async function requestTurn(current) {
    setThinking(true); setError('')
    try {
      const res = await fetch('/api/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, transcript: current, profile, provider })
      }).then(r => r.json())
      setThinking(false)
      if (res.error) { setError(res.error); return }
      const turn = res.turn
      setTranscript([...current, { role: 'interviewer', text: turn.say }])
      if (turn.questionNumber) setCurrentQuestion(turn.questionNumber)
      speak(turn.say, tts)
    } catch (e) { setThinking(false); setError(e.message) }
  }

  function start() {
    setPhase('live')
    startedAt.current = Date.now()
    requestTurn([])
  }

  async function submit() {
    const text = answer.trim()
    if (!text || thinking) return
    speech.stop()
    const durationMs = answerStart.current ? Date.now() - answerStart.current : null
    const meta = { ...analyze(text, durationMs), spoken: true }
    const next = [...transcriptRef.current, { role: 'candidate', text, meta }]
    setTranscript(next); setAnswer(''); answerStart.current = null
    await requestTurn(next)
  }

  async function end() {
    speech.stop(); window.speechSynthesis?.cancel()
    if (!transcriptRef.current.some(t => t.role === 'candidate')) { onHome(); return }
    setEvaluating(true)
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, transcript: transcriptRef.current, profile, provider })
      }).then(r => r.json())
      setReport(res.report || { error: res.error }); setPhase('report')
    } catch (e) { setReport({ error: e.message }); setPhase('report') }
    setEvaluating(false)
  }

  // ── report ──
  if (phase === 'report') return <Report report={report} onAgain={onHome} solo />

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
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>Groq is fastest with the highest free limits; Gemini is an alternative.</p>
          </div>
        )}
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
        <button className={speech.active ? 'btn-danger' : 'btn-ghost'} onClick={() => speech.active ? speech.stop() : startMic()} disabled={!speech.supported}>
          {speech.active ? '⏹ Stop' : '🎤 Speak'}
        </button>
        <button className="btn" onClick={submit} disabled={!answer.trim() || thinking}>Send answer</button>
        {speech.active && <><span className="rec-dot" /><span className="meta">listening</span></>}
        <span className="spacer" />
        <span className="meta">The interviewer won’t tell you if you’re right — feedback comes at the end.</span>
      </div>
    </div>
  )
}
