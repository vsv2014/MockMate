import React, { useState, useRef, useEffect, useCallback } from 'react'
import { apiFetch } from './lib/apiClient'
import { useSystemAudio } from './useSystemAudio'
import SoloFeedback from './SoloFeedback'
import { T } from './auth/tokens'
import { isManaged } from './lib/aiMode'
import { getAutoSkip } from './lib/aiSettings'
import { retrieveContext } from './lib/docs'
import Documents from './Documents'
import { OverlayPanel, ScreenAnalysisPanel, IconBtn } from './App'
import ApiKeysPanel from './ApiKeys'
import { saveSession } from './history'
import { loadProfile, saveProfile } from './lib/profile'
import { fmtClock, TYPE_LABEL } from './lib/ui'
import { LANGUAGES, STT_LANG, CODING_LANGUAGES } from './lib/languages'
import { estimateCost } from './cost'
import { extractPdfText } from './pdf'
import { mountPip } from './pip'
import { mergeTurns, normalizeQ, isStragglerDuplicate } from './lib/transcript'

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
const CODE_BLOCK_STYLE = { margin: '6px 0', padding: '10px 12px', background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflowX: 'auto', fontFamily: 'Menlo, Consolas, monospace', fontSize: 11.5, lineHeight: 1.55, color: '#e2e8f0', whiteSpace: 'pre' }

function renderMd(text) {
  if (!text) return null
  const lines = text.split('\n')
  const out = []
  let code = null   // accumulating lines inside a ``` fence (null = not in a code block)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('```')) {            // fence open/close
      if (code === null) code = []
      else { out.push(<pre key={'c' + i} style={CODE_BLOCK_STYLE}>{code.join('\n')}</pre>); code = null }
      continue
    }
    if (code !== null) { code.push(line); continue } // inside code — keep raw, no markdown
    const trimmed = line.trim()
    if (!trimmed) { out.push(<div key={i} style={{ height: 6 }} />); continue }
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      out.push(
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3, alignItems: 'flex-start' }}>
          <span style={{ color: '#0d9488', flexShrink: 0, marginTop: 2, fontSize: 10 }}>▸</span>
          <span>{inlineMd(trimmed.slice(2))}</span>
        </div>
      )
      continue
    }
    if (/^\*\*[^*]+:\*\*/.test(trimmed)) {
      out.push(<div key={i} style={{ fontWeight: 700, color: '#2dd4bf', fontSize: 11, letterSpacing: '0.04em', marginTop: 8, marginBottom: 3 }}>{inlineMd(trimmed)}</div>)
      continue
    }
    out.push(<div key={i} style={{ marginBottom: 4 }}>{inlineMd(trimmed)}</div>)
  }
  // Streaming: a code block may still be open (closing ``` not arrived yet) — render it live anyway.
  if (code !== null && code.length) out.push(<pre key="c-open" style={CODE_BLOCK_STYLE}>{code.join('\n')}</pre>)
  return out
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


