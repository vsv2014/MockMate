import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useSystemAudio } from './useSystemAudio'
import Report from './Report'
import { OverlayPanel, ScreenAnalysisPanel } from './App'

const PROFILE_KEY = 'peerMockProfile'
function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {} } catch { return {} } }
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch {} }
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function looksLikeQuestion(text) {
  const t = text.trim().toLowerCase()
  const words = t.split(/\s+/).length
  if (words < 4) return false
  if (t.endsWith('?')) return true
  return /\b(tell me|describe|explain|how would|how do|what is|what are|what was|what were|walk me|can you|why did|why do|why would|have you|give me|talk about|could you|when did|where did|design|implement|write a|what's your|difference between|how does|what do you)\b/.test(t)
}

function getBuyTimePhrase(text) {
  const t = text.toLowerCase()
  if (/tell me about a time|give me an example|describe a situation/.test(t)) return "Yeah so, let me think of a good one…"
  if (/tell me about|walk me through|describe yourself/.test(t)) return "Yeah so, in my case…"
  if (/how would you|how do you|design|build|architect|scale/.test(t)) return "At a high level, what I'd do is…"
  if (/why did you|why do you|why would/.test(t)) return "Honestly, the main reason was…"
  if (/what is|explain|what are|define/.test(t)) return "Basically…"
  if (/strength|weakness|challenge|difficult/.test(t)) return "Let me think… yeah, I'd say…"
  if (/follow up|elaborate|tell me more/.test(t)) return "Yeah, to add to that…"
  return "Let me think for a sec…"
}

function stopSpeaking() { window.speechSynthesis?.cancel() }
function speakText(text) {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.rate = 0.92
  const voices = window.speechSynthesis.getVoices()
  const preferred = voices.find(v => /google us english|samantha|daniel|karen/i.test(v.name))
  if (preferred) utt.voice = preferred
  window.speechSynthesis.speak(utt)
}

const TYPE_LABEL = {
  behavioral: '🧩 Behavioral', technical: '⚙️ Technical',
  system_design: '🏗️ System Design', resume: '📄 Resume',
  culture: '🤝 Culture', dsa: '⚡ DSA', coding: '💻 Coding', other: '💬 General'
}
const WORD_DELAY = 55

// ── Setup screen ──────────────────────────────────────────────────────────────
function SetupScreen({ onStart, onHome, panelSize, stealth, onStealth, onMinimize, onResize, onDrag }) {
  const [profile, setProfile] = useState(loadProfile)
  const [audioSources, setAudioSources] = useState([])
  const [sourceId, setSourceId] = useState('microphone')
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState(() => { try { return localStorage.getItem('llmProvider') || '' } catch { return '' } })
  const [dgAvailable, setDgAvailable] = useState(false)

  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(d => {
      const list = d.providers || []
      setProviders(list)
      setProvider(p => (p && list.some(x => x.id === p)) ? p : (list[0]?.id || ''))
      setDgAvailable(!!d.deepgram)
    }).catch(() => {})
    window.electronAPI?.getAudioSources?.().then(srcs => {
      setAudioSources(srcs || [])
      // Auto-select system audio (screen source) as default — best for capturing interviewer
      const screen = (srcs || []).find(s => /screen|entire|display/i.test(s.name))
      if (screen) setSourceId(screen.id)
    })
    // Default to system audio automatically — no user decision needed
  }, [])

  useEffect(() => { if (provider) { try { localStorage.setItem('llmProvider', provider) } catch {} } }, [provider])

  function patch(p) { const next = { ...profile, ...p }; setProfile(next); saveProfile(next) }

  const inp = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', padding: '6px 10px', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }

  return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} onStealth={onStealth}
      onMinimize={onMinimize} onResize={onResize} onDrag={onDrag} onClose={onHome} title="Live Companion — Setup">
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {!dgAvailable && (
          <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#fca5a5' }}>
            ⚠ Add <code>DEEPGRAM_API_KEY</code> to <code>.env</code> and restart
          </div>
        )}

        <Field label="Your name"><input style={inp} value={profile.name || ''} placeholder="e.g. Charan" onChange={e => patch({ name: e.target.value })} /></Field>
        <Field label="Target role"><input style={inp} value={profile.targetRole || ''} placeholder="e.g. Senior AI Engineer" onChange={e => patch({ targetRole: e.target.value })} /></Field>
        <Field label="Resume (optional — answers reference your projects)">
          <textarea rows={4} style={{ ...inp, resize: 'vertical' }} value={profile.resume || ''} placeholder="Paste resume text…" onChange={e => patch({ resume: e.target.value })} />
        </Field>
        <Field label="Audio capture mode">
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { id: audioSources.find(s => /screen|entire|display/i.test(s.name))?.id || 'microphone', label: '🖥️ System Audio', desc: 'Captures interviewer\'s voice from Zoom/Teams/Meet (recommended)' },
              { id: 'microphone', label: '🎤 Microphone', desc: 'Use if system audio doesn\'t work on your setup' }
            ].map(opt => (
              <button key={opt.id} onClick={() => setSourceId(opt.id)}
                style={{ flex: 1, padding: '8px', background: sourceId === opt.id ? 'rgba(109,40,217,0.3)' : 'rgba(255,255,255,0.04)', border: `1px solid ${sourceId === opt.id ? 'rgba(109,40,217,0.5)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 6, color: sourceId === opt.id ? '#c4b5fd' : '#64748b', cursor: 'pointer', fontSize: 12, textAlign: 'left' }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{opt.label}</div>
                <div style={{ fontSize: 10, opacity: 0.7, lineHeight: 1.3 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </Field>
        {providers.length > 0 && (
          <Field label="AI model">
            <select style={inp} value={provider} onChange={e => setProvider(e.target.value)}>
              {providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
        )}

        <button disabled={!dgAvailable} onClick={() => onStart({ profile, sourceId, provider })}
          style={{ marginTop: 4, padding: '8px', background: dgAvailable ? '#6d28d9' : '#1e1b4b', color: dgAvailable ? '#fff' : '#475569', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: dgAvailable ? 'pointer' : 'default' }}>
          Start listening →
        </button>
      </div>
    </OverlayPanel>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>{label.toUpperCase()}</div>
      {children}
    </div>
  )
}

// ── Live overlay ──────────────────────────────────────────────────────────────
function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, panelSize, stealth, onStealth, onMinimize, onResize, onDrag, screenAnalysis, screenAnalyzing, onDismissScreen }) {
  const [transcript, setTranscript] = useState([])
  const [conversationHistory, setConversationHistory] = useState([])
  const [hint, setHint] = useState(null)
  const [hintLoading, setHintLoading] = useState(false)
  const [buyTimePhrase, setBuyTimePhrase] = useState('')
  const [answerMode, setAnswerMode] = useState('speak')
  const [streamedAnswer, setStreamedAnswer] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [clock, setClock] = useState(0)
  const [error, setError] = useState('')

  const lastHintText = useRef('')
  const pendingQuestion = useRef('')
  const answerModeRef = useRef(answerMode)
  const profileRef = useRef(profile)
  const providerRef = useRef(initialProvider)
  const conversationHistoryRef = useRef([])
  const startedAt = useRef(Date.now())
  const streamTimer = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => { answerModeRef.current = answerMode }, [answerMode])
  useEffect(() => { conversationHistoryRef.current = conversationHistory }, [conversationHistory])

  useEffect(() => {
    window.electronAPI?.setRoomActive(true)
    return () => {
      window.electronAPI?.setRoomActive(false)
      clearInterval(streamTimer.current)
      stopSpeaking()
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now() - startedAt.current), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, streamedAnswer])

  // Hint generation
  async function generateHint(question) {
    if (!question || question === lastHintText.current) return
    lastHintText.current = question
    setBuyTimePhrase(getBuyTimePhrase(question))
    setHintLoading(true)
    setHint(null)
    setStreamedAnswer('')
    setStreaming(false)
    clearInterval(streamTimer.current)
    window.electronAPI?.sendHint({ hint: null, hintLoading: true, question })
    try {
      const d = await fetch('/api/hint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, profile: profileRef.current, conversationHistory: conversationHistoryRef.current.slice(-6), provider: providerRef.current })
      }).then(r => r.json())
      const h = d.hint || d || null
      setHint(h)
      setHintLoading(false)
      window.electronAPI?.sendHint({ hint: h, hintLoading: false, question })
      // Stream words
      if (h?.fullAnswer || h?.sampleAnswer) {
        const words = (h.fullAnswer || h.sampleAnswer).split(' ')
        let i = 0
        setStreaming(true)
        streamTimer.current = setInterval(() => {
          i++
          setStreamedAnswer(words.slice(0, i).join(' '))
          if (i >= words.length) { clearInterval(streamTimer.current); setStreaming(false) }
        }, WORD_DELAY)
      }
    } catch (e) { setHintLoading(false); setError(e.message) }
  }

  const onEarlyQuestion = useCallback(text => {
    const trimmed = text.trim()
    if (!trimmed || !looksLikeQuestion(trimmed)) return
    pendingQuestion.current = trimmed
    generateHint(trimmed)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onFinal = useCallback(text => {
    const trimmed = text.trim()
    const words = trimmed.split(/\s+/).length
    if (!trimmed || words < 3) return
    const shouldHint = looksLikeQuestion(trimmed) || words >= 7
    setTranscript(t => [...t, { text: trimmed, ts: Date.now(), isQuestion: shouldHint }])
    if (shouldHint) setConversationHistory(h => [...h, { role: 'interviewer', text: trimmed }])
    if (shouldHint && trimmed !== lastHintText.current) generateHint(trimmed)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const audio = useSystemAudio(onFinal, reason => setError(`Transcription stopped: ${reason}`), onEarlyQuestion)

  useEffect(() => { audio.start(sourceId) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function endSession() {
    audio.stop(); stopSpeaking()
    window.electronAPI?.setRoomActive(false)
    onEnd()
  }

  const currentQuestion = [...transcript].reverse().find(s => s.isQuestion)?.text || ''
  const badge = (bg, color) => ({ fontSize: 9, padding: '1px 7px', background: bg, color, borderRadius: 10, fontWeight: 700, whiteSpace: 'nowrap' })
  const btn = (bg, color) => ({ fontSize: 10, padding: '2px 9px', background: bg, color, border: 'none', borderRadius: 4, cursor: 'pointer' })

  const titleExtra = (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: audio.active ? '#22c55e' : '#ef4444', boxShadow: audio.active ? '0 0 4px #22c55e' : 'none' }} />
      <span style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace' }}>{fmtClock(clock)}</span>
      <button onClick={() => { setAnswerMode(m => m === 'speak' ? 'hints' : 'speak'); stopSpeaking() }}
        style={btn(answerMode === 'speak' ? '#6d28d9' : '#1e3a5f', '#fff')}>
        {answerMode === 'speak' ? '📝' : '💡'}
      </button>
    </div>
  )

  return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} onStealth={onStealth}
      onMinimize={onMinimize} onResize={onResize} onDrag={onDrag}
      onClose={endSession} title="Live" extra={titleExtra}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

            {error && <div style={{ background: '#450a0a', borderRadius: 6, padding: '5px 10px', fontSize: 11, color: '#fca5a5' }}>⚠ {error} <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button></div>}

            {/* Screen analysis — shown when Ctrl+Shift+U is pressed */}
            <ScreenAnalysisPanel analysis={screenAnalysis} analyzing={screenAnalyzing} onDismiss={onDismissScreen} />

            {/* Question */}
            {currentQuestion
              ? <div style={{ background: 'rgba(109,40,217,0.15)', border: '1px solid rgba(109,40,217,0.3)', borderRadius: 8, padding: '7px 10px' }}>
                  <div style={{ fontSize: 9, color: '#7c3aed', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 3 }}>QUESTION</div>
                  <div style={{ fontSize: 13, color: '#c4b5fd', lineHeight: 1.5 }}>{currentQuestion}</div>
                </div>
              : <div style={{ fontSize: 12, color: '#1e2030', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: audio.active ? '#22c55e' : '#334155', animation: audio.active ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
                  <span style={{ color: audio.active ? '#334155' : '#1e2030' }}>{audio.active ? 'Listening…' : 'Not capturing'}</span>
                  {audio.interim && <span style={{ fontStyle: 'italic', color: '#1e293b', fontSize: 11 }}>{audio.interim}</span>}
                </div>
            }

            {/* Loading */}
            {hintLoading && (
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 5 }}>SAY THIS NOW</div>
                <div style={{ fontSize: 14, color: '#c4b5fd', fontStyle: 'italic', marginBottom: 8 }}>"{buyTimePhrase}"</div>
                <div style={{ height: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '35%', background: 'linear-gradient(90deg,#6d28d9,#3b82f6)', animation: 'slide 1.2s ease-in-out infinite' }} />
                </div>
              </div>
            )}

            {/* Answer */}
            {!hintLoading && hint && (
              <div style={{ background: hint.confidence === 'resume' ? 'rgba(5,46,22,0.6)' : 'rgba(255,255,255,0.04)', border: `1px solid ${hint.confidence === 'resume' ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 8, padding: '12px', flex: 1 }}>
                {/* badges + controls */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                  {hint.confidence === 'resume'
                    ? <span style={badge('#14532d', '#4ade80')}>🟢 YOUR RESUME</span>
                    : <span style={badge('#431407', '#fb923c')}>🟡 GENERAL</span>}
                  {hint.questionType && <span style={badge('rgba(109,40,217,0.3)', '#a5b4fc')}>{TYPE_LABEL[hint.questionType] || hint.questionType}</span>}
                  {hint.pattern && <span style={badge('rgba(49,46,129,0.5)', '#c7d2fe')}>⚡ {hint.pattern}</span>}
                  {hint.complexity && <span style={{ ...badge('rgba(28,25,23,0.8)', '#a8a29e'), fontFamily: 'monospace' }}>{hint.complexity}</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                    <button onClick={() => speakText(hint.fullAnswer || hint.sampleAnswer)} style={btn(hint.confidence === 'resume' ? '#166534' : 'rgba(255,255,255,0.08)', hint.confidence === 'resume' ? '#86efac' : '#94a3b8')}>▶</button>
                    <button onClick={() => navigator.clipboard?.writeText(hint.fullAnswer || hint.sampleAnswer || '')} style={btn('rgba(255,255,255,0.05)', '#64748b')}>📋</button>
                    <button onClick={stopSpeaking} style={btn('rgba(255,255,255,0.05)', '#475569')}>⏹</button>
                  </div>
                </div>

                {hint.resumeStory && (
                  <div style={{ borderLeft: '2px solid #4ade80', paddingLeft: 8, fontSize: 11, color: '#86efac', marginBottom: 10, fontStyle: 'italic', lineHeight: 1.4 }}>
                    {hint.resumeStory}
                  </div>
                )}

                {answerMode === 'speak'
                  ? <div style={{ fontSize: 14, color: hint.confidence === 'resume' ? '#dcfce7' : '#e2e8f0', lineHeight: 1.75 }}>
                      {streamedAnswer || hint.fullAnswer || hint.sampleAnswer}
                      {streaming && <span style={{ display: 'inline-block', width: 2, height: '0.9em', background: hint.confidence === 'resume' ? '#4ade80' : '#6d28d9', marginLeft: 2, verticalAlign: 'text-bottom', animation: 'blink 0.7s step-end infinite' }} />}
                    </div>
                  : <div style={{ fontSize: 13 }}>
                      {hint.opener && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 9, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 3 }}>OPENER</div><div style={{ color: '#c4b5fd', fontStyle: 'italic' }}>"{hint.opener}"</div></div>}
                      <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>KEY POINTS</div>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {(hint.keyPoints || []).map((p, i) => <li key={i} style={{ marginBottom: 3, color: '#cbd5e1' }}>{p}</li>)}
                      </ul>
                    </div>
                }

                {hint.watchOut && (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: '#f59e0b' }}>
                    ⚠ {hint.watchOut}
                  </div>
                )}
              </div>
            )}

            {!hint && !hintLoading && (
              <div style={{ fontSize: 11, color: '#1e293b', textAlign: 'center', padding: '8px 0' }}>
                {audio.active ? 'Waiting for a question…' : ''}
              </div>
            )}

            {/* Recent */}
            {transcript.length > 0 && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8 }}>
                {transcript.slice(-3).map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 3, opacity: s.isQuestion ? 1 : 0.35 }}>
                    <span style={{ fontSize: 9, color: s.isQuestion ? '#6d28d9' : '#1e293b', flexShrink: 0, marginTop: 2 }}>{s.isQuestion ? '❓' : '🎤'}</span>
                    <span style={{ fontSize: 11, color: s.isQuestion ? '#a5b4fc' : '#334155', flex: 1, lineHeight: 1.4 }}>{s.text}</span>
                    {!s.isQuestion && (
                      <button onClick={() => generateHint(s.text)} style={{ fontSize: 9, padding: '1px 6px', background: 'rgba(49,46,129,0.4)', color: '#818cf8', border: 'none', borderRadius: 3, cursor: 'pointer', flexShrink: 0 }}>hint</button>
                    )}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
    </OverlayPanel>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function LiveCompanion({ onHome, panelSize, stealth, onStealth, onMinimize, onResize, onDrag, screenAnalysis, screenAnalyzing, onDismissScreen }) {
  const [phase, setPhase] = useState('setup')
  const [sessionConfig, setSessionConfig] = useState(null)

  if (phase === 'setup') return (
    <SetupScreen
      onStart={config => { setSessionConfig(config); setPhase('live') }}
      onHome={onHome}
      panelSize={panelSize} stealth={stealth}
      onStealth={onStealth} onMinimize={onMinimize}
      onResize={onResize} onDrag={onDrag}
    />
  )

  return (
    <LiveOverlay
      {...sessionConfig}
      panelSize={panelSize} stealth={stealth}
      onStealth={onStealth} onMinimize={onMinimize}
      onResize={onResize} onDrag={onDrag}
      onEnd={onHome}
      screenAnalysis={screenAnalysis} screenAnalyzing={screenAnalyzing} onDismissScreen={onDismissScreen}
    />
  )
}
