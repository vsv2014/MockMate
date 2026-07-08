import React, { useState, useRef, useEffect, useMemo } from 'react'
import { apiFetch } from './lib/apiClient'
import { useDeepgram } from './useDeepgram'
import { analyze, liveNudge } from '../shared/delivery.js'
import SoloFeedback from './SoloFeedback'
import { saveSession } from './history'
import { loadProfile, saveProfile as persistProfile } from './lib/profile'
import { fmtClock } from './lib/ui'
import { LANGUAGES, STT_LANG } from './lib/languages'
import { isTransient } from '../shared/llm-errors.js'
import { T } from './auth/tokens'
import { isManaged } from './lib/aiMode'

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

// ── Small design-system building blocks (dark / glass / rounded / spacious) ──
function Section({ title, hint, children }) {
  return (
    <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>{title}</div>
        {hint && <div style={{ fontSize: 11.5, color: T.text3, marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}
function Label({ children }) { return <div style={{ fontSize: 12, color: T.text2, marginBottom: 7 }}>{children}</div> }
function Chips({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(o => {
        const [val, label] = Array.isArray(o) ? o : [o, o]
        const on = value === val
        return (
          <button key={val} onClick={() => onChange(val)}
            style={{ padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: T.font, fontSize: 12.5, fontWeight: on ? 600 : 400,
              background: on ? 'rgba(20,184,166,0.18)' : T.surface2, color: on ? T.text1 : T.text2,
              border: `1px solid ${on ? 'rgba(20,184,166,0.5)' : T.border}` }}>{label}</button>
        )
      })}
    </div>
  )
}
const textInput = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, color: T.text1, fontSize: 13, outline: 'none', fontFamily: T.font }

// Listening waveform — animated bars while the mic is capturing.
function Waveform({ active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: 34 }}>
      {Array.from({ length: 22 }).map((_, i) => (
        <span key={i} style={{ width: 3, borderRadius: 2, height: 6,
          background: active ? T.accentFrom : 'rgba(255,255,255,0.14)',
          animation: active ? `mmbar 0.9s ease-in-out ${(i % 11) * 0.06}s infinite` : 'none' }} />
      ))}
      <style>{`@keyframes mmbar{0%,100%{height:5px}50%{height:26px}}`}</style>
    </div>
  )
}

const COMPANIES = ['Google', 'Meta', 'Amazon', 'OpenAI', 'Microsoft', 'Startup']
const TIPS_BY_TYPE = {
  Technical: ['State your assumptions first', 'Talk through tradeoffs, not just the answer', 'Give a concrete example'],
  Behavioral: ['Use STAR: Situation, Task, Action, Result', 'Lead with the outcome / impact', 'Keep it to one clear story'],
  'System Design': ['Clarify requirements & scale first', 'Sketch the high-level design, then drill in', 'Call out bottlenecks and tradeoffs'],
  Mixed: ['Structure the answer before you dive in', 'Be specific — numbers and examples land', 'Pause to think; silence is fine'],
}

