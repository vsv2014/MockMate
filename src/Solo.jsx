import React, { useState, useRef, useEffect, useMemo } from 'react'
import { apiFetch } from './lib/apiClient'
import { curateModelOptions, configuredProviderNames, curateProviderFallbacks, loadModelSelection, persistModelSelection } from './lib/modelPicker'
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
import { createSessionId, createGeneration, hasEnoughAnswerLength } from './lib/sessionGen'
import { retrieveContext, warmDocs, addDoc, getSelectedDocIds } from './lib/docs'
import { buildInterviewConfig } from './lib/interviewConfig'
import Documents from './Documents'
import { extractPdfText } from './pdf'

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

// Honest listening indicator — soft pulse when active, static dim when not. No fake dancing bars.
function Waveform({ active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 34 }}>
      <span style={{
        width: active ? 10 : 8, height: active ? 10 : 8, borderRadius: '50%',
        background: active ? T.accentFrom : 'rgba(255,255,255,0.22)',
        boxShadow: active ? `0 0 0 0 ${T.accentFrom}` : 'none',
        animation: active ? 'mmpulse 1.6s ease-out infinite' : 'none',
      }} />
      <span style={{ fontSize: 12, color: active ? T.text2 : T.text3, fontWeight: active ? 600 : 400 }}>
        {active ? '● Listening' : 'Mic idle'}
      </span>
      <style>{`@keyframes mmpulse{0%{box-shadow:0 0 0 0 rgba(20,184,166,0.45)}70%{box-shadow:0 0 0 10px rgba(20,184,166,0)}100%{box-shadow:0 0 0 0 rgba(20,184,166,0)}}`}</style>
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
  const [phase, setPhase] = useState('setup')   // setup | live | evaluating | report
  const [profile, setProfile] = useState(loadProfile())
  const [interviewType, setInterviewType] = useState(() => loadProfile().interviewType || 'Technical')
  const [voiceStyle, setVoiceStyle] = useState(() => loadProfile().voiceStyle || 'Professional')
  const [followupDepth, setFollowupDepth] = useState('normal')   // Follow-ups: light|normal|deep
  const [pdfMsg, setPdfMsg] = useState('')
  const [relentless, setRelentless] = useState(false)
  const [tts, setTts] = useState(true)
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState(loadModelSelection)
  const managed = isManaged()
  const effProvider = managed ? '' : provider   // managed → let the server auto-route/failover
  const [dgAvailable, setDgAvailable] = useState(false)
  const [models, setModels] = useState([])   // dynamic per-key model list from /api/models
  const modelOptions = curateModelOptions(models)
  const providerNames = configuredProviderNames(models, providers)
  const [setupError, setSetupError] = useState('')
  // Voice = Deepgram ONLY. The browser SpeechRecognition API silently fails inside
  // Electron, which is what made the mic "not work". No Deepgram key → type your answers.

  useEffect(() => {
    apiFetch('/api/providers').then(r => r.json()).then(d => {
      const list = d.providers || []
      setProviders(list)
      setProvider(p => (!p || p.includes('::') || list.some(x => x.id === p)) ? p : '')
      setDgAvailable(!!d.deepgram)
      setSetupError('')
    }).catch(() => {
      setSetupError('Could not load AI providers — check your connection, then refresh.')
    })
    if (!managed) apiFetch('/api/models').then(r => r.json()).then(d => {
      const next = d.models || []
      setModels(next)
      const compact = curateModelOptions(next)
      setProvider(current => compact.some(m => m.id === current) ? current : '')
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { persistModelSelection(provider) }, [provider])

  const [transcript, setTranscript] = useState([])
  const [answer, setAnswer] = useState('')
  const [practiceQ, setPracticeQ] = useState('')
  const [thinking, setThinking] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [clock, setClock] = useState(0)
  const [micStarting, setMicStarting] = useState(false)
  const [autoSubmitIn, setAutoSubmitIn] = useState(0)
  const [endingEmpty, setEndingEmpty] = useState(false)
  const [ttsPlaying, setTtsPlaying] = useState(false)

  const startedAt = useRef(Date.now())
  const answerStart = useRef(null)
  const bottomRef = useRef(null)
  const transcriptRef = useRef([])
  const voiceRef = useRef(false)
  const answerRef = useRef('')
  const thinkingRef = useRef(false)
  const phaseRef = useRef('setup')
  const silenceTimer = useRef(null)
  const countdownRef = useRef(null)

  // Wave B — generation identity & locks
  const sessionIdRef = useRef(null)
  const interviewConfigRef = useRef(null)
  const sessionActiveRef = useRef(false)
  const turnGen = useRef(createGeneration('turn'))
  const ttsGen = useRef(createGeneration('tts'))
  const startLockRef = useRef(false)
  const submitLockRef = useRef(false)
  const answerSpokenRef = useRef(false)
  const ttsWatchdogRef = useRef(null)
  const endConfirmRef = useRef(false)
  const ttsBusy = useRef(false)
  const lastKind = useRef('question')
  const ttsEnabledRef = useRef(tts)

  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => { answerRef.current = answer }, [answer])
  useEffect(() => { thinkingRef.current = thinking }, [thinking])
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { ttsEnabledRef.current = tts }, [tts])

  // Unmount: invalidate all in-flight work
  useEffect(() => () => {
    sessionActiveRef.current = false
    turnGen.current.bump()
    ttsGen.current.bump()
    try { window.speechSynthesis?.cancel() } catch {}
    clearTimeout(silenceTimer.current)
    clearInterval(countdownRef.current)
    clearTimeout(ttsWatchdogRef.current)
    ttsBusy.current = false
  }, [])

  const silenceMs = 5500

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

  function cancelAutoSubmit() {
    clearTimeout(silenceTimer.current)
    clearInterval(countdownRef.current)
    setAutoSubmitIn(0)
  }

  function scheduleAutoSubmit() {
    clearTimeout(silenceTimer.current)
    clearInterval(countdownRef.current)
    setAutoSubmitIn(0)
    silenceTimer.current = setTimeout(() => {
      if (!voiceRef.current || thinkingRef.current || ttsBusy.current || phaseRef.current !== 'live') return
      if (!answerRef.current.trim()) return
      let n = 3
      setAutoSubmitIn(n)
      countdownRef.current = setInterval(() => {
        n -= 1
        if (n <= 0) {
          clearInterval(countdownRef.current)
          setAutoSubmitIn(0)
          submit()
        } else setAutoSubmitIn(n)
      }, 1000)
    }, Math.max(0, silenceMs - 3000))
  }

  const onFinalText = text => {
    if (!sessionActiveRef.current || phaseRef.current !== 'live') return
    if (ttsBusy.current || thinkingRef.current || submitLockRef.current) return
    answerSpokenRef.current = true
    if (answerStart.current == null) answerStart.current = Date.now()
    setAnswer(a => (a ? a.trim() + ' ' : '') + text)
    if (voiceRef.current) scheduleAutoSubmit()
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
    if (speech.interim && speech.interim.trim()) {
      cancelAutoSubmit()
    } else if (answerRef.current.trim()) scheduleAutoSubmit()
  }, [speech.interim]) // eslint-disable-line react-hooks/exhaustive-deps

  function resumeMicFor(ttsG) {
    if (!ttsGen.current.isCurrent(ttsG)) return
    if (!sessionActiveRef.current || phaseRef.current !== 'live') return
    if (!voiceRef.current || !canSpeak) return
    try { const r = speech.start(); if (r?.catch) r.catch(() => {}) } catch {}
  }

  function beginTts(text) {
    const g = ttsGen.current.bump()
    ttsBusy.current = true
    setTtsPlaying(true)
    // Do NOT tear down Deepgram/AudioContext here — STT is ignored while ttsBusy.
    // Full stop() after TTS was the Listening-but-silent bug (S29).
    clearTimeout(ttsWatchdogRef.current)
    ttsWatchdogRef.current = setTimeout(() => {
      if (!ttsGen.current.isCurrent(g)) return
      ttsBusy.current = false
      setTtsPlaying(false)
      resumeMicFor(g)
    }, 45000)
    speak(text, ttsEnabledRef.current, () => {
      if (!ttsGen.current.isCurrent(g)) return
      clearTimeout(ttsWatchdogRef.current)
      ttsBusy.current = false
      setTtsPlaying(false)
      resumeMicFor(g)
    }, STT_LANG[profile.language] || 'en-US')
  }

  async function startMic() {
    if (ttsBusy.current) return
    setError(''); setMicStarting(true); voiceRef.current = true
    try { await dg.start() }
    catch (e) { voiceRef.current = false; setMicStarting(false); setError('Could not start voice input. You can still type below — tap Retry voice when ready.') }
  }
  function stopMic() {
    voiceRef.current = false
    cancelAutoSubmit()
    setMicStarting(false)
    speech.stop()
  }
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
  const nudge = liveStats ? liveNudge(liveStats, { spoken: !!answerSpokenRef.current }) : null

  function saveProfile(p) { setProfile(p); persistProfile(p) }
  function patchProfile(patch) { saveProfile({ ...profile, ...patch }) }

  const hasContext = !!(String(profile.resume || '').trim().length > 40 || String(profile.jobDescription || '').trim().length > 40)
  const canStartSolo = !noProviders && hasContext

  async function requestTurn(current, attempt = 0, gen = null) {
    const turnG = attempt === 0 ? turnGen.current.bump() : gen
    const isCurrent = () => sessionActiveRef.current && phaseRef.current === 'live' && turnGen.current.isCurrent(turnG)

    if (isCurrent()) {
      setThinking(true)
      if (attempt === 0) setError('')
    } else return null

    const retryTransient = async (msg, status) => {
      if (!isCurrent()) return null
      const transient = isTransient({ status, message: msg })
      if (transient && attempt < 2) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        if (!isCurrent()) return null
        return requestTurn(current, attempt + 1, turnG)
      }
      // Hard failure — orphan rollback if last turn is a committed candidate
      if (isCurrent()) {
        const last = current[current.length - 1]
        if (last?.role === 'candidate') {
          const rolled = current.slice(0, -1)
          setTranscript(rolled)
          transcriptRef.current = rolled
          setAnswer(last.text || '')
          answerRef.current = last.text || ''
          answerSpokenRef.current = !!last.meta?.spoken
          setError((msg || `Service error (${status || '?'})`) + ' — tap Retry turn, or edit and Continue.')
        } else {
          setError(msg || `Service error (${status || '?'})`)
        }
        setThinking(false)
        startLockRef.current = false
        submitLockRef.current = false
      }
      return null
    }

    try {
      const lastAsk = [...current].reverse().find(t => t.role === 'interviewer')?.text
        || [profile.targetRole, profile.targetCompany, 'interview start'].filter(Boolean).join(' ')
      const cfg = interviewConfigRef.current
      const extraContext = await retrieveContext(lastAsk, {
        budgetMs: 1800,
        docIds: Array.isArray(cfg?.selectedDocumentIds) ? cfg.selectedDocumentIds : getSelectedDocIds(),
      }).catch(() => '')
      if (!isCurrent()) return null

      const res = await apiFetch('/api/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        timeoutMs: 60000,
        body: JSON.stringify({
          config, transcript: current, profile, provider: effProvider,
          language: profile.language || 'English',
          ...(extraContext ? { extraContext } : {}),
        })
      })
      if (!isCurrent()) return null

      let data = {}; try { data = await res.json() } catch { data = {} }
      if (!isCurrent()) return null
      if (!res.ok || data.error || !data.turn?.say) return await retryTransient(data.error, res.status)

      if (!isCurrent()) return null
      setThinking(false)
      startLockRef.current = false
      submitLockRef.current = false
      const turn = data.turn
      lastKind.current = turn.kind === 'followup' ? 'followup' : 'question'
      const next = [...current, { role: 'interviewer', text: turn.say, kind: lastKind.current, grounding: turn.grounding || null }]
      setTranscript(next)
      transcriptRef.current = next
      if (turn.questionNumber) setCurrentQuestion(turn.questionNumber)
      beginTts(turn.say)
      return turn
    } catch (e) {
      if (!isCurrent()) return null
      const aborted = e?.name === 'AbortError' || /aborted|AbortError/i.test(e?.message || '')
      return await retryTransient(
        aborted ? 'Interviewer request timed out — tap Retry turn.' : (e.message || 'Request failed'),
        aborted ? 408 : 0
      )
    }
  }

  async function start() {
    if (startLockRef.current) return
    if (!canStartSolo) {
      setError(noProviders
        ? 'Add an AI key in Settings before starting.'
        : 'Paste a resume or job description so the interviewer can ask practical questions.')
      return
    }
    startLockRef.current = true
    sessionIdRef.current = createSessionId()
    sessionActiveRef.current = true
    turnGen.current.bump()
    ttsGen.current.bump()
    endConfirmRef.current = false
    setEndingEmpty(false)
    answerSpokenRef.current = false
    submitLockRef.current = false
    cancelAutoSubmit()
    setError('')
    setTranscript([])
    transcriptRef.current = []
    setAnswer('')
    answerRef.current = ''
    setCurrentQuestion(0)
    setClock(0)

    const resume = String(profile.resume || '').trim()
    const jd = String(profile.jobDescription || '').trim()
    if (resume.length > 40) addDoc({ name: 'Resume (pasted)', type: 'resume', text: resume })
    if (jd.length > 40) addDoc({ name: 'Job Description (pasted)', type: 'jd', text: jd })
    interviewConfigRef.current = buildInterviewConfig({
      profile,
      selectedDocumentIds: getSelectedDocIds(),
      source: 'solo',
    })
    warmDocs(interviewConfigRef.current.selectedDocumentIds)

    setPhase('live')
    phaseRef.current = 'live'
    startedAt.current = Date.now()
    const result = await requestTurn([])
    if (!result) startLockRef.current = false
  }

  async function submit() {
    cancelAutoSubmit()
    if (submitLockRef.current) return
    if (!sessionActiveRef.current || phaseRef.current !== 'live') return
    if (thinkingRef.current || ttsBusy.current) return
    const text = (answerRef.current || answer).trim()
    if (!text) return
    if (!hasEnoughAnswerLength(text)) {
      setError('Say a bit more (a few sentences) so the interviewer can follow up — then Continue.')
      return
    }
    submitLockRef.current = true
    // Keep STT graph alive; thinking/ttsBusy gates ignore finals until next answer.
    const durationMs = answerStart.current ? Date.now() - answerStart.current : null
    const spoken = !!answerSpokenRef.current
    const meta = { ...analyze(text, durationMs), spoken }
    const next = [...transcriptRef.current, { role: 'candidate', text, meta }]
    setTranscript(next)
    transcriptRef.current = next
    setAnswer('')
    answerRef.current = ''
    answerStart.current = null
    answerSpokenRef.current = false
    setError('')
    await requestTurn(next)
    // requestTurn clears submitLock on success/failure; if superseded, clear here
    if (submitLockRef.current && !thinkingRef.current) submitLockRef.current = false
  }

  function undoLastAnswer() {
    if (thinkingRef.current || ttsBusy.current || ttsPlaying) return
    const cur = transcriptRef.current
    const last = cur[cur.length - 1]
    if (!last || last.role !== 'candidate') return
    turnGen.current.bump() // cancel any in-flight turn
    cancelAutoSubmit()
    const rolled = cur.slice(0, -1)
    setTranscript(rolled)
    transcriptRef.current = rolled
    setAnswer(last.text || '')
    answerRef.current = last.text || ''
    answerSpokenRef.current = !!last.meta?.spoken
    setError('')
    setThinking(false)
    submitLockRef.current = false
  }

  function retryTurn() {
    if (!sessionActiveRef.current || phaseRef.current !== 'live') return
    if (thinkingRef.current || ttsBusy.current) return
    setError('')
    requestTurn(transcriptRef.current)
  }

  function repeatQuestion() {
    if (ttsBusy.current) return
    const last = [...transcriptRef.current].reverse().find(t => t.role === 'interviewer')
    if (!last) return
    if (!ttsEnabledRef.current) {
      setError('Interviewer voice is off — enable “speaks aloud” in session options, or read the question above.')
      return
    }
    beginTts(last.text)
  }

  async function end() {
    turnGen.current.bump()
    ttsGen.current.bump()
    cancelAutoSubmit()
    clearTimeout(ttsWatchdogRef.current)
    ttsBusy.current = false
    setTtsPlaying(false)
    voiceRef.current = false
    speech.stop()
    try { window.speechSynthesis?.cancel() } catch {}
    setThinking(false)
    submitLockRef.current = false

    const hasAnswers = transcriptRef.current.some(t => t.role === 'candidate')
    if (!hasAnswers) {
      if (!endConfirmRef.current) {
        endConfirmRef.current = true
        setEndingEmpty(true)
        setError('No answers yet — click End again to leave without a report.')
        return
      }
      sessionActiveRef.current = false
      onHome()
      return
    }

    endConfirmRef.current = false
    setEndingEmpty(false)
    // Scoring: leave live so requestTurn isCurrent fails; keep sessionActive until done
    setEvaluating(true)
    setPhase('evaluating')
    phaseRef.current = 'evaluating'

    try {
      const res = await apiFetch('/api/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, transcript: transcriptRef.current, profile, provider: effProvider })
      }).then(r => r.json())
      const rep = res.report || { error: res.error || 'Evaluation failed' }
      setReport(rep)
      setPhase('report')
      phaseRef.current = 'report'
      saveSession({ report: rep, transcript: transcriptRef.current, config, profile })
    } catch (e) {
      const rep = { error: e.message || 'Evaluation failed' }
      setReport(rep)
      setPhase('report')
      phaseRef.current = 'report'
      saveSession({ report: rep, transcript: transcriptRef.current, config, profile, note: 'evaluate_error' })
    }
    sessionActiveRef.current = false
    setEvaluating(false)
  }

  function practiceAgain() {
    try { window.speechSynthesis?.cancel() } catch {}
    clearTimeout(ttsWatchdogRef.current)
    cancelAutoSubmit()
    ttsBusy.current = false
    setTtsPlaying(false)
    voiceRef.current = false
    try { speech.stop() } catch {}
    sessionActiveRef.current = false
    sessionIdRef.current = null
    turnGen.current.bump()
    ttsGen.current.bump()
    startLockRef.current = false
    submitLockRef.current = false
    answerSpokenRef.current = false
    endConfirmRef.current = false
    setEndingEmpty(false)
    setAutoSubmitIn(0)
    setThinking(false)
    setReport(null)
    setTranscript([])
    transcriptRef.current = []
    setAnswer('')
    answerRef.current = ''
    setCurrentQuestion(0)
    setClock(0)
    setError('')
    setEvaluating(false)
    setPhase('setup')
    phaseRef.current = 'setup'
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
      {setupError && <div role="alert" style={{ fontSize: 12, color: '#fca5a5' }}>⚠ {setupError}</div>}
      {error && phase === 'setup' && <div role="alert" style={{ fontSize: 12, color: '#fca5a5' }}>⚠ {error}</div>}

      <div role="status" style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: canSpeak ? 'rgba(20,184,166,0.1)' : T.surface1,
        border: `1px solid ${canSpeak ? 'rgba(20,184,166,0.35)' : T.border}`,
        borderRadius: T.rCtrl, fontSize: 13, color: T.text2,
      }}>
        <span style={{ fontWeight: 600, color: canSpeak ? '#5eead4' : T.text3 }}>
          {canSpeak ? 'Voice On' : 'Voice Off'}
        </span>
        <span style={{ color: T.text3 }}>
          {canSpeak
            ? '— answer out loud or type.'
            : '— type your replies. Add a Deepgram key in Settings for voice.'}
        </span>
      </div>

      <Section title="Your materials" hint="Resume + JD for the interviewer · optional knowledge bank for grounding.">
        <div style={{ fontSize: 11.5, color: T.text3, lineHeight: 1.45, marginBottom: 4 }}>
          Paste resume &amp; JD here (required for good questions). Extra knowledge banks go below — checked items are retrieved during the session.
        </div>
        <div>
          <Label>Resume</Label>
          <textarea rows={5} style={{ ...textInput, resize: 'vertical' }} value={profile.resume || ''} placeholder="Paste your resume text…" onChange={e => patchProfile({ resume: e.target.value })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5eead4', cursor: 'pointer', background: 'rgba(13,148,136,0.12)', border: '1px solid rgba(13,148,136,0.3)', borderRadius: 6, padding: '4px 9px' }}>
              Upload PDF
              <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                onChange={async e => {
                  const file = e.target.files?.[0]; e.target.value = ''
                  if (!file) return
                  setPdfMsg('Reading PDF…')
                  try {
                    const text = await extractPdfText(file)
                    if (text && text.length > 20) { patchProfile({ resume: text }); setPdfMsg(`Loaded ${text.length.toLocaleString()} characters`) }
                    else setPdfMsg('No text found (scanned image?) — paste instead')
                  } catch { setPdfMsg('Could not read that PDF — paste the text instead') }
                }} />
            </label>
            {pdfMsg && <span role="status" style={{ fontSize: 11, color: /No text|Could not|scanned/i.test(pdfMsg) ? '#fca5a5' : '#86efac' }}>{pdfMsg}</span>}
          </div>
        </div>
        <div>
          <Label>Job description</Label>
          <textarea rows={4} style={{ ...textInput, resize: 'vertical' }} value={profile.jobDescription || ''} placeholder="Paste the JD you’re practicing for…" onChange={e => patchProfile({ jobDescription: e.target.value })} />
        </div>
        {!hasContext && (
          <div role="status" style={{ fontSize: 12, color: '#fbbf24' }}>Add a resume or JD so questions stay practical and conversational.</div>
        )}
        <div>
          <Label>Knowledge & notes (optional)</Label>
          <Documents hideBioTypes />
        </div>
      </Section>

      <Section title="Interview">
        <div>
          <Label>Your name</Label>
          <input style={textInput} value={profile.name || ''} placeholder="How should the interviewer address you?" onChange={e => patchProfile({ name: e.target.value })} />
        </div>
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
          <Label>Follow-ups</Label>
          <Chips options={[['light', 'Light'], ['normal', 'Normal'], ['deep', 'Deep']]} value={followupDepth} onChange={setFollowupDepth} />
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
                <option value="">Automatic — recommended</option>
                {modelOptions.length > 0
                  ? modelOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)
                  : curateProviderFallbacks(providers).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <div style={{ fontSize: 10.5, color: T.text3, marginTop: 5 }}>Configured provider{providerNames.length === 1 ? '' : 's'}: {providerNames.join(', ') || 'none'}</div>
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

  // Evaluating splash (scoring — no TTS / no STT mutation)
  if (phase === 'evaluating' || evaluating) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, fontFamily: T.font, gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text1 }}>Scoring your interview…</div>
        <div style={{ fontSize: 13, color: T.text3 }}>Hang tight — building your report.</div>
      </div>
    )
  }

  // ── INTERVIEW WORKSPACE (conversation-first) ─────────────────────────────────
  const tips = TIPS_BY_TYPE[interviewType] || TIPS_BY_TYPE.Mixed
  const lastTurn = [...transcript].reverse().find(t => t.role === 'interviewer')
  const lastQuestion = lastTurn?.text
  const lastIsCandidate = transcript.length > 0 && transcript[transcript.length - 1]?.role === 'candidate'
  const beatLabel = thinking && !lastQuestion
    ? 'Opening'
    : (lastTurn?.kind === 'followup' ? 'Follow-up' : (transcript.filter(t => t.role === 'interviewer' && t.kind !== 'followup').length <= 1 ? 'Opening' : 'New topic'))
  const thinkingCopy = !transcript.length
    ? 'Waiting for the first question…'
    : 'Interviewer is preparing the next question…'
  const panel = { background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, display: 'flex', flexDirection: 'column', minHeight: 0 }
  const busyUi = thinking || ttsPlaying

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 150px)', minHeight: 460, fontFamily: T.font, gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.text1 }}>{profile.targetRole || 'Interview'}</div>
        <span style={{ fontSize: 12, color: T.text3 }}>{interviewType}{profile.targetCompany ? ` · ${profile.targetCompany}` : ''}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.accentFrom, background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 999, padding: '2px 10px' }}
          aria-label={`Question ${currentQuestion || Math.max(1, transcript.filter(t => t.role === 'interviewer').length)}`}>
          Q{currentQuestion || Math.max(1, transcript.filter(t => t.role === 'interviewer').length || 1)}
        </span>
        {speech.reconnecting && (
          <span role="status" style={{ fontSize: 11.5, color: '#fbbf24' }}>Reconnecting voice…</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: T.text2, fontVariantNumeric: 'tabular-nums' }}>⏱ {fmtClock(clock)}</span>
        <button onClick={end} disabled={evaluating}
          style={{ height: 34, padding: '0 14px', background: endingEmpty ? 'rgba(239,68,68,0.28)' : 'rgba(239,68,68,0.14)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)', borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
          {evaluating ? 'Scoring…' : endingEmpty ? 'End again to leave' : 'End interview'}
        </button>
      </div>

      {autoSubmitIn > 0 && (
        <div role="status" aria-live="assertive" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.35)', borderRadius: T.rCtrl, fontSize: 13, color: T.text1, flexShrink: 0 }}>
          <span>Sending in {autoSubmitIn}s</span>
          <button type="button" onClick={cancelAutoSubmit}
            style={{ marginLeft: 'auto', height: 28, padding: '0 12px', background: T.surface2, color: T.text1, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, cursor: 'pointer', fontSize: 12, fontFamily: T.font }}>
            Cancel
          </button>
        </div>
      )}

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(280px, 0.9fr) minmax(0, 1.4fr)', gap: 12, minHeight: 0 }}>
        {/* Quiet history */}
        <div style={panel}>
          <div style={{ padding: '11px 14px', borderBottom: `1px solid ${T.border}`, fontSize: 12, fontWeight: 600, color: T.text2 }}>Conversation</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {transcript.length > 48 && (
              <div style={{ fontSize: 11, color: T.text3 }}>Showing latest 48 turns · full transcript kept for scoring</div>
            )}
            {transcript.slice(-48).map((t, i) => (
              <div key={`${transcript.length}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', color: t.role === 'interviewer' ? T.accentFrom : T.text3 }}>
                  {t.role === 'interviewer' ? (t.kind === 'followup' ? 'FOLLOW-UP' : 'INTERVIEWER') : 'YOU'}
                </span>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: t.role === 'interviewer' ? T.text1 : T.text2 }}>{t.text}</div>
                {t.grounding && <div style={{ fontSize: 10.5, color: T.text3 }}>About: {t.grounding}</div>}
              </div>
            ))}
            {thinking && <div style={{ fontSize: 12, color: T.text3, fontStyle: 'italic' }}>{thinkingCopy}</div>}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Center stage */}
        <div style={{ ...panel, background: 'transparent', border: 'none', gap: 12 }}>
          <div style={{ ...panel, flex: 1, padding: '18px 20px', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: T.text3 }}>
                Q{currentQuestion || Math.max(1, transcript.filter(t => t.role === 'interviewer').length || 1)} · {beatLabel.toUpperCase()}
              </div>
              <div style={{ fontSize: 20, fontWeight: 500, color: T.text1, lineHeight: 1.4, marginTop: 12 }}>
                {thinking && !lastQuestion ? 'Waiting for the first question…' : (lastQuestion || '…')}
              </div>
              {lastTurn?.grounding && (
                <div style={{ marginTop: 10, display: 'inline-block', fontSize: 11, color: '#5eead4', background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 999, padding: '3px 10px' }}>
                  About: {lastTurn.grounding}
                </div>
              )}
            </div>
            <div style={{ marginTop: 16 }}>
              <Waveform active={speech.active && !ttsPlaying} />
              <div role="status" aria-live="polite" style={{ textAlign: 'center', fontSize: 11.5, color: T.text3, marginTop: 6 }}>
                {ttsPlaying ? 'Interviewer speaking…'
                  : micStarting ? 'Starting mic…'
                  : speech.reconnecting ? 'Reconnecting…'
                  : speech.active ? 'Listening — pause ~5s when done, or tap Continue'
                  : canSpeak ? 'Tap the mic to speak, or type below'
                  : 'Type your reply below'}
              </div>
            </div>
          </div>

          <form
            onSubmit={e => {
              e.preventDefault()
              const q = practiceQ.trim()
              if (!q || busyUi) return
              setPracticeQ('')
              cancelAutoSubmit()
              setTranscript(t => [...t, { role: 'interviewer', text: q, kind: 'question', ts: Date.now() }])
              setAnswer('')
              endConfirmRef.current = false
              setEndingEmpty(false)
            }}
            style={{ display: 'flex', gap: 8, flexShrink: 0 }}
          >
            <input
              type="text"
              value={practiceQ}
              onChange={e => setPracticeQ(e.target.value)}
              placeholder="Type a question to practice · Enter"
              disabled={busyUi}
              aria-label="Type a practice question"
              style={{ ...textInput, flex: 1, height: 40 }}
            />
            <button type="submit" disabled={!practiceQ.trim() || busyUi}
              style={{ height: 40, padding: '0 14px', flexShrink: 0, background: practiceQ.trim() && !busyUi ? T.accent : T.surface2, color: practiceQ.trim() && !busyUi ? '#fff' : T.text3, border: 'none', borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 600, cursor: practiceQ.trim() && !busyUi ? 'pointer' : 'default', fontFamily: T.font }}>
              Ask
            </button>
          </form>

          <textarea rows={3} style={{ ...textInput, resize: 'none', flexShrink: 0 }}
            placeholder={speech.active ? 'Listening…' : canSpeak ? 'Type your answer · Enter to submit' : 'Type your answer · Enter to submit'}
            value={answer}
            onChange={e => { setAnswer(e.target.value); if (endingEmpty) { endConfirmRef.current = false; setEndingEmpty(false) } }}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }} />
          {speech.interim && <div style={{ fontSize: 12, color: T.text3, fontStyle: 'italic', flexShrink: 0, marginTop: -4 }}>{speech.interim}…</div>}

          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            {canSpeak && (
              <button type="button" onClick={() => speech.active ? stopMic() : startMic()} disabled={micStarting || ttsPlaying}
                style={{ height: 42, width: 46, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: T.rCtrl, cursor: 'pointer', fontSize: 16,
                  background: speech.active ? 'rgba(239,68,68,0.16)' : T.surface2, color: speech.active ? '#f87171' : T.text1, border: `1px solid ${speech.active ? 'rgba(239,68,68,0.4)' : T.border}` }}
                aria-label={speech.active ? 'Stop listening' : (voiceRef.current === false && error ? 'Retry voice' : 'Start speaking')}
                title={speech.active ? 'Stop listening' : (voiceRef.current === false && error ? 'Retry voice' : 'Speak')}>{speech.active ? '⏹' : '🎤'}</button>
            )}
            <button type="button" onClick={repeatQuestion} disabled={!lastQuestion || ttsPlaying || thinking}
              style={{ height: 42, padding: '0 14px', flexShrink: 0, background: T.surface2, color: T.text2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, cursor: 'pointer', fontSize: 12.5, fontFamily: T.font }}
              aria-label="Repeat question" title="Hear again">🔁 Repeat</button>
            {lastIsCandidate && !busyUi && (
              <button type="button" onClick={undoLastAnswer}
                style={{ height: 42, padding: '0 14px', flexShrink: 0, background: T.surface2, color: T.text2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, cursor: 'pointer', fontSize: 12.5, fontFamily: T.font }}
                aria-label="Undo last answer" title="Undo last answer">↩ Undo</button>
            )}
            <button type="button" onClick={submit} disabled={!answer.trim() || busyUi}
              style={{ flex: 1, height: 42, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 14, fontWeight: 600, cursor: (!answer.trim() || busyUi) ? 'default' : 'pointer', opacity: (!answer.trim() || busyUi) ? 0.5 : 1, fontFamily: T.font }}
              aria-label="Continue to next turn">Continue</button>
          </div>
          {busyUi && (
            <div role="status" style={{ fontSize: 11.5, color: T.text3, flexShrink: 0 }}>
              {ttsPlaying ? 'Wait for the interviewer to finish speaking — then Continue unlocks.' : 'Interviewer is thinking…'}
            </div>
          )}
          {error && (
            <div role="alert" style={{ fontSize: 12, color: '#fca5a5', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>⚠ {error}</span>
              {!thinking && !ttsPlaying && /Retry turn|Service error|tap Retry/i.test(error) && (
                <button onClick={retryTurn} style={{ background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.4)', color: '#5eead4', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Retry turn</button>
              )}
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
