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


const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Portuguese',
  'Hindi', 'Japanese', 'Chinese', 'Korean', 'Arabic', 'Italian', 'Dutch'
]

const BUY_TIME_BY_LANG = {
  Spanish: "Déjame pensar un momento…",
  French: "Laissez-moi réfléchir…",
  German: "Lass mich kurz nachdenken…",
  Portuguese: "Deixa eu pensar um segundo…",
  Hindi: "एक पल सोचने दो…",
  Japanese: "少し考えさせてください…",
  Chinese: "让我想一想…",
  Korean: "잠깐 생각해볼게요…",
  Arabic: "دعني أفكر للحظة…",
  Italian: "Lasciami pensare un momento…",
  Dutch: "Laat me even nadenken…"
}

function getBuyTimePhrase(text, language = 'English') {
  const t = text.toLowerCase()
  if (/tell me about a time|give me an example|describe a situation/.test(t)) return "Yeah so, let me think of a good one…"
  if (/tell me about|walk me through|describe yourself/.test(t)) return "Yeah so, in my case…"
  if (/how would you|how do you|design|build|architect|scale/.test(t)) return "At a high level, what I'd do is…"
  if (/why did you|why do you|why would/.test(t)) return "Honestly, the main reason was…"
  if (/what is|explain|what are|define/.test(t)) return "Basically…"
  if (/strength|weakness|challenge|difficult/.test(t)) return "Let me think… yeah, I'd say…"
  if (/follow up|elaborate|tell me more/.test(t)) return "Yeah, to add to that…"
  if (/what do you know|tell me about|why (google|meta|apple|amazon|microsoft|kore|our company)/.test(t)) return "Yeah, so from what I know…"
  if (language !== 'English' && BUY_TIME_BY_LANG[language]) return BUY_TIME_BY_LANG[language]
  return "Let me think for a sec…"
}

// Simple markdown → JSX: bold, bullets, section headers
function renderMd(text) {
  if (!text) return null
  return text.split('\n').map((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return <div key={i} style={{ height: 6 }} />
    // Bullet point
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      return (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3, alignItems: 'flex-start' }}>
          <span style={{ color: '#6d28d9', flexShrink: 0, marginTop: 2, fontSize: 10 }}>▸</span>
          <span>{inlineMd(trimmed.slice(2))}</span>
        </div>
      )
    }
    // Section header (e.g. **Situation:** or **Action:**)
    if (/^\*\*[^*]+:\*\*/.test(trimmed)) {
      return <div key={i} style={{ fontWeight: 700, color: '#a78bfa', fontSize: 11, letterSpacing: '0.04em', marginTop: 8, marginBottom: 3 }}>{inlineMd(trimmed)}</div>
    }
    return <div key={i} style={{ marginBottom: 4 }}>{inlineMd(trimmed)}</div>
  })
}

function inlineMd(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} style={{ color: '#e2e8f0', fontWeight: 700 }}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )
}