export default function Solo({ onHome }) {
  const [phase, setPhase] = useState('setup')   // setup | live | report
  const [profile, setProfile] = useState(loadProfile())
  const [interviewType, setInterviewType] = useState(() => loadProfile().interviewType || 'Technical')
  const [voiceStyle, setVoiceStyle] = useState(() => loadProfile().voiceStyle || 'Professional')
  const [followupDepth, setFollowupDepth] = useState('normal')   // Difficulty: light|normal|deep
  const [relentless, setRelentless] = useState(false)
  const [tts, setTts] = useState(true)
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState(() => { try { return localStorage.getItem('llmProvider') || '' } catch { return '' } })
  const managed = isManaged()
  const effProvider = managed ? '' : provider   // managed → let the server auto-route/failover
  const [dgAvailable, setDgAvailable] = useState(false)
  const [models, setModels] = useState([])   // dynamic per-key model list from /api/models
  // Voice = Deepgram ONLY. The browser SpeechRecognition API silently fails inside
  // Electron, which is what made the mic "not work". No Deepgram key → type your answers.

  useEffect(() => {
    apiFetch('/api/providers').then(r => r.json()).then(d => {
      const list = d.providers || []
      setProviders(list)
      setProvider(p => (p && list.some(x => x.id === p)) ? p : (list[0]?.id || ''))
      setDgAvailable(!!d.deepgram)
    }).catch(() => {})
    if (!managed) apiFetch('/api/models').then(r => r.json()).then(d => setModels(d.models || [])).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (provider) { try { localStorage.setItem('llmProvider', provider) } catch {} } }, [provider])

  const [transcript, setTranscript] = useState([])
  const [answer, setAnswer] = useState('')
  const [thinking, setThinking] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [clock, setClock] = useState(0)
  const [micStarting, setMicStarting] = useState(false)

  const startedAt = useRef(Date.now())
  const answerStart = useRef(null)
  const bottomRef = useRef(null)
  const transcriptRef = useRef([])
  const voiceRef = useRef(false)
  const answerRef = useRef('')
  const thinkingRef = useRef(false)
  const phaseRef = useRef('setup')
  const silenceTimer = useRef(null)
  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => { answerRef.current = answer }, [answer])
  useEffect(() => { thinkingRef.current = thinking }, [thinking])
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => () => clearTimeout(silenceTimer.current), [])

  // Fold the setup choices into the interview config. `focus` is the freeform steer the
  // engine already understands, so type + company flow through it and actually change questions.
  const focusText = [`${interviewType} interview`, profile.targetCompany ? `for ${profile.targetCompany}` : '', voiceStyle ? `interviewer tone: ${voiceStyle}` : '']
    .filter(Boolean).join(' — ')
  const config = { domainLabel: profile.targetRole || 'General', roundLabel: 'Interview', focus: focusText, followupDepth, relentless, interviewType, difficulty: followupDepth, voiceStyle }

  const onFinalText = text => {
    if (answerStart.current == null) answerStart.current = Date.now()
    setAnswer(a => (a ? a.trim() + ' ' : '') + text)
    if (voiceRef.current) scheduleAutoSubmit()
  }
  function scheduleAutoSubmit() {
    clearTimeout(silenceTimer.current)
    silenceTimer.current = setTimeout(() => {
      if (voiceRef.current && !thinkingRef.current && phaseRef.current === 'live' && answerRef.current.trim()) submit()
    }, 2600)
  }
  const dg = useDeepgram(onFinalText, reason => {
    voiceRef.current = false
    setMicStarting(false)
    setError(`Voice input stopped — ${reason}. You can keep going by typing your answer below.`)
  }, STT_LANG[profile.language] || 'en-US')
  const speech = dg
  const canSpeak = dgAvailable

  useEffect(() => {
    if (!voiceRef.current) return
    if (speech.interim && speech.interim.trim()) clearTimeout(silenceTimer.current)
    else if (answerRef.current.trim()) scheduleAutoSubmit()
  }, [speech.interim]) // eslint-disable-line react-hooks/exhaustive-deps

  function resumeMic() {
    if (!voiceRef.current || phaseRef.current !== 'live') return
    try { const r = speech.start(); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch {}
  }
  async function startMic() {
    setError(''); setMicStarting(true); voiceRef.current = true
    try { await dg.start() }
    catch (e) { voiceRef.current = false; setMicStarting(false); setError('Could not start voice input. You can still type your answer below.') }
  }
  function stopMic() { voiceRef.current = false; clearTimeout(silenceTimer.current); setMicStarting(false); speech.stop() }
  useEffect(() => { if (speech.active) setMicStarting(false) }, [speech.active])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, thinking, speech.interim])
  useEffect(() => {
    if (phase !== 'live') return
    const id = setInterval(() => setClock(Date.now() - startedAt.current), 1000)
    return () => clearInterval(id)
  }, [phase])

  const liveStats = useMemo(
    () => answer.trim() ? analyze(answer + (speech.interim ? ' ' + speech.interim : ''), null) : null,
    [answer, speech.interim]
  )
  const nudge = liveStats ? liveNudge(liveStats, { spoken: true }) : null

  function saveProfile(p) { setProfile(p); persistProfile(p) }
  function patchProfile(patch) { saveProfile({ ...profile, ...patch }) }

  async function requestTurn(current, attempt = 0) {
    setThinking(true); if (attempt === 0) setError('')
    const retryTransient = async (msg, status) => {
      const transient = isTransient({ status, message: msg })
      if (transient && attempt < 2) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        return requestTurn(current, attempt + 1)
      }
      setThinking(false); setError(msg || `Service error (${status || '?'})`)
      return null
    }
    try {
      const res = await apiFetch('/api/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, transcript: current, profile, provider: effProvider, language: profile.language || 'English' })
      })
      let data = {}; try { data = await res.json() } catch { data = {} }
      if (!res.ok || data.error || !data.turn?.say) return await retryTransient(data.error, res.status)
      setThinking(false)
      const turn = data.turn
      setTranscript([...current, { role: 'interviewer', text: turn.say }])
      if (turn.questionNumber) setCurrentQuestion(turn.questionNumber)
      speak(turn.say, tts, resumeMic)
    } catch (e) { return await retryTransient(e.message, 0) }
  }

  function start() { setPhase('live'); startedAt.current = Date.now(); requestTurn([]) }

  async function submit() {
    clearTimeout(silenceTimer.current)
    const text = (answerRef.current || answer).trim()
    if (!text || thinkingRef.current) return
    speech.stop()
    const durationMs = answerStart.current ? Date.now() - answerStart.current : null
    const meta = { ...analyze(text, durationMs), spoken: true }
    const next = [...transcriptRef.current, { role: 'candidate', text, meta }]
    setTranscript(next); setAnswer(''); answerRef.current = ''; answerStart.current = null
    await requestTurn(next)
  }

  // Re-speak the interviewer's last question (handy if you missed it).
  function repeatQuestion() {
    const last = [...transcriptRef.current].reverse().find(t => t.role === 'interviewer')
    if (last) speak(last.text, true)
  }

  async function end() {
    voiceRef.current = false; clearTimeout(silenceTimer.current)
    speech.stop(); window.speechSynthesis?.cancel()
    if (!transcriptRef.current.some(t => t.role === 'candidate')) { onHome(); return }
    setEvaluating(true)
    try {
      const res = await apiFetch('/api/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, transcript: transcriptRef.current, profile, provider: effProvider })
      }).then(r => r.json())
      const rep = res.report || { error: res.error }
      setReport(rep); setPhase('report')
      saveSession({ report: rep, transcript: transcriptRef.current, config, profile })
    } catch (e) { setReport({ error: e.message }); setPhase('report') }
    setEvaluating(false)
  }

  // ── report ──
  function practiceAgain() {
    setReport(null); setTranscript([]); setAnswer(''); answerRef.current = ''
    setCurrentQuestion(0); setClock(0); setError(''); setEvaluating(false); setPhase('setup')
  }
  if (phase === 'report') return <SoloFeedback report={report} onAgain={practiceAgain} transcript={transcriptRef.current} onAgainLabel="Practice again" />

  // ── SETUP ─────────────────────────────────────────────────────────────────────
  if (phase === 'setup') return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, fontFamily: T.font, paddingBottom: 20 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 600, color: T.text1 }}>Solo Practice</div>
        <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>Set the scene, then step into a full interview with an AI interviewer. It speaks, you answer out loud (or type), and it probes deeper — just like the real thing.</div>
      </div>

      <Section title="Interview">
        <div>
          <Label>Role</Label>
          <input style={textInput} value={profile.targetRole || ''} placeholder="e.g. Senior Backend Engineer" onChange={e => patchProfile({ targetRole: e.target.value })} />
        </div>
        <div>
          <Label>Experience</Label>
          <Chips options={['Student / New grad', '1–3 years', '4–6 years', '7+ years']} value={profile.yearsExp || ''} onChange={v => patchProfile({ yearsExp: v })} />
        </div>
        <div>
          <Label>Interview type</Label>
          <Chips options={['Technical', 'Behavioral', 'System Design', 'Mixed']} value={interviewType} onChange={v => { setInterviewType(v); patchProfile({ interviewType: v }) }} />
        </div>
        <div>
          <Label>Difficulty</Label>
          <Chips options={[['light', 'Easy'], ['normal', 'Medium'], ['deep', 'Hard']]} value={followupDepth} onChange={setFollowupDepth} />
        </div>
      </Section>

      <Section title="Personal context" hint="Optional — lets the interviewer ask about your actual background.">
        <textarea rows={4} style={{ ...textInput, resize: 'vertical' }} value={profile.resume || ''} placeholder="Paste your resume text…" onChange={e => patchProfile({ resume: e.target.value })} />
      </Section>

      <Section title="Target company" hint="Optional — tailors questions to a company's bar & style.">
        <Chips options={COMPANIES} value={profile.targetCompany || ''} onChange={v => patchProfile({ targetCompany: profile.targetCompany === v ? '' : v })} />
        <input style={textInput} value={profile.targetCompany || ''} placeholder="Or type any company…" onChange={e => patchProfile({ targetCompany: e.target.value })} />
      </Section>

      <Section title="Voice style" hint="How the interviewer comes across.">
        <Chips options={['Professional', 'Friendly', 'Concise', 'Detailed']} value={voiceStyle} onChange={v => { setVoiceStyle(v); patchProfile({ voiceStyle: v }) }} />
      </Section>

      <Section title="Session">
        {!managed && (providers.length > 0 || models.length > 0) && (
          <div>
            <Label>AI model</Label>
            <select value={provider} onChange={e => setProvider(e.target.value)} style={{ ...textInput, maxWidth: 380 }}>
              {models.length > 0
                ? models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)
                : providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <Label>Language</Label>
          <select value={profile.language || 'English'} onChange={e => patchProfile({ language: e.target.value })} style={{ ...textInput, maxWidth: 340 }}>
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: T.text2 }}>
          <input type="checkbox" checked={tts} onChange={() => setTts(v => !v)} /> Interviewer speaks the questions aloud
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: T.text2 }}>
          <input type="checkbox" checked={relentless} onChange={() => setRelentless(v => !v)} /> Challenge mode — pushes back on canned answers
        </label>
        <div style={{ fontSize: 11.5, color: T.text3 }}>
          {canSpeak ? '🎤 Voice is on (Deepgram) — you can answer out loud, or type.' : '⌨ No Deepgram key — you\'ll type your answers. Add one in API & Settings to answer by voice.'}
        </div>
      </Section>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={start} style={{ flex: 1, height: 48, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>Start Interview →</button>
        <button onClick={onHome} style={{ height: 48, padding: '0 20px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 13, cursor: 'pointer', fontFamily: T.font }}>Back</button>
      </div>
    </div>
  )

  // ── INTERVIEW WORKSPACE ─────────────────────────────────────────────────────────
  const tips = TIPS_BY_TYPE[interviewType] || TIPS_BY_TYPE.Mixed
  const lastQuestion = [...transcript].reverse().find(t => t.role === 'interviewer')?.text
  const panel = { background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, display: 'flex', flexDirection: 'column', minHeight: 0 }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 150px)', minHeight: 460, fontFamily: T.font, gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.text1 }}>{profile.targetRole || 'Interview'}</div>
        <span style={{ fontSize: 12, color: T.text3 }}>{interviewType}{profile.targetCompany ? ` · ${profile.targetCompany}` : ''}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: T.text2, fontVariantNumeric: 'tabular-nums' }}>⏱ {fmtClock(clock)}</span>
        <button onClick={end} disabled={evaluating}
          style={{ height: 34, padding: '0 14px', background: 'rgba(239,68,68,0.14)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)', borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
          {evaluating ? 'Scoring…' : 'End interview'}
        </button>
      </div>

      {/* 3 panels */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(320px, 1.1fr) 250px', gap: 12, minHeight: 0 }}>

        {/* Left — conversation */}
        <div style={panel}>
          <div style={{ padding: '11px 14px', borderBottom: `1px solid ${T.border}`, fontSize: 12, fontWeight: 600, color: T.text2 }}>Conversation</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {transcript.map((t, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', color: t.role === 'interviewer' ? T.accentFrom : T.text3 }}>{t.role === 'interviewer' ? 'INTERVIEWER' : 'YOU'}</span>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: t.role === 'interviewer' ? T.text1 : T.text2 }}>{t.text}</div>
              </div>
            ))}
            {thinking && <div style={{ fontSize: 12, color: T.text3, fontStyle: 'italic' }}>interviewer is thinking…</div>}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Center — current question + answering */}
        <div style={{ ...panel, background: 'transparent', border: 'none', gap: 12 }}>
          <div style={{ ...panel, flex: 1, padding: '18px 20px', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: T.text3 }}>QUESTION {currentQuestion || 1}</div>
              <div style={{ fontSize: 21, fontWeight: 500, color: T.text1, lineHeight: 1.4, marginTop: 12 }}>
                {thinking && !lastQuestion ? 'Getting your first question…' : (lastQuestion || '…')}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <Waveform active={speech.active} />
              <div style={{ textAlign: 'center', fontSize: 11.5, color: T.text3, marginTop: 6 }}>
                {micStarting ? 'Starting mic…' : speech.active ? 'Listening — pause when you\'re done' : canSpeak ? 'Click the mic to answer aloud, or type below' : 'Type your answer below'}
              </div>
            </div>
          </div>

          {/* Answer input */}
          <textarea rows={3} style={{ ...textInput, resize: 'none', flexShrink: 0 }}
            placeholder={speech.active ? 'Listening… speak your answer' : canSpeak ? 'Speak, or type your answer here' : 'Type your answer here, then Send'}
            value={answer + (speech.interim ? ' ' + speech.interim : '')}
            onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />

          {/* Controls */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {canSpeak && (
              <button onClick={() => speech.active ? stopMic() : startMic()} disabled={micStarting}
                style={{ height: 42, width: 46, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: T.rCtrl, cursor: 'pointer', fontSize: 16,
                  background: speech.active ? 'rgba(239,68,68,0.16)' : T.surface2, color: speech.active ? '#f87171' : T.text1, border: `1px solid ${speech.active ? 'rgba(239,68,68,0.4)' : T.border}` }}
                title={speech.active ? 'Stop' : 'Speak'}>{speech.active ? '⏹' : '🎤'}</button>
            )}
            <button onClick={repeatQuestion} disabled={!lastQuestion}
              style={{ height: 42, padding: '0 14px', flexShrink: 0, background: T.surface2, color: T.text2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, cursor: 'pointer', fontSize: 12.5, fontFamily: T.font }} title="Re-read the question">🔁 Repeat</button>
            <button onClick={submit} disabled={!answer.trim() || thinking}
              style={{ flex: 1, height: 42, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 14, fontWeight: 600, cursor: (!answer.trim() || thinking) ? 'default' : 'pointer', opacity: (!answer.trim() || thinking) ? 0.5 : 1, fontFamily: T.font }}>Send answer</button>
          </div>
          {error && <div style={{ fontSize: 12, color: '#fca5a5', flexShrink: 0 }}>⚠ {error}</div>}
        </div>

        {/* Right — AI insights */}
        <div style={{ ...panel, background: 'transparent', border: 'none', gap: 12, overflowY: 'auto' }}>
          <div style={{ ...panel, padding: '14px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', color: T.text3, marginBottom: 10 }}>HOW TO ANSWER</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {tips.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: T.text2, lineHeight: 1.4 }}>
                  <span style={{ color: T.accentFrom, flexShrink: 0 }}>✓</span><span>{t}</span>
                </div>
              ))}
            </div>
          </div>
          {nudge && (
            <div style={{ ...panel, padding: '14px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', color: T.text3, marginBottom: 8 }}>LIVE COACH</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: nudge.rating === 'good' ? T.success : nudge.rating === 'weak' ? '#fca5a5' : '#fbbf24' }}>{nudge.text}</div>
            </div>
          )}
          <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.5, padding: '0 4px' }}>
            No hints on whether you're right — full feedback comes at the end.
          </div>
        </div>
      </div>
    </div>
  )
}
