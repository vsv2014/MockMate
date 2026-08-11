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
import { retrieveContext, warmDocs } from './lib/docs'

function speak(text, on, onDone, lang = 'en-US') {
  // onDone fires when speech finishes (or immediately if TTS is off/unsupported) so the
  // caller can re-open the mic for the user's turn without capturing the interviewer's voice.
  if (!on || !window.speechSynthesis) { onDone?.(); return }
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    try { u.lang = lang || 'en-US' } catch {}
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

export default function Solo({ onHome, noProviders }) {
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

  const silenceMs = 5500   // was 2600 — cutting mid-thought felt broken
  const ttsBusy = useRef(false)
  const lastKind = useRef('question')

  // Fold the setup choices into the interview config. `focus` is the freeform steer the
  // engine already understands, so type + company + JD/resume cues actually change questions.
  const focusText = [
    `${interviewType} interview`,
    profile.targetCompany ? `for ${profile.targetCompany}` : '',
    voiceStyle ? `interviewer tone: ${voiceStyle}` : '',
    profile.yearsExp ? `seniority: ${profile.yearsExp}` : '',
    profile.jobDescription ? 'ground questions in the pasted job description' : '',
    profile.resume ? 'ground questions in the candidate resume projects' : '',
  ].filter(Boolean).join(' — ')
  const config = { domainLabel: profile.targetRole || 'General', roundLabel: 'Interview', focus: focusText, followupDepth, relentless, interviewType, difficulty: followupDepth, voiceStyle }

  const onFinalText = text => {
    if (ttsBusy.current) return   // never capture interviewer TTS into the answer
    if (answerStart.current == null) answerStart.current = Date.now()
    setAnswer(a => (a ? a.trim() + ' ' : '') + text)
    if (voiceRef.current) scheduleAutoSubmit()
  }
  function scheduleAutoSubmit() {
    clearTimeout(silenceTimer.current)
    silenceTimer.current = setTimeout(() => {
      if (ttsBusy.current) return
      if (voiceRef.current && !thinkingRef.current && phaseRef.current === 'live' && answerRef.current.trim()) submit()
    }, silenceMs)
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
    ttsBusy.current = false
    if (!voiceRef.current || phaseRef.current !== 'live') return
    try { const r = speech.start(); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch {}
  }
  async function startMic() {
    if (ttsBusy.current) return
    setError(''); setMicStarting(true); voiceRef.current = true
    try { await dg.start() }
    catch (e) { voiceRef.current = false; setMicStarting(false); setError('Could not start voice input. You can still type below — tap Retry voice when ready.') }
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

  const hasContext = !!(String(profile.resume || '').trim().length > 40 || String(profile.jobDescription || '').trim().length > 40)
  const canStartSolo = !noProviders && hasContext

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
      // RAG over locally uploaded docs (best-effort, time-boxed) — never stalls the turn.
      const lastAsk = [...current].reverse().find(t => t.role === 'interviewer')?.text
        || [profile.targetRole, profile.targetCompany, 'interview start'].filter(Boolean).join(' ')
      const extraContext = await retrieveContext(lastAsk, { budgetMs: 1800 }).catch(() => '')
      const res = await apiFetch('/api/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config, transcript: current, profile, provider: effProvider,
          language: profile.language || 'English',
          ...(extraContext ? { extraContext } : {}),
        })
      })
      let data = {}; try { data = await res.json() } catch { data = {} }
      if (!res.ok || data.error || !data.turn?.say) return await retryTransient(data.error, res.status)
      setThinking(false)
      const turn = data.turn
      lastKind.current = turn.kind === 'followup' ? 'followup' : 'question'
      setTranscript([...current, { role: 'interviewer', text: turn.say, kind: lastKind.current, grounding: turn.grounding || null }])
      if (turn.questionNumber) setCurrentQuestion(turn.questionNumber)
      // Hard-mute mic while TTS plays so the question never lands in the answer transcript.
      ttsBusy.current = true
      try { speech.stop() } catch {}
      speak(turn.say, tts, resumeMic, STT_LANG[profile.language] || 'en-US')
    } catch (e) { return await retryTransient(e.message, 0) }
  }

  function start() {
    if (!canStartSolo) {
      setError(noProviders
        ? 'Add an AI key in Settings before starting.'
        : 'Paste a resume or job description so the interviewer can ask practical questions.')
      return
    }
    warmDocs()   // pre-embed uploaded docs so turn 1 can ground (same path as Live)
    setPhase('live'); startedAt.current = Date.now(); requestTurn([])
  }

  async function submit() {
    clearTimeout(silenceTimer.current)
    const text = (answerRef.current || answer).trim()
    if (!text || thinkingRef.current || ttsBusy.current) return
    if (text.split(/\s+/).filter(Boolean).length < 3) {
      setError('Say a bit more (a few sentences) so the interviewer can follow up — then Continue.')
      return
    }
    speech.stop()
    const durationMs = answerStart.current ? Date.now() - answerStart.current : null
    const meta = { ...analyze(text, durationMs), spoken: true }
    const next = [...transcriptRef.current, { role: 'candidate', text, meta }]
    setTranscript(next); setAnswer(''); answerRef.current = ''; answerStart.current = null; setError('')
    await requestTurn(next)
  }

  // Re-speak the interviewer's last question (handy if you missed it).
  function repeatQuestion() {
    if (ttsBusy.current) return
    const last = [...transcriptRef.current].reverse().find(t => t.role === 'interviewer')
    if (last) {
      ttsBusy.current = true
      try { speech.stop() } catch {}
      speak(last.text, true, resumeMic, STT_LANG[profile.language] || 'en-US')
    }
  }

  async function end() {
    voiceRef.current = false; clearTimeout(silenceTimer.current); ttsBusy.current = false
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
    window.speechSynthesis?.cancel()
    ttsBusy.current = false; voiceRef.current = false
    try { speech.stop() } catch {}
    setThinking(false); setReport(null); setTranscript([]); setAnswer(''); answerRef.current = ''
    setCurrentQuestion(0); setClock(0); setError(''); setEvaluating(false); setPhase('setup')
  }
  if (phase === 'report') return <SoloFeedback report={report} onAgain={practiceAgain} transcript={transcriptRef.current} onAgainLabel="Practice again" />

  // ── SETUP ─────────────────────────────────────────────────────────────────────
  if (phase === 'setup') return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, fontFamily: T.font, paddingBottom: 20 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 600, color: T.text1 }}>Solo Practice</div>
        <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>Practice with an interviewer who has read your resume &amp; JD — a real conversation, not a question bank.</div>
      </div>

      {noProviders && (
        <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#fca5a5' }}>
          ⚠ No AI configured — the interviewer needs a model to run. Add an AI key in <strong>Settings</strong> (or switch to MockMate AI) before starting.
        </div>
      )}
      {error && <div style={{ fontSize: 12, color: '#fca5a5' }}>⚠ {error}</div>}

      <Section title="Your materials" hint="Required — the interviewer asks about YOUR projects and this role.">
        <div>
          <Label>Resume</Label>
          <textarea rows={5} style={{ ...textInput, resize: 'vertical' }} value={profile.resume || ''} placeholder="Paste your resume text…" onChange={e => patchProfile({ resume: e.target.value })} />
        </div>
        <div>
          <Label>Job description</Label>
          <textarea rows={4} style={{ ...textInput, resize: 'vertical' }} value={profile.jobDescription || ''} placeholder="Paste the JD you’re practicing for…" onChange={e => patchProfile({ jobDescription: e.target.value })} />
        </div>
        {!hasContext && (
          <div style={{ fontSize: 12, color: '#fbbf24' }}>Add a resume or JD so questions stay practical and conversational.</div>
        )}
      </Section>

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

      <Section title="Target company" hint="Optional — tailors questions to a company's bar & style.">
        <Chips options={COMPANIES} value={profile.targetCompany || ''} onChange={v => patchProfile({ targetCompany: profile.targetCompany === v ? '' : v })} />
        <input style={textInput} value={profile.targetCompany || ''} placeholder="Or type any company…" onChange={e => patchProfile({ targetCompany: e.target.value })} />
      </Section>

      <details style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '12px 16px' }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: T.text2 }}>Session options</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
          <div>
            <Label>Voice style</Label>
            <Chips options={['Professional', 'Friendly', 'Concise', 'Detailed']} value={voiceStyle} onChange={v => { setVoiceStyle(v); patchProfile({ voiceStyle: v }) }} />
          </div>
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
            {canSpeak ? '🎤 Voice is on (Deepgram) — answer out loud or type.' : '⌨ No Deepgram key — type your replies. Add one in Settings for voice.'}
          </div>
        </div>
      </details>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={start} disabled={!canStartSolo}
          style={{ flex: 1, height: 48, background: canStartSolo ? T.accent : T.surface2, color: canStartSolo ? '#fff' : T.text3, border: 'none', borderRadius: T.rCtrl, fontSize: 15, fontWeight: 600, cursor: canStartSolo ? 'pointer' : 'default', fontFamily: T.font }}>
          Begin interview →
        </button>
        <button onClick={onHome} style={{ height: 48, padding: '0 20px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 13, cursor: 'pointer', fontFamily: T.font }}>Back</button>
      </div>
    </div>
  )

  // ── INTERVIEW WORKSPACE (conversation-first) ─────────────────────────────────
  const tips = TIPS_BY_TYPE[interviewType] || TIPS_BY_TYPE.Mixed
  const lastTurn = [...transcript].reverse().find(t => t.role === 'interviewer')
  const lastQuestion = lastTurn?.text
  const beatLabel = thinking && !lastQuestion
    ? 'Opening'
    : (lastTurn?.kind === 'followup' ? 'Follow-up' : (transcript.filter(t => t.role === 'interviewer' && t.kind !== 'followup').length <= 1 ? 'Opening' : 'New topic'))
  const panel = { background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, display: 'flex', flexDirection: 'column', minHeight: 0 }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 150px)', minHeight: 460, fontFamily: T.font, gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.text1 }}>{profile.targetRole || 'Interview'}</div>
        <span style={{ fontSize: 12, color: T.text3 }}>{interviewType}{profile.targetCompany ? ` · ${profile.targetCompany}` : ''}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: T.text2, fontVariantNumeric: 'tabular-nums' }}>⏱ {fmtClock(clock)}</span>
        <button onClick={end} disabled={evaluating}
          style={{ height: 34, padding: '0 14px', background: 'rgba(239,68,68,0.14)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)', borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
          {evaluating ? 'Scoring…' : 'End interview'}
        </button>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(280px, 0.9fr) minmax(0, 1.4fr)', gap: 12, minHeight: 0 }}>
        {/* Quiet history */}
        <div style={panel}>
          <div style={{ padding: '11px 14px', borderBottom: `1px solid ${T.border}`, fontSize: 12, fontWeight: 600, color: T.text2 }}>Conversation</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {transcript.map((t, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', color: t.role === 'interviewer' ? T.accentFrom : T.text3 }}>
                  {t.role === 'interviewer' ? (t.kind === 'followup' ? 'FOLLOW-UP' : 'INTERVIEWER') : 'YOU'}
                </span>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: t.role === 'interviewer' ? T.text1 : T.text2 }}>{t.text}</div>
                {t.grounding && <div style={{ fontSize: 10.5, color: T.text3 }}>About: {t.grounding}</div>}
              </div>
            ))}
            {thinking && <div style={{ fontSize: 12, color: T.text3, fontStyle: 'italic' }}>Interviewer is listening to your last point…</div>}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Center stage */}
        <div style={{ ...panel, background: 'transparent', border: 'none', gap: 12 }}>
          <div style={{ ...panel, flex: 1, padding: '18px 20px', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: T.text3 }}>{beatLabel.toUpperCase()}</div>
              <div style={{ fontSize: 20, fontWeight: 500, color: T.text1, lineHeight: 1.4, marginTop: 12 }}>
                {thinking && !lastQuestion ? 'Getting your first question…' : (lastQuestion || '…')}
              </div>
              {lastTurn?.grounding && (
                <div style={{ marginTop: 10, display: 'inline-block', fontSize: 11, color: '#5eead4', background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 999, padding: '3px 10px' }}>
                  About: {lastTurn.grounding}
                </div>
              )}
            </div>
            <div style={{ marginTop: 16 }}>
              <Waveform active={speech.active && !ttsBusy.current} />
              <div style={{ textAlign: 'center', fontSize: 11.5, color: T.text3, marginTop: 6 }}>
                {ttsBusy.current ? 'Interviewer speaking…' : micStarting ? 'Starting mic…' : speech.active ? 'Listening — pause ~5s when done, or tap Continue' : canSpeak ? 'Tap the mic to speak, or type below' : 'Type your reply below'}
              </div>
            </div>
          </div>

          <textarea rows={3} style={{ ...textInput, resize: 'none', flexShrink: 0 }}
            placeholder={speech.active ? 'Listening…' : canSpeak ? 'Speak, or type your reply' : 'Type your reply, then Continue'}
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
          {speech.interim && <div style={{ fontSize: 12, color: T.text3, fontStyle: 'italic', flexShrink: 0, marginTop: -4 }}>{speech.interim}…</div>}

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {canSpeak && (
              <button onClick={() => speech.active ? stopMic() : startMic()} disabled={micStarting || ttsBusy.current}
                style={{ height: 42, width: 46, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: T.rCtrl, cursor: 'pointer', fontSize: 16,
                  background: speech.active ? 'rgba(239,68,68,0.16)' : T.surface2, color: speech.active ? '#f87171' : T.text1, border: `1px solid ${speech.active ? 'rgba(239,68,68,0.4)' : T.border}` }}
                title={speech.active ? 'Stop' : (voiceRef.current === false && error ? 'Retry voice' : 'Speak')}>{speech.active ? '⏹' : '🎤'}</button>
            )}
            <button onClick={repeatQuestion} disabled={!lastQuestion || ttsBusy.current}
              style={{ height: 42, padding: '0 14px', flexShrink: 0, background: T.surface2, color: T.text2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, cursor: 'pointer', fontSize: 12.5, fontFamily: T.font }} title="Hear again">🔁 Repeat</button>
            <button onClick={submit} disabled={!answer.trim() || thinking || ttsBusy.current}
              style={{ flex: 1, height: 42, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 14, fontWeight: 600, cursor: (!answer.trim() || thinking || ttsBusy.current) ? 'default' : 'pointer', opacity: (!answer.trim() || thinking || ttsBusy.current) ? 0.5 : 1, fontFamily: T.font }}>Continue</button>
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#fca5a5', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠ {error}</span>
              {/Voice input stopped|Could not start voice/i.test(error) && canSpeak && (
                <button onClick={startMic} style={{ background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.4)', color: '#5eead4', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Retry voice</button>
              )}
            </div>
          )}
          <details style={{ fontSize: 12, color: T.text3 }}>
            <summary style={{ cursor: 'pointer' }}>Coach whispers (optional)</summary>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tips.map((t, i) => <div key={i}>✓ {t}</div>)}
              {nudge && <div style={{ color: nudge.rating === 'good' ? T.success : nudge.rating === 'weak' ? '#fca5a5' : '#fbbf24' }}>{nudge.text}</div>}
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
