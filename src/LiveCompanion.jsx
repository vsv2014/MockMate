import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useSystemAudio } from './useSystemAudio'
import Report from './Report'
import { OverlayPanel, ScreenAnalysisPanel, IconBtn } from './App'

const PROFILE_KEY = 'peerMockProfile'
function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {} } catch { return {} } }
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch {} }

// Pull boostable terms (tech, tools, acronyms, proper nouns) from the resume + target
// role so Deepgram recognizes the candidate's domain jargon and names accurately.
const KW_STOP = new Set('and the for with you your are was were our their from this that have has had will would over into per via team teams work working experience years year using used use built build led role responsibilities including based across also able strong excellent'.split(' '))
function resumeKeyterms(profile = {}) {
  const text = `${profile.targetRole || ''} ${profile.resume || ''}`
  const freq = new Map()
  for (const tok of text.match(/[A-Za-z][A-Za-z0-9+#.]{1,30}/g) || []) {
    const low = tok.toLowerCase()
    if (KW_STOP.has(low) || low.length < 2) continue
    // Proper nouns / acronyms / tech tokens (caps, inner caps, digits, symbols) rank first.
    const proper = /^[A-Z]/.test(tok) || /[A-Z0-9+#.]/.test(tok.slice(1))
    const w = freq.get(tok) || { n: 0, proper }
    w.n++; freq.set(tok, w)
  }
  return [...freq.entries()]
    .sort((a, b) => (b[1].proper - a[1].proper) || (b[1].n - a[1].n))
    .slice(0, 40).map(([t]) => t)
}
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

// Normalize a question for dedup (lowercase, strip punctuation/extra spaces).
function normalizeQ(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() }
// True if two transcripts are the "same question" — one contains the other.
// Used to avoid a 2nd LLM call when the early-trigger already answered (P0-C).
function sameQuestion(a, b) {
  const x = normalizeQ(a), y = normalizeQ(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// Self-contained HTML for the Document PiP window — receives state via BroadcastChannel.
// Screen-capture exclusion is applied by the Electron main process via the
// 'exclude-pip-window' IPC handler (electron/main.cjs), which calls setContentProtection(true)
// on the window handle — mapping to WDA_EXCLUDEFROMCAPTURE (Windows) and
// NSWindowSharingNone (macOS). Chrome does NOT apply this automatically.
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
  const [providers, setProviders] = useState([])       // configured only (for default + validation)
  const [allProviders, setAllProviders] = useState([]) // every model (for the dropdown)
  const [provider, setProvider] = useState(() => { try { return localStorage.getItem('llmProvider') || '' } catch { return '' } })
  const [dgAvailable, setDgAvailable] = useState(false)
  // Inline API-key entry (replaces the old separate setup.html window).
  const [showKeys, setShowKeys] = useState(false)
  const [keyVals, setKeyVals] = useState({ GROQ_API_KEY: '', GEMINI_API_KEY: '', OPENAI_API_KEY: '', DEEPGRAM_API_KEY: '' })
  const [savingKeys, setSavingKeys] = useState(false)
  const [keyMsg, setKeyMsg] = useState('')

  function refetchProviders() {
    return fetch('/api/providers').then(r => r.json()).then(d => {
      const list = d.providers || []
      setProviders(list)
      setAllProviders(d.allProviders || list.map(p => ({ ...p, configured: true })))
      // Default selection must be a CONFIGURED provider (never auto-pick a locked one)
      setProvider(p => (p && list.some(x => x.id === p)) ? p : (list[0]?.id || ''))
      setDgAvailable(!!d.deepgram)
    }).catch(() => {})
  }

  async function saveKeys() {
    const lines = Object.entries(keyVals).filter(([, v]) => v.trim()).map(([k, v]) => `${k}=${v.trim()}`).join('\n')
    if (!lines) { setKeyMsg('Enter at least one key'); return }
    setSavingKeys(true); setKeyMsg('')
    try {
      const r = await window.electronAPI?.writeEnv?.(lines + '\n')
      if (!r?.ok) throw new Error(r?.error || 'Save failed')
      await window.electronAPI?.applyKeys?.()      // restarts the API server (prod) so it picks up the keys
      await new Promise(res => setTimeout(res, 1200))
      await refetchProviders()
      setKeyVals({ GROQ_API_KEY: '', GEMINI_API_KEY: '', OPENAI_API_KEY: '', DEEPGRAM_API_KEY: '' })
      setShowKeys(false); setKeyMsg('✓ Saved')
    } catch (e) { setKeyMsg('⚠ ' + e.message) }
    setSavingKeys(false)
  }

  useEffect(() => {
    refetchProviders()
    window.electronAPI?.getAudioSources?.().then(srcs => {
      setAudioSources(srcs || [])
      // Auto-select system audio (best for hearing the interviewer) — but NOT on
      // Linux, where Chromium can't capture desktop/loopback audio. There the
      // microphone is the only source that actually produces audio.
      if (window.electronAPI?.platform !== 'linux') {
        const screen = (srcs || []).find(s => /screen|entire|display/i.test(s.name))
        if (screen) setSourceId(screen.id)
      }
    })
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
        <Field label="Target company (sharpens 'why us' answers + web search)"><input style={inp} value={profile.targetCompany || ''} placeholder="e.g. Stripe" onChange={e => patch({ targetCompany: e.target.value })} /></Field>
        <Field label="Resume (optional — answers reference your projects)">
          <textarea rows={3} style={{ ...inp, resize: 'vertical' }} value={profile.resume || ''} placeholder="Paste resume text…" onChange={e => patch({ resume: e.target.value })} />
        </Field>
        <Field label="Job description (optional — sharpens answers to this role)">
          <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={profile.jobDescription || ''} placeholder="Paste job description…" onChange={e => patch({ jobDescription: e.target.value })} />
        </Field>
        <Field label="Your voice & instructions (optional — shapes every answer)">
          <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={profile.customPrompt || ''}
            placeholder="e.g. 'Senior eng, talk like I'm chatting with a peer — casual, confident, short. Lean on my fintech work. Avoid buzzwords.'"
            onChange={e => patch({ customPrompt: e.target.value })} />
        </Field>
        <Field label="Audio source">
          {(() => {
            const systemId = audioSources.find(s => /screen|entire|display/i.test(s.name))?.id || 'microphone'
            const onMic = sourceId === 'microphone'
            return (
              <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{onMic ? '🎤 Microphone' : '🖥️ System Audio'} <span style={{ color: '#475569' }}>· {onMic ? 'picks up your own voice too' : 'hears the interviewer (recommended)'}</span></span>
                <button onClick={() => setSourceId(onMic ? systemId : 'microphone')}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 11, textDecoration: 'underline', padding: 0 }}>
                  {onMic ? 'Use System Audio' : 'Use microphone instead'}
                </button>
              </div>
            )
          })()}
        </Field>
        <Field label="AI model">
          {/* Only CONFIGURED providers — no locked/greyed clutter. Add keys below. */}
          <select style={inp} value={provider} onChange={e => setProvider(e.target.value)} disabled={!providers.length}>
            {!providers.length && <option value="">No models yet — add an API key below</option>}
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <button onClick={() => { setShowKeys(s => !s); setKeyMsg('') }}
            style={{ marginTop: 6, width: '100%', padding: '7px', background: providers.length ? 'rgba(255,255,255,0.05)' : 'rgba(124,58,237,0.25)', color: providers.length ? '#a5b4fc' : '#c4b5fd', border: '1px solid rgba(124,58,237,0.4)', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            {providers.length ? (showKeys ? '× Close key entry' : '⚙ Add / manage API keys') : (showKeys ? '× Close' : '🔑 Add your API keys to get started')}
          </button>
          {showKeys && (
            <div style={{ marginTop: 8, padding: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>Paste a key to enable that provider. Leave others blank. Stored only on this machine.</div>
              {[
                { k: 'GROQ_API_KEY', label: 'Groq (free, fast)' },
                { k: 'GEMINI_API_KEY', label: 'Google Gemini' },
                { k: 'OPENAI_API_KEY', label: 'OpenAI' },
                { k: 'DEEPGRAM_API_KEY', label: 'Deepgram (live transcription)' },
              ].map(({ k, label }) => (
                <input key={k} type="password" placeholder={label} value={keyVals[k]} autoComplete="off"
                  onChange={e => setKeyVals(v => ({ ...v, [k]: e.target.value }))}
                  style={{ ...inp, fontSize: 11 }} />
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={saveKeys} disabled={savingKeys}
                  style={{ flex: 1, padding: '7px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: savingKeys ? 'default' : 'pointer', opacity: savingKeys ? 0.6 : 1 }}>
                  {savingKeys ? 'Saving…' : 'Save keys'}
                </button>
                {keyMsg && <span style={{ fontSize: 10, color: keyMsg.startsWith('⚠') ? '#fca5a5' : '#86efac' }}>{keyMsg}</span>}
              </div>
            </div>
          )}
        </Field>

        <Field label="Interview language">
          <select style={inp} value={profile.language || 'English'} onChange={e => patch({ language: e.target.value })}>
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>

        <Field label="Coding language (for screen-capture solutions)">
          <select style={inp} value={profile.codingLanguage || 'Python'} onChange={e => patch({ codingLanguage: e.target.value })}>
            {['Python', 'Java', 'C++', 'JavaScript', 'TypeScript', 'Go', 'C#', 'Ruby'].map(l => <option key={l} value={l}>{l}</option>)}
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
function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, panelSize, stealth, onStealth, onMinimize, onResize, onDrag, screenAnalysis, screenAnalyzing, onDismissScreen, codingDetected, onCaptureScreen, onReanalyze, onPipActive, pip: initialPip }) {
  const [transcript, setTranscript] = useState([])
  const [conversationHistory, setConversationHistory] = useState([])
  const [hint, setHint] = useState(null)
  const [hintLoading, setHintLoading] = useState(false)
  const [buyTimePhrase, setBuyTimePhrase] = useState('')
  const [pipWindow, setPipWindow] = useState(initialPip || null)
  const [pipProtected, setPipProtected] = useState(true)  // false → show warning banner
  const pipSupported = typeof window !== 'undefined' && !!window.documentPictureInPicture
  const bcRef = useRef(null)   // BroadcastChannel to sync state to PiP window
  const [streamedAnswer, setStreamedAnswer] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [coachMode, setCoachMode] = useState(false)   // 💬 Answer (full answer) ↔ 🎓 Coach (structure only)
  const coachModeRef = useRef(false)
  const [clock, setClock] = useState(0)
  const [error, setError] = useState('')
  const [extraContext, setExtraContext] = useState('')
  const [contextOpen, setContextOpen] = useState(false)
  const extraContextRef = useRef('')

  const lastHintText = useRef('')
  const hintInFlight = useRef(false)  // prevent double API calls
  const hintAbortRef = useRef(null)   // aborts the in-flight /api/hint when a new question arrives
  const lockTimerRef = useRef(null)   // replaces the window._mockmateLockTimeout global
  const profileRef = useRef(profile)
  const providerRef = useRef(initialProvider)
  const conversationHistoryRef = useRef([])
  const startedAt = useRef(Date.now())
  const streamTimer = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => { conversationHistoryRef.current = conversationHistory }, [conversationHistory])
  useEffect(() => { extraContextRef.current = extraContext }, [extraContext])
  useEffect(() => { coachModeRef.current = coachMode }, [coachMode])   // so generateHint (a [] useCallback closure) reads the live value

  useEffect(() => {
    bcRef.current = new BroadcastChannel('mockmate-live')
    return () => {
      bcRef.current?.close()
      try { pipWindow?.close() } catch {}
      clearInterval(streamTimer.current)
      // Abort any in-flight /api/hint so its .then() can't setState after unmount
      // (e.g. ending the session while an answer is still streaming/loading).
      try { hintAbortRef.current?.abort() } catch {}
      clearTimeout(lockTimerRef.current)
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
      // Ask the Electron main process to apply setContentProtection(true) to the new window.
      // The browser-window-created listener in main.cjs is the primary safety net, but we
      // invoke this handler as belt-and-suspenders and to surface a warning if it fails.
      if (window.electronAPI?.excludeFromCapture) {
        await new Promise(r => setTimeout(r, 100))  // let the OS register the window
        const result = await window.electronAPI.excludeFromCapture()
        if (!result?.ok) {
          setPipProtected(false)
          console.warn('[MockMate] Screen protection failed for PiP window:', result?.error)
        } else {
          setPipProtected(true)
          console.log('[MockMate] Screen protection confirmed on hints window', result.id)
        }
      }
    } catch (e) { console.warn('PiP failed:', e.message) }
  }

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now() - startedAt.current), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, streamedAnswer])

  // Hint generation
  async function generateHint(question) {
    if (!question || question === lastHintText.current) return
    // Same question already in flight — skip
    if (hintInFlight.current && question === lastHintText.current) return
    // Different question — cancel previous in-flight request and timer, start fresh
    if (hintInFlight.current) {
      hintInFlight.current = false
      clearTimeout(lockTimerRef.current)
    }
    hintAbortRef.current?.abort()                 // P0-B: kill the previous /api/hint so its stale answer never lands
    const abort = new AbortController()
    hintAbortRef.current = abort
    lastHintText.current = question
    hintInFlight.current = true
    const lockTimeout = setTimeout(() => { hintInFlight.current = false }, 30000)
    lockTimerRef.current = lockTimeout
    setBuyTimePhrase(getBuyTimePhrase(question, profileRef.current?.language))
    setHint(null)
    setStreamedAnswer('')
    setStreaming(false)
    clearInterval(streamTimer.current)
    setHintLoading(true)

    // Upsert the feed entry for this question (covers the early-trigger-then-onFinal case).
    const upsert = patch => setTranscript(t => t.some(s => s.text === question)
      ? t.map(s => s.text === question ? { ...s, ...patch } : s)
      : [...t, { text: question, ts: Date.now(), isQuestion: true, answer: '', ...patch }])

    const finalize = (answer, hintObj) => {
      clearTimeout(lockTimeout)
      setStreaming(false); setHintLoading(false); hintInFlight.current = false
      const finalHint = { ...(hintObj || { confidence: 'general' }), fullAnswer: answer, sampleAnswer: answer }
      setHint(finalHint)
      upsert({ isQuestion: true, answer, hint: finalHint })
    }
    const resetSkip = () => { clearTimeout(lockTimeout); setHintLoading(false); setStreaming(false); hintInFlight.current = false; lastHintText.current = '' }

    // SAFETY NET — the proven non-streaming endpoint. If streaming fails for ANY reason,
    // we fall back to this, so the live answer can never be worse than the old behavior.
    const runFallback = async () => {
      const res = await fetch('/api/hint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ question, profile: profileRef.current, conversationHistory: conversationHistoryRef.current.slice(-6), provider: providerRef.current, language: profileRef.current?.language || 'English', extraContext: extraContextRef.current || undefined })
      })
      const d = await res.json()
      if (question !== lastHintText.current) return        // superseded while awaiting
      if (d.error) throw new Error(d.error)
      const h = d.hint
      if (!h || h.skip) { resetSkip(); return }
      finalize(h.fullAnswer || h.sampleAnswer || '', h)
    }

    try {
      const res = await fetch('/api/hint-stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ question, profile: profileRef.current, conversationHistory: conversationHistoryRef.current.slice(-6), provider: providerRef.current, language: profileRef.current?.language || 'English', extraContext: extraContextRef.current || undefined, mode: coachModeRef.current ? 'coach' : 'answer' })
      })
      if (!res.ok || !res.body) { await runFallback(); return }   // streaming unavailable → proven path

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let sseBuf = '', answer = '', hintObj = null, streamFailed = false

      reading: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        sseBuf += decoder.decode(value, { stream: true })
        let nn
        while ((nn = sseBuf.indexOf('\n\n')) !== -1) {
          const raw = sseBuf.slice(0, nn); sseBuf = sseBuf.slice(nn + 2)
          const ev = raw.match(/^event: (.*)$/m)?.[1]
          let data; try { data = JSON.parse(raw.match(/^data: ([\s\S]*)$/m)?.[1] ?? 'null') } catch { data = null }
          // A newer question superseded this one mid-stream — drop it.
          if (question !== lastHintText.current) { try { await reader.cancel() } catch {} ; return }

          if (ev === 'meta') {
            clearTimeout(lockTimeout)
            hintObj = {
              confidence: data?.confidence === 'resume' ? 'resume' : 'general',
              questionType: data?.type, pattern: data?.pattern || null,
              complexity: data?.complexity || null, watchOut: data?.watch || null,
              _searchSources: data?.searchSources, fullAnswer: '', sampleAnswer: ''
            }
            setHint(hintObj); setHintLoading(false); setStreaming(true); setStreamedAnswer('')
            upsert({ isQuestion: true, answer: '', hint: hintObj })
          } else if (ev === 'token') {
            answer += typeof data === 'string' ? data : ''
            setStreamedAnswer(answer)
            upsert({ answer, hint: hintObj || { confidence: 'general', fullAnswer: '' } })
          } else if (ev === 'skip') {
            resetSkip()
            try { await reader.cancel() } catch {} ; return
          } else if (ev === 'error') {
            streamFailed = true
            try { await reader.cancel() } catch {}
            break reading
          }
        }
      }

      // Stream errored or produced no answer → fall back to the proven endpoint.
      if (streamFailed || !answer.trim()) { await runFallback(); return }
      finalize(answer, hintObj)
    } catch (e) {
      if (e.name === 'AbortError') return   // superseded by a newer question — not an error
      // Streaming threw (network/parse). Try the proven path before surfacing an error.
      try { await runFallback() }
      catch (e2) {
        if (e2.name === 'AbortError') return
        clearTimeout(lockTimeout)
        setHintLoading(false); setStreaming(false)
        hintInFlight.current = false
        lastHintText.current = ''
        setError(e2.message || e.message)
      }
    }
  }

  const onEarlyQuestion = useCallback((text, meta) => {
    if (meta?.isCandidate) return   // diarization: this was you speaking — don't answer your own voice
    const trimmed = text.trim()
    if (!trimmed || trimmed.split(/\s+/).length < 4) return
    generateHint(trimmed)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onFinal = useCallback((text, meta) => {
    if (meta?.isCandidate) return   // diarization: skip the candidate's own speech
    const trimmed = text.trim()
    const words = trimmed.split(/\s+/).length
    if (!trimmed || words < 3) return   // lower gate — catch short Qs ("why this approach?")
    // If the early-trigger already answered this same question, it's already in the
    // feed — don't pay for a 2nd call. Otherwise answer it (generateHint adds it).
    if (sameQuestion(trimmed, lastHintText.current)) return
    generateHint(trimmed)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const audio = useSystemAudio(onFinal, reason => setError(`Transcription stopped: ${reason}`), onEarlyQuestion)

  // Sync all state to the PiP window whenever anything changes. Declared AFTER
  // `audio` so audio.active is in scope and can be a real dependency — otherwise
  // the PiP "Listening / Not capturing" indicator goes stale on reconnect/stop.
  useEffect(() => {
    if (!pipWindow || pipWindow.closed) return
    bcRef.current?.postMessage({ type: 'update', transcript, hint, hintLoading, buyTimePhrase, lastQ: lastHintText.current, active: audio.active })
  }, [transcript, hint, hintLoading, buyTimePhrase, pipWindow, audio.active]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    audio.start(sourceId, { keyterms: resumeKeyterms(profileRef.current) })
    if (initialPip && !initialPip.closed) {
      initialPip.addEventListener('pagehide', () => {
        setPipWindow(null)
        onPipActive?.(false)
      })
      // The PiP was created in the Setup screen before LiveOverlay mounted. The
      // browser-window-created listener in main.cjs already applied protection, but
      // we confirm here and surface a warning if it somehow was not applied.
      if (window.electronAPI?.excludeFromCapture) {
        setTimeout(async () => {
          const result = await window.electronAPI.excludeFromCapture()
          if (!result?.ok) {
            setPipProtected(false)
            console.warn('[MockMate] Screen protection failed for pre-opened PiP:', result?.error)
          } else {
            setPipProtected(true)
            console.log('[MockMate] Screen protection confirmed on hints window', result.id)
          }
        }, 100)
      }
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

  // Clean status pill (left of header): one dot + one word + the timer. Nothing else.
  const statusColor = audio.active ? '#22c55e' : audio.reconnecting ? '#f59e0b' : '#ef4444'
  const statusLabel = audio.active ? 'Listening' : audio.reconnecting ? 'Reconnecting' : 'Paused'
  const titleExtra = (
    <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, boxShadow: `0 0 6px ${statusColor}`, animation: audio.active ? 'pulse 1.6s ease-in-out infinite' : 'none' }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
      <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{fmtClock(clock)}</span>
    </div>
  )

  // The only Live-specific action: the screen-share-safe protected window.
  const liveActions = pipSupported ? (
    <IconBtn icon="shield" active={!!pipWindow}
      onClick={pipWindow ? () => { pipWindow.close(); setPipWindow(null) } : openProtectedPip}
      title={pipWindow ? 'Protected window ON — answers hidden from screen share' : 'Open protected window (hidden from screen share)'} />
  ) : null

  return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} onStealth={onStealth} actions={liveActions} confirmClose
      onMinimize={onMinimize} onResize={onResize} onDrag={onDrag}
      onClose={endSession} extra={titleExtra}>
      {/* ── Single scrollable chat feed ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column' }}>
        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 5, padding: '5px 8px', fontSize: 10, color: '#fca5a5', marginBottom: 6, lineHeight: 1.4 }}>
            ⚠ {error.includes('rate-limit') || error.includes('quota') ? 'API rate limited — auto-switching provider' : error}
            <button onClick={() => { setError(''); hintInFlight.current = false; lastHintText.current = '' }}
              style={{ float: 'right', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Coding platform auto-detected → one tap to capture + solve (no surprise auto-captures) */}
        {codingDetected && !screenAnalyzing && !screenAnalysis && (
          <div onClick={() => onCaptureScreen?.()}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 8, padding: '9px 11px', marginBottom: 8, cursor: 'pointer' }}>
            <span style={{ fontSize: 15 }}>💻</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>Coding question detected</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>Tap to read the screen and get a solution · or press Ctrl+Shift+U</div>
            </div>
            <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700, background: 'rgba(34,197,94,0.15)', padding: '4px 10px', borderRadius: 6 }}>Solve it →</span>
          </div>
        )}

        <ScreenAnalysisPanel analysis={screenAnalysis} analyzing={screenAnalyzing} onDismiss={onDismissScreen} onReanalyze={onReanalyze} onRecapture={onCaptureScreen} />

        {/* PiP active banner */}
        {pipWindow && !pipWindow.closed && pipProtected && (
          <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🛡️</span>
            <div>
              <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>Protected window active</div>
              <div style={{ fontSize: 10, color: '#475569' }}>Answers appear in floating window — invisible to all screen capture</div>
            </div>
            <button onClick={() => { pipWindow.close(); setPipWindow(null) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
        )}

        {/* Warning: screen protection could not be applied — user must know */}
        {pipWindow && !pipWindow.closed && !pipProtected && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 12, color: '#f87171', fontWeight: 700 }}>Screen protection unavailable — hints may be visible</div>
              <div style={{ fontSize: 10, color: '#475569' }}>The hints window could not be hidden from screen share. Restart MockMate and try again.</div>
            </div>
          </div>
        )}

        {/* Empty state with status + keyboard shortcuts */}
        {transcript.length === 0 && !hintLoading && !audio.interim && (
          <div style={{ padding: '16px 4px' }}>
            {/* Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: audio.active ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${audio.active ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: audio.active ? '#22c55e' : '#ef4444', boxShadow: audio.active ? '0 0 8px #22c55e' : 'none', flexShrink: 0, animation: audio.active ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
              <div>
                <div style={{ fontSize: 12, color: audio.active ? '#4ade80' : audio.reconnecting ? '#f59e0b' : '#f87171', fontWeight: 700 }}>{audio.active ? 'Listening' : audio.reconnecting ? 'Reconnecting…' : 'Not capturing'}</div>
                <div style={{ fontSize: 10, color: '#475569' }}>{audio.active ? 'Speak — answers appear automatically' : audio.reconnecting ? 'Connection dropped — restoring automatically' : 'Check DEEPGRAM_API_KEY in .env'}</div>
              </div>
            </div>

            {/* Calm guidance — answers stream in on their own. Two shortcuts that matter. */}
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginBottom: 14 }}>
              Answers appear here the moment the interviewer speaks. Just read and respond in your own words.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['Ctrl+Shift+U', 'Capture a coding question on screen'],
                ['Alt+H', 'Instantly hide the overlay'],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#a78bfa', background: 'rgba(124,58,237,0.15)', padding: '2px 7px', borderRadius: 5, fontFamily: 'monospace', fontWeight: 600, minWidth: 92, textAlign: 'center' }}>{key}</span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>{desc}</span>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <button onClick={() => setContextOpen(c => !c)} style={{ background: 'none', border: 'none', color: contextOpen ? '#a5b4fc' : '#2d3748', fontSize: 9, cursor: 'pointer', padding: 0, fontWeight: 700, letterSpacing: '0.07em' }}>
              {contextOpen ? '▾' : '▸'} EXTRA CONTEXT {extraContext && <span style={{ background: 'rgba(109,40,217,0.25)', color: '#a5b4fc', borderRadius: 6, padding: '0 4px', fontSize: 8, marginLeft: 4 }}>on</span>}
            </button>
            <button onClick={() => setCoachMode(m => !m)}
              title="Coach mode gives you the STRUCTURE to say — clarify, trade-offs, the 'why' — instead of a full answer, so you communicate like a strong engineer. Answer mode gives the spoken answer."
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: coachMode ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${coachMode ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`, color: coachMode ? '#4ade80' : '#94a3b8', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', borderRadius: 100, padding: '3px 9px', cursor: 'pointer' }}>
              {coachMode ? '🎓 COACH' : '💬 ANSWER'}
            </button>
          </div>
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
export default function LiveCompanion({ onHome, panelSize, stealth, onStealth, onMinimize, onResize, onDrag, screenAnalysis, screenAnalyzing, onDismissScreen, codingDetected, onCaptureScreen, onReanalyze, onPipActive }) {
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
      codingDetected={codingDetected} onCaptureScreen={onCaptureScreen} onReanalyze={onReanalyze}
      onPipActive={onPipActive}
    />
  )
}