// ── Setup screen ──────────────────────────────────────────────────────────────
function SetupScreen({ onStart, onHome, panelSize, stealth, onStealth, onMinimize, onResize, onDrag }) {
  const [profile, setProfile] = useState(loadProfile)
  const [audioSources, setAudioSources] = useState([])
  const [sourceId, setSourceId] = useState('microphone')
  const [providers, setProviders] = useState([])       // configured only (for default + validation)
  const [allProviders, setAllProviders] = useState([]) // every model (for the dropdown)
  const [provider, setProvider] = useState(() => { try { return localStorage.getItem('llmProvider') || '' } catch { return '' } })
  const [dgAvailable, setDgAvailable] = useState(false)
  const [models, setModels] = useState([])   // dynamic per-key model list from /api/models
  // Inline API-key entry — same keys are also editable globally (Home → Settings).
  const [showKeys, setShowKeys] = useState(false)

  function refetchProviders() {
    return apiFetch('/api/providers').then(r => r.json()).then(d => {
      const list = d.providers || []
      setProviders(list)
      setAllProviders(d.allProviders || list.map(p => ({ ...p, configured: true })))
      // Default selection must be a CONFIGURED provider (never auto-pick a locked one)
      setProvider(p => (p && list.some(x => x.id === p)) ? p : (list[0]?.id || ''))
      setDgAvailable(!!d.deepgram)
    }).catch(() => {})
  }

  useEffect(() => {
    refetchProviders()
    apiFetch('/api/models').then(r => r.json()).then(d => setModels(d.models || [])).catch(() => {})
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
  const managed = isManaged()   // managed → hide model picker, let the server auto-route
  const [pdfMsg, setPdfMsg] = useState('')
  // BYOK with no LLM configured → hints would error on every question mid-call. Block Start and say why.
  const noLLM = !managed && providers.length === 0 && models.length === 0
  const canStart = dgAvailable && !noLLM

  const inp = { width: '100%', background: T.surface2, border: `1px solid ${T.border}`, color: T.text1, padding: '10px 12px', borderRadius: T.rCtrl, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: T.font }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text1, fontFamily: T.font, overflowY: 'auto' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: T.text1 }}>Live Interview</div>
            <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>Set up, then MockMate floats invisibly over your call and suggests answers in real time.</div>
          </div>
          <button onClick={onHome} style={{ height: 38, padding: '0 16px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 13, cursor: 'pointer', fontFamily: T.font }}>← Back</button>
        </div>

        {!dgAvailable && (
          <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#fca5a5' }}>
            ⚠ Live needs a <strong>Deepgram key</strong> to transcribe the interviewer. Add one in <strong>Settings → Voice</strong>, then come back.
          </div>
        )}
        {dgAvailable && noLLM && (
          <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#fca5a5' }}>
            ⚠ No AI model configured — hints would fail on every question. Add an AI key in <strong>Settings</strong> (or switch to MockMate AI), then come back.
          </div>
        )}

        <Section n={1} title="Interview" subtitle="Who you are and the role">
        <Field label="Your name"><input style={inp} value={profile.name || ''} placeholder="e.g. Charan" onChange={e => patch({ name: e.target.value })} /></Field>
        <Field label="Target role"><input style={inp} value={profile.targetRole || ''} placeholder="e.g. Senior AI Engineer" onChange={e => patch({ targetRole: e.target.value })} /></Field>
        <Field label="Target company (sharpens 'why us' answers + web search)"><input style={inp} value={profile.targetCompany || ''} placeholder="e.g. Stripe" onChange={e => patch({ targetCompany: e.target.value })} /></Field>
        </Section>

        <Section n={2} title="Documents & context" subtitle="Ground answers in your resume, JD & notes">
        <Field label="Resume (optional — answers reference your projects)">
          <textarea rows={3} style={{ ...inp, resize: 'vertical' }} value={profile.resume || ''} placeholder="Paste resume text…" onChange={e => patch({ resume: e.target.value })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#5eead4', cursor: 'pointer', background: 'rgba(13,148,136,0.12)', border: '1px solid rgba(13,148,136,0.3)', borderRadius: 6, padding: '4px 9px' }}>
              📄 Upload PDF
              <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                onChange={async e => {
                  const file = e.target.files?.[0]; e.target.value = ''
                  if (!file) return
                  setPdfMsg('Reading PDF…')
                  try {
                    const text = await extractPdfText(file)
                    if (text && text.length > 20) { patch({ resume: text }); setPdfMsg(`✓ Loaded ${text.length.toLocaleString()} chars`) }
                    else setPdfMsg('⚠ No text found (scanned image?) — paste it instead')
                  } catch { setPdfMsg('⚠ Could not read that PDF — please paste the text') }
                }} />
            </label>
            {pdfMsg && <span style={{ fontSize: 10, color: pdfMsg.startsWith('⚠') ? '#fca5a5' : '#86efac' }}>{pdfMsg}</span>}
          </div>
        </Field>
        <Field label="Job description (optional — sharpens answers to this role)">
          <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={profile.jobDescription || ''} placeholder="Paste job description…" onChange={e => patch({ jobDescription: e.target.value })} />
        </Field>
        <Field label="Documents (RAG — retrieves the relevant parts of your files per question)">
          <Documents />
        </Field>
        <Field label="Your voice & instructions (optional — shapes every answer)">
          <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={profile.customPrompt || ''}
            placeholder="e.g. 'Senior eng, talk like I'm chatting with a peer — casual, confident, short. Lean on my fintech work. Avoid buzzwords.'"
            onChange={e => patch({ customPrompt: e.target.value })} />
        </Field>
        </Section>

        <Section n={3} title="Delivery" subtitle="Audio, model & language" defaultOpen={false}>
        <Field label="Audio source">
          {(() => {
            const systemId = audioSources.find(s => /screen|entire|display/i.test(s.name))?.id || 'microphone'
            const onMic = sourceId === 'microphone'
            return (
              <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{onMic ? '🎤 Microphone' : '🖥️ System Audio'} <span style={{ color: '#475569' }}>· {onMic ? 'picks up your own voice too' : 'hears the interviewer (recommended)'}</span></span>
                <button onClick={() => setSourceId(onMic ? systemId : 'microphone')}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#0d9488', cursor: 'pointer', fontSize: 11, textDecoration: 'underline', padding: 0 }}>
                  {onMic ? 'Use System Audio' : 'Use microphone instead'}
                </button>
              </div>
            )
          })()}
        </Field>
        {!managed && (
          <Field label="AI model">
            <select style={inp} value={provider} onChange={e => setProvider(e.target.value)} disabled={!providers.length && !models.length}>
              {!providers.length && !models.length && <option value="">No models yet — add a key in Settings</option>}
              {models.length > 0
                ? models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)
                : providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>Live list of every model your key supports. Manage keys in <strong style={{ color: T.text2 }}>Settings → API &amp; Connections</strong>.</div>
          </Field>
        )}

        <Field label="Interview language">
          <select style={inp} value={profile.language || 'English'} onChange={e => patch({ language: e.target.value })}>
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>

        <Field label="Coding language (for screen-capture solutions)">
          <select style={inp} value={profile.codingLanguage || 'Python'} onChange={e => patch({ codingLanguage: e.target.value })}>
            {CODING_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        </Section>

        <button disabled={!canStart} onClick={() => onStart({ profile, sourceId, provider: managed ? '' : provider })}
          style={{ height: 48, marginTop: 4, background: canStart ? T.accent : T.surface2, color: canStart ? '#fff' : T.text3, border: 'none', borderRadius: T.rCtrl, fontSize: 15, fontWeight: 600, cursor: canStart ? 'pointer' : 'default', fontFamily: T.font }}>
          Start Live →
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: T.text2, marginBottom: 6, fontFamily: T.font }}>{label}</div>
      {children}
    </div>
  )
}

// Numbered, collapsible setup section (declutters the flat form — the LockedIn 1·2·3 pattern).
function Section({ n, title, subtitle, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: T.font, textAlign: 'left' }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: T.surface2, border: `1px solid ${T.border}`, color: T.text2, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{n}</span>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.text1 }}>{title}</span>
          {subtitle && <span style={{ display: 'block', fontSize: 11.5, color: T.text3, marginTop: 1 }}>{subtitle}</span>}
        </span>
        <span style={{ color: T.text3, fontSize: 12 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>}
    </div>
  )
}