function stopSpeaking() { window.speechSynthesis?.cancel() }

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// Self-contained HTML for the Document PiP window — receives state via BroadcastChannel.
// Chrome marks PiP windows with WDA_EXCLUDEFROMCAPTURE (Windows) and NSWindow.sharingType=.none (macOS)
// making them invisible to Zoom, Teams, Meet, and all screen capture tools.
function getPipHTML() {
  return `
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#08090e;color:#e2e8f0;font-family:system-ui,sans-serif;padding:12px;font-size:13px}
.badge{font-size:9px;padding:1px 7px;border-radius:10px;font-weight:700;display:inline-block;margin-right:3px}
.q{background:rgba(255,255,255,0.05);border-radius:0 8px 8px 8px;padding:7px 10px;margin-bottom:6px;font-size:12px;color:#cbd5e1;line-height:1.5}
.a{padding:10px 12px;border-radius:8px;line-height:1.75;font-size:13px;margin-left:10px}
.a-resume{background:rgba(5,46,22,0.6);border:1px solid rgba(34,197,94,0.2)}
.a-general{background:rgba(109,40,217,0.1);border:1px solid rgba(109,40,217,0.2)}
.watch{font-size:10px;color:#f59e0b;margin-top:6px;margin-left:10px}
.loading{background:rgba(255,255,255,0.04);border-radius:7px;padding:8px 10px;border:1px solid rgba(255,255,255,0.05);margin-left:10px}
.progress{height:2px;background:rgba(255,255,255,0.04);border-radius:2px;overflow:hidden;margin-top:6px}
.bar{height:100%;width:40%;background:linear-gradient(90deg,#6d28d9,#3b82f6);animation:slide 1.2s ease-in-out infinite}
.empty{text-align:center;padding:30px 0;color:#334155;font-size:11px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.dot-green{background:#22c55e;box-shadow:0 0 6px #22c55e}
.dot-red{background:#ef4444}
.prot{font-size:9px;color:#334155;text-align:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);margin-bottom:8px}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.cursor{display:inline-block;width:2px;height:.9em;background:#6d28d9;margin-left:2px;vertical-align:text-bottom;animation:blink .7s step-end infinite}
</style>
<div class="prot">🛡️ Protected — excluded from all screen capture</div>
<div id="root"></div>
<script>
const bc = new BroadcastChannel('mockmate-live')
const TYPE_LABEL = {behavioral:'🧩 Behavioral',technical:'⚙️ Technical',system_design:'🏗️ System Design',resume:'📄 Resume',culture:'🤝 Culture',dsa:'⚡ DSA',coding:'💻 Coding',other:'💬 General'}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

function md(text){
  if(!text)return ''
  return text.split('\\n').map(line=>{
    const t=line.trim()
    if(!t)return '<div style="height:6px"></div>'
    if(t.startsWith('- ')||t.startsWith('• '))return '<div style="display:flex;gap:6px;margin-bottom:3px"><span style="color:#6d28d9;font-size:10px;margin-top:2px">▸</span><span>'+inlineMd(t.slice(2))+'</span></div>'
    if(/^\\*\\*[^*]+:\\*\\*/.test(t))return '<div style="font-weight:700;color:#a78bfa;font-size:11px;letter-spacing:.04em;margin-top:8px;margin-bottom:3px">'+inlineMd(t)+'</div>'
    return '<div style="margin-bottom:4px">'+inlineMd(t)+'</div>'
  }).join('')
}

function inlineMd(text){
  return text.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong style="color:#e2e8f0;font-weight:700">$1</strong>')
}

function render(state){
  const root=document.getElementById('root')
  if(!root)return
  let html=''
  const questions=(state.transcript||[]).filter(s=>s.isQuestion)

  if(questions.length===0&&!state.hintLoading){
    html='<div class="empty"><span class="dot '+(state.active?'dot-green':'dot-red')+'"></span>'+(state.active?'Listening…':'Not capturing')+'</div>'
  }

  questions.forEach(s=>{
    html+='<div style="margin-bottom:14px">'
    html+='<div class="q">❓ '+esc(s.text)+'</div>'
    if(s.answer!==undefined&&s.hint){
      const h=s.hint
      html+='<div style="margin-left:10px">'
      html+='<div style="margin-bottom:5px">'
      if(h.confidence==='resume')html+='<span class="badge" style="background:#14532d;color:#4ade80">🟢 RESUME</span>'
      else html+='<span class="badge" style="background:#431407;color:#fb923c">🟡 GENERAL</span>'
      if(h.questionType)html+='<span class="badge" style="background:rgba(109,40,217,.3);color:#a5b4fc">'+esc(TYPE_LABEL[h.questionType]||h.questionType)+'</span>'
      if(h.pattern)html+='<span class="badge" style="background:rgba(49,46,129,.5);color:#c7d2fe">⚡ '+esc(h.pattern)+'</span>'
      html+='</div>'
      if(h.resumeStory)html+='<div style="border-left:2px solid #4ade80;padding-left:7px;font-size:10px;color:#86efac;margin-bottom:6px;font-style:italic">'+esc(h.resumeStory)+'</div>'
      html+='<div class="a '+(h.confidence==='resume'?'a-resume':'a-general')+'">'+md(s.answer||'…')+'</div>'
      if(h.watchOut)html+='<div class="watch">⚠ '+esc(h.watchOut)+'</div>'
      html+='</div>'
    }
    html+='</div>'
  })

  if(state.hintLoading){
    html+='<div style="margin-bottom:14px">'
    html+='<div class="q" style="color:#94a3b8;font-style:italic">❓ '+esc(state.lastQ||'')+'</div>'
    html+='<div class="loading"><div style="font-size:10px;color:#475569;margin-bottom:4px">Say: <em style="color:#c4b5fd">"'+esc(state.buyTimePhrase||'')+'"</em></div><div class="progress"><div class="bar"></div></div></div>'
    html+='</div>'
  }

  root.innerHTML=html
}

bc.onmessage=e=>{
  if(e.data.type==='update'||e.data.type==='init')render(e.data)
}
window.addEventListener('pagehide',()=>bc.close())
</script>`
}
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
          <textarea rows={3} style={{ ...inp, resize: 'vertical' }} value={profile.resume || ''} placeholder="Paste resume text…" onChange={e => patch({ resume: e.target.value })} />
        </Field>
        <Field label="Job description (optional — sharpens answers to this role)">
          <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={profile.jobDescription || ''} placeholder="Paste job description…" onChange={e => patch({ jobDescription: e.target.value })} />
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

        <Field label="Interview language">
          <select style={inp} value={profile.language || 'English'} onChange={e => patch({ language: e.target.value })}>
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>

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
function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, panelSize, stealth, onStealth, onMinimize, onResize, onDrag, screenAnalysis, screenAnalyzing, onDismissScreen, pip: initialPip }) {
  const [transcript, setTranscript] = useState([])
  const [conversationHistory, setConversationHistory] = useState([])
  const [hint, setHint] = useState(null)
  const [hintLoading, setHintLoading] = useState(false)
  const [buyTimePhrase, setBuyTimePhrase] = useState('')
  const [answerMode, setAnswerMode] = useState('speak')
  const [pipWindow, setPipWindow] = useState(initialPip || null)
  const pipSupported = typeof window !== 'undefined' && !!window.documentPictureInPicture
  const bcRef = useRef(null)   // BroadcastChannel to sync state to PiP window
  const [streamedAnswer, setStreamedAnswer] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [clock, setClock] = useState(0)
  const [error, setError] = useState('')
  const [extraContext, setExtraContext] = useState('')
  const [contextOpen, setContextOpen] = useState(false)
  const extraContextRef = useRef('')

  const lastHintText = useRef('')
  const hintInFlight = useRef(false)  // prevent double API calls
  const profileRef = useRef(profile)
  const providerRef = useRef(initialProvider)
  const conversationHistoryRef = useRef([])
  const startedAt = useRef(Date.now())
  const streamTimer = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => { conversationHistoryRef.current = conversationHistory }, [conversationHistory])
  useEffect(() => { extraContextRef.current = extraContext }, [extraContext])

  useEffect(() => {
    bcRef.current = new BroadcastChannel('mockmate-live')
    return () => {
      bcRef.current?.close()
      try { pipWindow?.close() } catch {}
      clearInterval(streamTimer.current)
      stopSpeaking()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function openProtectedPip() {
    if (!window.documentPictureInPicture) return
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 440, height: 620 })
      pip.document.title = 'MockMate — Protected'
      pip.document.body.style.cssText = 'margin:0;padding:0;background:#08090e;font-family:system-ui,sans-serif;color:#e2e8f0;overflow-y:auto;'
      pip.document.body.innerHTML = getPipHTML()
      pip.addEventListener('pagehide', () => setPipWindow(null))
      setPipWindow(pip)
      // Sync current state immediately
      bcRef.current?.postMessage({ type: 'init', transcript, hint, hintLoading, buyTimePhrase })
    } catch (e) { console.warn('PiP failed:', e.message) }
  }

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now() - startedAt.current), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, streamedAnswer])

  // Sync all state to PiP window whenever anything changes
  useEffect(() => {
    if (!pipWindow || pipWindow.closed) return
    bcRef.current?.postMessage({ type: 'update', transcript, hint, hintLoading, buyTimePhrase, lastQ: lastHintText.current, active: audio.active })
  }, [transcript, hint, hintLoading, buyTimePhrase, pipWindow]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hint generation
  async function generateHint(question) {
    if (!question || question === lastHintText.current) return
    // Same question already in flight — skip
    if (hintInFlight.current && question === lastHintText.current) return
    // Different question — cancel previous in-flight and start fresh
    if (hintInFlight.current) {
      hintInFlight.current = false
      clearTimeout(window._mockmateLockTimeout)
    }
    lastHintText.current = question
    hintInFlight.current = true
    const lockTimeout = setTimeout(() => { hintInFlight.current = false }, 30000)
    window._mockmateLockTimeout = lockTimeout
    setBuyTimePhrase(getBuyTimePhrase(question, profileRef.current?.language))
    setHint(null)
    setStreamedAnswer('')
    setStreaming(false)
    clearInterval(streamTimer.current)
    setHintLoading(true)
    try {
      const res = await fetch('/api/hint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, profile: profileRef.current, conversationHistory: conversationHistoryRef.current.slice(-6), provider: providerRef.current, language: profileRef.current?.language || 'English', extraContext: extraContextRef.current || undefined })
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)   // P0 fix: surface server errors properly
      const h = d.hint || null
      // LLM said skip — restore state, reset so next question works
      clearTimeout(lockTimeout)
      if (!h || h.skip) {
        setHintLoading(false)
        hintInFlight.current = false
        lastHintText.current = ''
        return
      }
      // Real question confirmed — replace previous answer
      setHint(h)
      setHintLoading(false)
      setStreamedAnswer('')
      setStreaming(false)
      clearInterval(streamTimer.current)
      hintInFlight.current = false
      const answerText = h.fullAnswer || h.sampleAnswer || ''
      // Mark question confirmed AND attach answer to it
      setTranscript(t => t.map(s => s.text === question ? { ...s, isQuestion: true, answer: '', hint: h } : s))
      // Stream words — update both streamedAnswer and the transcript entry live
      if (answerText) {
        const words = answerText.split(' ')
        let i = 0
        setStreaming(true)
        streamTimer.current = setInterval(() => {
          i++
          const partial = words.slice(0, i).join(' ')
          setStreamedAnswer(partial)
          setTranscript(t => t.map(s => s.text === question ? { ...s, answer: partial } : s))
          if (i >= words.length) {
            clearInterval(streamTimer.current)
            setStreaming(false)
            setTranscript(t => t.map(s => s.text === question ? { ...s, answer: answerText } : s))
          }
        }, WORD_DELAY)
      }
    } catch (e) {
      clearTimeout(lockTimeout)
      setHintLoading(false)
      hintInFlight.current = false
      lastHintText.current = ''
      setError(e.message)
    }
  }

  const onEarlyQuestion = useCallback(text => {
    const trimmed = text.trim()
    if (!trimmed || trimmed.split(/\s+/).length < 4) return
    generateHint(trimmed)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onFinal = useCallback(text => {
    const trimmed = text.trim()
    const words = trimmed.split(/\s+/).length
    if (!trimmed || words < 4) return
    setTranscript(t => [...t, { text: trimmed, ts: Date.now(), isQuestion: false }])
    if (trimmed !== lastHintText.current) generateHint(trimmed)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const audio = useSystemAudio(onFinal, reason => setError(`Transcription stopped: ${reason}`), onEarlyQuestion)

  useEffect(() => {
    audio.start(sourceId)
    // Set up pipWindow cleanup handler if pip was opened during setup
    if (initialPip && !initialPip.closed) {
      initialPip.addEventListener('pagehide', () => {
        setPipWindow(null)
        onPipActive?.(false)   // restore main panel when PiP closes
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [ending, setEnding] = useState(false)

  async function endSession() {
    audio.stop(); stopSpeaking()
    // copilot removed
    if (transcript.length === 0) { onEnd(); return }
    setEnding(true)
    try {
      const questions = transcript.filter(s => s.isQuestion).map(s => s.text)
      const res = await fetch('/api/hint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: `SESSION SUMMARY REQUEST. The interview just ended. Questions asked: ${questions.map((q,i) => `${i+1}. ${q}`).join(' | ')}. Generate a brief post-session summary.`,
          profile: profileRef.current,
          provider: providerRef.current,
          language: profileRef.current?.language || 'English',
          extraContext: 'This is a post-session summary request, not a live interview question. Return a summary of the session.'
        })
      }).then(r => r.json())
      onEnd({ transcript, notes: res?.hint?.fullAnswer || null })
    } catch {
      onEnd({ transcript, notes: null })
    }
    setEnding(false)
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
      {pipSupported && (
        <button onClick={pipWindow ? () => { pipWindow.close(); setPipWindow(null) } : openProtectedPip}
          title={pipWindow ? 'Close protected window' : 'Open protected window — invisible to all screen capture'}
          style={btn(pipWindow ? '#14532d' : 'rgba(255,255,255,0.06)', pipWindow ? '#4ade80' : '#475569')}>
          {pipWindow ? '🛡 on' : '🛡 pip'}
        </button>
      )}
    </div>
  )

  return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} onStealth={onStealth}
      onMinimize={onMinimize} onResize={onResize} onDrag={onDrag}
      onClose={endSession} title="Live" extra={titleExtra}>
      {/* ── Single scrollable chat feed ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column' }}>
        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 5, padding: '5px 8px', fontSize: 10, color: '#fca5a5', marginBottom: 6, lineHeight: 1.4 }}>
            ⚠ {error.includes('rate-limit') || error.includes('quota') ? 'API rate limited — auto-switching provider' : error}
            <button onClick={() => { setError(''); hintInFlight.current = false; lastHintText.current = '' }}
              style={{ float: 'right', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        <ScreenAnalysisPanel analysis={screenAnalysis} analyzing={screenAnalyzing} onDismiss={onDismissScreen} />

        {/* PiP active banner */}
        {pipWindow && !pipWindow.closed && (
          <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🛡️</span>
            <div>
              <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>Protected window active</div>
              <div style={{ fontSize: 10, color: '#475569' }}>Answers appear in floating window — invisible to all screen capture</div>
            </div>
            <button onClick={() => { pipWindow.close(); setPipWindow(null) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
        )}

        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 5, padding: '5px 8px', fontSize: 10, color: '#fca5a5', marginBottom: 6 }}>
            ⚠ {error} <button onClick={() => { setError(''); hintInFlight.current = false; lastHintText.current = '' }} style={{ float: 'right', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Empty state with status + keyboard shortcuts */}
        {transcript.length === 0 && !hintLoading && !audio.interim && (
          <div style={{ padding: '16px 4px' }}>
            {/* Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: audio.active ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${audio.active ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: audio.active ? '#22c55e' : '#ef4444', boxShadow: audio.active ? '0 0 8px #22c55e' : 'none', flexShrink: 0, animation: audio.active ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
              <div>
                <div style={{ fontSize: 12, color: audio.active ? '#4ade80' : '#f87171', fontWeight: 700 }}>{audio.active ? 'Listening' : 'Not capturing'}</div>
                <div style={{ fontSize: 10, color: '#475569' }}>{audio.active ? 'Speak — answers appear automatically' : 'Check DEEPGRAM_API_KEY in .env'}</div>
              </div>
            </div>

            {/* Keyboard shortcuts */}
            <div style={{ fontSize: 9, color: '#334155', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>KEYBOARD SHORTCUTS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {[
                ['Ctrl+Shift+U', 'Capture screen → instant analysis'],
                ['Alt+H', 'Stealth mode (fade nearly invisible)'],
                ['Drag title bar', 'Move overlay anywhere'],
                ['◢ corner drag', 'Resize overlay'],
                ['📝 / 💡 button', 'Toggle Answer ↔ Hints mode'],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 5 }}>
                  <span style={{ fontSize: 10, color: '#6d28d9', background: 'rgba(109,40,217,0.15)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace', fontWeight: 600 }}>{key}</span>
                  <span style={{ fontSize: 10, color: '#475569' }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Chat: each confirmed question + its answer ── */}
        {transcript.filter(s => s.isQuestion).map((s, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            {/* Q bubble */}
            <div style={{ fontSize: 12, color: '#cbd5e1', background: 'rgba(255,255,255,0.06)', borderRadius: '0 8px 8px 8px', padding: '7px 11px', marginBottom: 6, lineHeight: 1.5 }}>
              ❓ {s.text}
            </div>
            {/* A bubble */}
            {s.answer !== undefined && s.hint && (
              <div style={{ marginLeft: 10 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  {s.hint.confidence === 'resume'
                    ? <span style={badge('#14532d', '#4ade80')}>🟢 RESUME</span>
                    : <span style={badge('#431407', '#fb923c')}>🟡 GENERAL</span>}
                  {s.hint.questionType && <span style={badge('rgba(109,40,217,0.3)', '#a5b4fc')}>{TYPE_LABEL[s.hint.questionType] || s.hint.questionType}</span>}
                  {s.hint.pattern && <span style={badge('rgba(49,46,129,0.5)', '#c7d2fe')}>⚡ {s.hint.pattern}</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                    <button onClick={() => speakText(s.hint.fullAnswer || s.hint.sampleAnswer)} style={btn('rgba(255,255,255,0.07)', '#94a3b8')}>▶</button>
                    <button onClick={() => navigator.clipboard?.writeText(s.hint.fullAnswer || s.hint.sampleAnswer || '')} style={btn('rgba(255,255,255,0.04)', '#64748b')}>📋</button>
                  </div>
                </div>
                {s.hint.resumeStory && <div style={{ borderLeft: '2px solid #4ade80', paddingLeft: 7, fontSize: 10, color: '#86efac', marginBottom: 6, fontStyle: 'italic' }}>{s.hint.resumeStory}</div>}
                <div style={{ fontSize: 13, color: s.hint.confidence === 'resume' ? '#dcfce7' : '#e2e8f0', background: s.hint.confidence === 'resume' ? 'rgba(5,46,22,0.5)' : 'rgba(109,40,217,0.08)', border: `1px solid ${s.hint.confidence === 'resume' ? 'rgba(34,197,94,0.2)' : 'rgba(109,40,217,0.2)'}`, borderRadius: '8px 8px 8px 0', padding: '10px 12px', lineHeight: 1.75 }}>
                  {renderMd(s.answer || '…')}
                  {streaming && s.text === lastHintText.current && <span style={{ display: 'inline-block', width: 2, height: '0.9em', background: '#6d28d9', marginLeft: 2, verticalAlign: 'text-bottom', animation: 'blink 0.7s step-end infinite' }} />}
                </div>
                {s.hint.watchOut && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>⚠ {s.hint.watchOut}</div>}
              </div>
            )}
          </div>
        ))}

        {/* Currently loading */}
        {hintLoading && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#94a3b8', background: 'rgba(255,255,255,0.05)', borderRadius: '0 8px 8px 8px', padding: '7px 11px', marginBottom: 6 }}>
              ❓ {lastHintText.current}
            </div>
            <div style={{ marginLeft: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 7, padding: '7px 10px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>Say: <em style={{ color: '#c4b5fd' }}>"{buyTimePhrase}"</em></div>
              <div style={{ height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '40%', background: 'linear-gradient(90deg,#6d28d9,#3b82f6)', animation: 'slide 1.2s ease-in-out infinite' }} />
              </div>
            </div>
          </div>
        )}

        {audio.interim && <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic', marginBottom: 4, paddingLeft: 4 }}>… {audio.interim}</div>}
        <div ref={bottomRef} />

        {/* Extra context */}
        <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <button onClick={() => setContextOpen(c => !c)} style={{ background: 'none', border: 'none', color: contextOpen ? '#a5b4fc' : '#2d3748', fontSize: 9, cursor: 'pointer', padding: 0, fontWeight: 700, letterSpacing: '0.07em' }}>
            {contextOpen ? '▾' : '▸'} EXTRA CONTEXT {extraContext && <span style={{ background: 'rgba(109,40,217,0.25)', color: '#a5b4fc', borderRadius: 6, padding: '0 4px', fontSize: 8, marginLeft: 4 }}>on</span>}
          </button>
          {contextOpen && (
            <textarea value={extraContext} onChange={e => setExtraContext(e.target.value)}
              placeholder="e.g. 'Focus on Python' · 'System design round' · 'Kore.ai work'"
              style={{ marginTop: 5, width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(109,40,217,0.25)', borderRadius: 5, color: '#e2e8f0', fontSize: 10, padding: '5px 7px', resize: 'vertical', minHeight: 44, outline: 'none', fontFamily: 'system-ui', lineHeight: 1.5, boxSizing: 'border-box' }} rows={2} />
          )}
        </div>
      </div>
    </OverlayPanel>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function LiveCompanion({ onHome, panelSize, stealth, onStealth, onMinimize, onResize, onDrag, screenAnalysis, screenAnalyzing, onDismissScreen, onPipActive }) {
  const [phase, setPhase] = useState('setup')
  const [sessionConfig, setSessionConfig] = useState(null)
  const [sessionNotes, setSessionNotes] = useState(null)

  if (phase === 'notes') return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} onStealth={onStealth}
      onMinimize={onMinimize} onResize={onResize} onDrag={onDrag}
      onClose={onHome} title="Session Notes" autoHeight>
      <div style={{ padding: '12px 14px', maxHeight: 400, overflowY: 'auto' }}>
        <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>QUESTIONS COVERED</div>
        {sessionNotes?.transcript?.filter(s => s.isQuestion).map((s, i) => (
          <div key={i} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid #334155' }}>
            {s.text}
          </div>
        ))}
        {sessionNotes?.notes && (
          <>
            <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', marginTop: 14, marginBottom: 8 }}>AI NOTES</div>
            <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.65 }}>{sessionNotes.notes}</div>
          </>
        )}
        <button onClick={onHome} style={{ marginTop: 14, width: '100%', padding: '8px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Done
        </button>
      </div>
    </OverlayPanel>
  )

  if (phase === 'setup') return (
    <SetupScreen
      onStart={async config => {
        let pip = null
        if (window.documentPictureInPicture) {
          try {
            // STEP 1: Hide main panel from DOM immediately — synchronous, before any async ops
            // This ensures the dark panel is gone before screen share can capture it
            const overlay = document.getElementById('mockmate-overlay')
            if (overlay) overlay.style.cssText = 'visibility:hidden!important;opacity:0!important;pointer-events:none!important'

            // STEP 2: Open PiP from this user gesture (required by browser security)
            pip = await window.documentPictureInPicture.requestWindow({ width: 440, height: 620 })
            pip.document.title = 'MockMate — Protected'
            pip.document.body.style.cssText = 'margin:0;padding:0;background:#08090e;'
            pip.document.body.innerHTML = getPipHTML()
            pip.addEventListener('pagehide', () => {
              // Restore main panel when PiP closes
              if (overlay) overlay.style.cssText = ''
              onPipActive?.(false)
            })
          } catch (e) {
            console.warn('PiP failed:', e.message)
            pip = null
            // Restore if PiP failed
            const overlay = document.getElementById('mockmate-overlay')
            if (overlay) overlay.style.cssText = ''
          }
        }
        setSessionConfig({ ...config, pip })
        setPhase('live')
        if (pip) onPipActive?.(true)
      }}
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
      onEnd={data => { setSessionNotes(data); setPhase('notes') }}
      screenAnalysis={screenAnalysis} screenAnalyzing={screenAnalyzing} onDismissScreen={onDismissScreen}
    />
  )
}