// ── Live overlay ──────────────────────────────────────────────────────────────
function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, panelSize, stealth, minimized, onStealth, onMinimize, onResize, onDrag, screenAnalysis, screenAnalyzing, onDismissScreen, codingDetected, onCaptureScreen, onReanalyze, onPipActive, pip: initialPip }) {
  const [transcript, setTranscript] = useState([])
  const [hint, setHint] = useState(null)
  const [hintLoading, setHintLoading] = useState(false)
  const [buyTimePhrase, setBuyTimePhrase] = useState('')
  const [pipWindow, setPipWindow] = useState(initialPip || null)
  const [pipProtected, setPipProtected] = useState(true)  // false → show warning banner
  const pipSupported = typeof window !== 'undefined' && !!window.documentPictureInPicture
  const bcRef = useRef(null)   // BroadcastChannel to sync state to PiP window
  const [streaming, setStreaming] = useState(false)
  const [usage, setUsage] = useState({ tokens: 0, cost: 0 })   // session token/cost burn (BYOK gauge)
  const [coachMode, setCoachMode] = useState(false)   // 💬 Answer (full answer) ↔ 🎓 Coach (structure only)
  const coachModeRef = useRef(false)
  // Answer verbosity — Concise (fast, glanceable) ↔ Balanced ↔ Detailed. Persisted; sent to the
  // hint engine as `style`. Concise streams the first word sooner and stays readable mid-call.
  const [answerStyle, setAnswerStyle] = useState(() => { try { return localStorage.getItem('mm-answer-style') || 'balanced' } catch { return 'balanced' } })
  const answerStyleRef = useRef('balanced')
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
  const startedAt = useRef(Date.now())
  const streamTimer = useRef(null)
  const bottomRef = useRef(null)
  // Coalesce a question that Deepgram delivers as several "final" segments into ONE
  // answer — fire only after a short pause, so the UI doesn't thrash (loader flicker +
  // superseded/skipped answers) when the interviewer's question arrives in pieces.
  const finalDebounce = useRef(null)
  const pendingQ = useRef('')
  const ragSpec = useRef({ q: '', p: null })   // speculative RAG embed started during the debounce, reused by generateHint
  const convoRef = useRef([])   // the REAL conversation: interviewer questions + what YOU said (not AI answers)

  useEffect(() => { extraContextRef.current = extraContext }, [extraContext])
  useEffect(() => { coachModeRef.current = coachMode }, [coachMode])   // so generateHint (a [] useCallback closure) reads the live value
  useEffect(() => { answerStyleRef.current = answerStyle; try { localStorage.setItem('mm-answer-style', answerStyle) } catch {} }, [answerStyle])

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
      clearTimeout(finalDebounce.current)
      stopSpeaking()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function openProtectedPip() {
    if (!window.documentPictureInPicture) return
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 440, height: 620 })
      pip.document.title = 'MockMate — Protected'
      pip.document.body.style.cssText = 'margin:0;padding:0;background:#08090e;font-family:system-ui,sans-serif;color:#e2e8f0;overflow-y:auto;'
      mountPip(pip.document)
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript])

  // Hint generation
  async function generateHint(question) {
    if (!question || question === lastHintText.current) return
    // Prior conversation turns (interviewer Qs + what YOU said) for LLM context — excludes
    // the current question (already pushed to convoRef) so it isn't sent twice. Gives Live
    // Companion memory across turns (resolve "that"/"it"); was previously always empty.
    const priorTurns = () => {
      const h = convoRef.current
      const prior = (h.length && h[h.length - 1]?.text === question) ? h.slice(0, -1) : h
      return prior.slice(-12)
    }
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
    // Hard backstop: if nothing resolves within 30s (a hung provider, an unexpected
    // throw), clear the loading UI so the overlay never sits stuck on "Let me think…".
    const lockTimeout = setTimeout(() => {
      hintInFlight.current = false
      setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
    }, 30000)
    lockTimerRef.current = lockTimeout
    setBuyTimePhrase(getBuyTimePhrase(question, profileRef.current?.language))
    setHint(null)
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
      setBuyTimePhrase('')   // answer is here — drop the "Let me think…" filler
      const finalHint = { ...(hintObj || { confidence: 'general' }), fullAnswer: answer, sampleAnswer: answer }
      setHint(finalHint)
      upsert({ isQuestion: true, answer, hint: finalHint })
    }
    const resetSkip = () => { clearTimeout(lockTimeout); setHintLoading(false); setStreaming(false); hintInFlight.current = false; lastHintText.current = ''; setBuyTimePhrase('') }

    // Document RAG — retrieve the chunks of the candidate's uploaded docs most relevant to THIS
    // question and fold them into the context. No-op (instant '') when no docs are uploaded, and
    // time-boxed inside retrieveContext so it can never stall the live answer.
    // Reuse the speculative embed started during the debounce (overlaps its ~400ms with the wait);
    // fall back to embedding now if the final question differs. Tight budget so RAG can't add more
    // than ~0.6s to time-to-first-token. (No-docs users pay 0ms — retrieveContext returns '' instantly.)
    const spec = ragSpec.current
    const ragContext = (spec.q === question && spec.p)
      ? await spec.p.catch(() => '')
      : await retrieveContext(question, { budgetMs: 600 }).catch(() => '')
    if (ragSpec.current === spec) ragSpec.current = { q: '', p: null }   // don't wipe a newer question's speculative embed set during the await
    if (question !== lastHintText.current) return   // a newer question superseded this during retrieval
    const mergedContext = () => [extraContextRef.current, ragContext].filter(Boolean).join('\n\n') || undefined

    // SAFETY NET — the proven non-streaming endpoint. If streaming fails for ANY reason,
    // we fall back to this, so the live answer can never be worse than the old behavior.
    const runFallback = async () => {
      const res = await apiFetch('/api/hint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ question, profile: profileRef.current, conversationHistory: priorTurns(), provider: providerRef.current, language: profileRef.current?.language || 'English', extraContext: mergedContext(), style: answerStyleRef.current, autoSkip: getAutoSkip() })
      })
      const d = await res.json()
      if (question !== lastHintText.current) return        // superseded while awaiting
      if (d.error) throw new Error(d.error)
      const h = d.hint
      if (!h || h.skip) { resetSkip(); return }
      finalize(h.fullAnswer || h.sampleAnswer || '', h)
    }

    try {
      const res = await apiFetch('/api/hint-stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ question, profile: profileRef.current, conversationHistory: priorTurns(), provider: providerRef.current, language: profileRef.current?.language || 'English', extraContext: mergedContext(), mode: coachModeRef.current ? 'coach' : 'answer', style: answerStyleRef.current, autoSkip: getAutoSkip() })
      })
      if (!res.ok || !res.body) { await runFallback(); return }   // streaming unavailable → proven path

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let sseBuf = '', answer = '', hintObj = null

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
            setHint(hintObj); setHintLoading(false); setStreaming(true)
            upsert({ isQuestion: true, answer: '', hint: hintObj })
          } else if (ev === 'token') {
            answer += typeof data === 'string' ? data : ''
            upsert({ answer, hint: hintObj || { confidence: 'general', fullAnswer: '' } })
          } else if (ev === 'usage') {
            const u = data || {}
            setUsage(s => ({ tokens: s.tokens + (u.input || 0) + (u.output || 0), cost: s.cost + estimateCost(u.model, u.input || 0, u.output || 0) }))
          } else if (ev === 'skip') {
            resetSkip()
            try { await reader.cancel() } catch {} ; return
          } else if (ev === 'error') {
            // Stop reading. If we already streamed text, the code after the loop keeps it;
            // only if nothing streamed do we fall back to /api/hint (no duplicate, no 2nd call).
            try { await reader.cancel() } catch {}
            break reading
          }
        }
      }

      // Only fall back to the proven endpoint when streaming produced NOTHING usable.
      // If we already streamed an answer — even one cut short by a late error — KEEP it.
      // Re-generating would (a) show the same answer twice and (b) fire a second LLM call
      // per question, which is the main reason rate limits get hit within 2-3 questions.
      if (!answer.trim()) { await runFallback(); return }
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
        setBuyTimePhrase('')   // don't leave "Let me think…" hanging with no answer coming
        setError(e2.message || e.message)
      }
    }
  }

  const onEarlyQuestion = useCallback((text, meta) => {
    if (meta?.isCandidate) return   // diarization: this was you speaking — don't answer your own voice
    const trimmed = text.trim()
    if (!trimmed || trimmed.split(/\s+/).length < 4) return
    // Only prime an instant "buy-time" filler the candidate can say while thinking.
    // The actual answer comes from the coalesced final below — so we never double-fire
    // an answer on a partial and then supersede it (that was the loader thrash).
    setBuyTimePhrase(getBuyTimePhrase(trimmed, profileRef.current?.language))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onFinal = useCallback((text, meta) => {
    const trimmed = text.trim()
    // Diarization: this was YOU speaking. Don't generate an answer to your own voice — but
    // DO record what you said, so the end-of-session review is the REAL conversation
    // (interviewer question + what you actually answered), not the AI's suggestions.
    if (meta?.isCandidate && !meta?.isQuestion) {
      if (trimmed && trimmed.split(/\s+/).length >= 2) convoRef.current.push({ role: 'candidate', text: trimmed, ts: Date.now() })
      return
    }
    if (!trimmed || trimmed.split(/\s+/).length < 3) return   // lower gate — catch short Qs ("why this approach?")
    // Coalesce: a question often arrives as several final segments. Accumulate them and answer
    // ONCE after a short pause. If the text already ends in '?' it's clearly complete → fire
    // almost immediately for a snappy live feel; otherwise wait a touch longer for stragglers.
    // (Was a flat 850ms, which added a full extra beat of silence on every question.)
    pendingQ.current = pendingQ.current ? `${pendingQ.current} ${trimmed}` : trimmed
    clearTimeout(finalDebounce.current)
    const terminal = /\?\s*$/.test(pendingQ.current)
    // Speculative RAG: on a complete-looking question, start the doc-embed NOW so it overlaps the
    // debounce wait instead of adding to time-to-first-token. generateHint reuses this if the final
    // question matches. No-ops instantly when no docs are uploaded (retrieveContext returns '').
    if (terminal) {
      const specQ = pendingQ.current.trim()
      ragSpec.current = { q: specQ, p: retrieveContext(specQ, { budgetMs: 600 }).catch(() => '') }
    }
    finalDebounce.current = setTimeout(() => {
      const q = pendingQ.current.trim(); pendingQ.current = ''
      if (!q) return
      // The SAME sentence again (Deepgram straggler, or the interviewer literally repeating
      // it) — the answer is already on screen, so re-surface it instead of burning a 2nd
      // call. A real rephrase or "…and its complexity?" differs by >2 words → fresh answer.
      if (isStragglerDuplicate(q, lastHintText.current)) { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); return }
      convoRef.current.push({ role: 'interviewer', text: q, ts: Date.now() })   // record the question asked
      generateHint(q)
    }, terminal ? 250 : 450)
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
    audio.start(sourceId, { keyterms: resumeKeyterms(profileRef.current), language: STT_LANG[profileRef.current?.language] || 'en-US' })
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
    clearTimeout(finalDebounce.current)
    // The REAL conversation: interviewer questions + what YOU actually said (diarized),
    // NOT the AI's suggested answers. Merge consecutive same-speaker segments into clean turns.
    const conversation = mergeTurns(convoRef.current)
    if (conversation.length === 0) { onEnd(); return }
    setEnding(true)
    try {
      // Score it the way Solo Practice does — from what the CANDIDATE said. Gives a real
      // summary, scorecard, and delivery review of how the interview actually went.
      const res = await apiFetch('/api/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { domainLabel: profileRef.current?.targetRole || 'Live interview', roundLabel: 'Live interview' },
          transcript: conversation,
          profile: profileRef.current,
          provider: providerRef.current
        })
      }).then(r => r.json())
      onEnd({ conversation, report: res?.report || null })
    } catch {
      onEnd({ conversation, report: null })
    }
    setEnding(false)
  }
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
      {usage.tokens > 0 && (
        <span title={`This session: ${usage.tokens.toLocaleString()} tokens · est. $${usage.cost.toFixed(3)} on your API key (rough estimate)`}
          style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', cursor: 'default' }}>
          · {(usage.tokens / 1000).toFixed(1)}k tok · ~${usage.cost.toFixed(2)}
        </span>
      )}
    </div>
  )

  // The only Live-specific action: the screen-share-safe protected window.
  const liveActions = pipSupported ? (
    <IconBtn icon="shield" active={!!pipWindow}
      onClick={pipWindow ? () => { pipWindow.close(); setPipWindow(null) } : openProtectedPip}
      title={pipWindow ? 'Protected window ON — answers hidden from screen share' : 'Open protected window (hidden from screen share)'} />
  ) : null

  return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} onStealth={onStealth} actions={liveActions} confirmClose
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
                  <span style={{ fontSize: 10, color: '#2dd4bf', background: 'rgba(13,148,136,0.15)', padding: '2px 7px', borderRadius: 5, fontFamily: 'monospace', fontWeight: 600, minWidth: 92, textAlign: 'center' }}>{key}</span>
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
                  {s.hint.questionType && <span style={badge('rgba(20,184,166,0.3)', '#5eead4')}>{TYPE_LABEL[s.hint.questionType] || s.hint.questionType}</span>}
                  {s.hint.pattern && <span style={badge('rgba(19,78,74,0.5)', '#99f6e4')}>⚡ {s.hint.pattern}</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                    <button onClick={() => navigator.clipboard?.writeText(s.hint.fullAnswer || s.hint.sampleAnswer || '')} style={btn('rgba(255,255,255,0.04)', '#64748b')}>📋</button>
                  </div>
                </div>
                {s.hint.resumeStory && <div style={{ borderLeft: '2px solid #4ade80', paddingLeft: 7, fontSize: 10, color: '#86efac', marginBottom: 6, fontStyle: 'italic' }}>{s.hint.resumeStory}</div>}
                <div role="log" aria-live="polite" aria-label="Suggested answer" style={{ fontSize: 13, color: s.hint.confidence === 'resume' ? '#dcfce7' : '#e8eaf0', background: s.hint.confidence === 'resume' ? 'rgba(6,30,18,0.96)' : 'rgba(20,18,32,0.96)', border: `1px solid ${s.hint.confidence === 'resume' ? 'rgba(34,197,94,0.3)' : 'rgba(13,148,136,0.32)'}`, borderRadius: '8px 8px 8px 0', padding: '10px 12px', lineHeight: 1.75 }}>
                  {renderMd(s.answer || '…')}
                  {streaming && s.text === lastHintText.current && <span style={{ display: 'inline-block', width: 2, height: '0.9em', background: '#0d9488', marginLeft: 2, verticalAlign: 'text-bottom', animation: 'blink 0.7s step-end infinite' }} />}
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
              <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>Say: <em style={{ color: '#5eead4' }}>"{buyTimePhrase}"</em></div>
              <div style={{ height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '40%', background: 'linear-gradient(90deg,#0d9488,#3b82f6)', animation: 'slide 1.2s ease-in-out infinite' }} />
              </div>
            </div>
          </div>
        )}

        {audio.interim && <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic', marginBottom: 4, paddingLeft: 4 }}>… {audio.interim}</div>}
        <div ref={bottomRef} />

        {/* Extra context */}
        <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <button onClick={() => setContextOpen(c => !c)} style={{ background: 'none', border: 'none', color: contextOpen ? '#5eead4' : '#2d3748', fontSize: 9, cursor: 'pointer', padding: 0, fontWeight: 700, letterSpacing: '0.07em' }}>
              {contextOpen ? '▾' : '▸'} EXTRA CONTEXT {extraContext && <span style={{ background: 'rgba(20,184,166,0.25)', color: '#5eead4', borderRadius: 6, padding: '0 4px', fontSize: 8, marginLeft: 4 }}>on</span>}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Answer length — cycles Concise → Balanced → Detailed. Concise = fastest first word. */}
              <button onClick={() => setAnswerStyle(s => s === 'concise' ? 'balanced' : s === 'balanced' ? 'detailed' : 'concise')}
                title="Answer length — Concise (fastest, easiest to glance at) · Balanced · Detailed. Concise streams the first word soonest and uses fewer tokens."
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: answerStyle === 'balanced' ? 'rgba(255,255,255,0.04)' : 'rgba(20,184,166,0.15)', border: `1px solid ${answerStyle === 'balanced' ? 'rgba(255,255,255,0.1)' : 'rgba(20,184,166,0.4)'}`, color: answerStyle === 'balanced' ? '#94a3b8' : '#5eead4', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', borderRadius: 100, padding: '3px 9px', cursor: 'pointer' }}>
                {answerStyle === 'concise' ? '⚡ CONCISE' : answerStyle === 'detailed' ? '📖 DETAILED' : '⚖ BALANCED'}
              </button>
              <button onClick={() => setCoachMode(m => !m)}
                title="Coach mode gives you the STRUCTURE to say — clarify, trade-offs, the 'why' — instead of a full answer, so you communicate like a strong engineer. Answer mode gives the spoken answer."
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: coachMode ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${coachMode ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`, color: coachMode ? '#4ade80' : '#94a3b8', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', borderRadius: 100, padding: '3px 9px', cursor: 'pointer' }}>
                {coachMode ? '🎓 COACH' : '💬 ANSWER'}
              </button>
            </div>
          </div>
          {contextOpen && (
            <textarea value={extraContext} onChange={e => setExtraContext(e.target.value)}
              placeholder="e.g. 'Focus on Python' · 'System design round' · 'Kore.ai work'"
              style={{ marginTop: 5, width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(20,184,166,0.25)', borderRadius: 5, color: '#e2e8f0', fontSize: 10, padding: '5px 7px', resize: 'vertical', minHeight: 44, outline: 'none', fontFamily: 'system-ui', lineHeight: 1.5, boxSizing: 'border-box' }} rows={2} />
          )}
        </div>
      </div>
    </OverlayPanel>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function LiveCompanion({ onHome, onPhaseChange, panelSize, stealth, minimized, onStealth, onMinimize, onResize, onDrag, screenAnalysis, screenAnalyzing, onDismissScreen, codingDetected, onCaptureScreen, onReanalyze, onPipActive }) {
  const [phase, setPhase] = useState('setup')
  const [sessionConfig, setSessionConfig] = useState(null)
  const [sessionNotes, setSessionNotes] = useState(null)
  // Tell the parent our phase so it can size the window: setup/notes = full dashboard
  // window; live = compact invisible overlay.
  useEffect(() => { onPhaseChange?.(phase) }, [phase, onPhaseChange])

  if (phase === 'notes') {
    const conversation = sessionNotes?.conversation || []
    const report = sessionNotes?.report || { summary: 'Session ended — your conversation is below.', overallScore: null, dimensions: [], strengths: [], improvements: [] }
    return (
      <div style={{ minHeight: '100vh', background: T.bg, color: T.text1, fontFamily: T.font, overflowY: 'auto' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 26px', boxSizing: 'border-box' }}>
          <SoloFeedback report={report} transcript={conversation} onAgain={onHome} onAgainLabel="← Back to dashboard" />
        </div>
      </div>
    )
  }

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
            mountPip(pip.document)
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
      panelSize={panelSize} stealth={stealth} minimized={minimized}
      onStealth={onStealth} onMinimize={onMinimize}
      onResize={onResize} onDrag={onDrag}
      onEnd={data => {
        setSessionNotes(data); setPhase('notes')
        // Persist to Past Sessions (transcript + feedback) like Solo, if we scored it.
        if (data?.report && data?.conversation?.length) {
          try { saveSession({ report: data.report, transcript: data.conversation, config: { domainLabel: (sessionConfig?.profile?.targetRole) || 'Live interview' }, profile: sessionConfig?.profile || {} }) } catch {}
        }
      }}
      screenAnalysis={screenAnalysis} screenAnalyzing={screenAnalyzing} onDismissScreen={onDismissScreen}
      codingDetected={codingDetected} onCaptureScreen={onCaptureScreen} onReanalyze={onReanalyze}
      onPipActive={onPipActive}
    />
  )
}
