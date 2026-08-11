import React, { useState, useRef, useEffect, useCallback } from 'react'
import { apiFetch } from './lib/apiClient'
import { useSystemAudio, shouldTriggerHint } from './useSystemAudio'
import SoloFeedback from './SoloFeedback'
import { T } from './auth/tokens'
import { isManaged } from './lib/aiMode'
import { getAutoSkip, getAnswerStyle, setAnswerStyle as persistAnswerStyle } from './lib/aiSettings'
import { retrieveContext, warmDocs, addDoc } from './lib/docs'
import Documents from './Documents'
import { OverlayPanel, ScreenAnalysisPanel, IconBtn } from './App'
import ApiKeysPanel from './ApiKeys'
import { saveSession } from './history'
import { loadProfile, saveProfile } from './lib/profile'
import { fmtClock } from './lib/ui'
import { LANGUAGES, STT_LANG, CODING_LANGUAGES } from './lib/languages'
import { estimateCost } from './cost'
import { extractPdfText } from './pdf'
import { mountPip } from './pip'
import { mergeTurns, normalizeQ, isStragglerDuplicate } from './lib/transcript'
import { glanceLayers } from '../shared/hintLayers.js'
import { createSessionMetrics } from './lib/sessionMetrics'
import { createSessionId, createGeneration } from './lib/sessionGen'

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
const THINKING_BY_LANG = {
  Spanish: 'Pensando…',
  French: 'Réflexion…',
  German: 'Denke nach…',
  Portuguese: 'Pensando…',
  Hindi: 'सोच रहा हूँ…',
  Japanese: '考え中…',
  Chinese: '思考中…',
  Korean: '생각 중…',
  Arabic: 'جارٍ التفكير…',
  Italian: 'Sto pensando…',
  Dutch: 'Even nadenken…',
}

function thinkingLabel(language = 'English') {
  if (language !== 'English' && THINKING_BY_LANG[language]) return THINKING_BY_LANG[language]
  return 'Thinking…'
}


// Simple markdown → JSX: bold, bullets, section headers
const CODE_BLOCK_STYLE = { margin: '6px 0', padding: '10px 12px', background: 'rgba(0,0,0,0.55)', border: `1px solid ${T.borderStrong}`, borderRadius: 8, overflowX: 'auto', fontFamily: 'Menlo, Consolas, monospace', fontSize: 11.5, lineHeight: 1.55, color: T.text1, whiteSpace: 'pre' }

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
          <span style={{ color: T.accentFrom, flexShrink: 0, marginTop: 2, fontSize: 10 }}>▸</span>
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
      ? <strong key={i} style={{ color: T.text1, fontWeight: 700 }}>{p.slice(2, -2)}</strong>
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
  const [linuxAck, setLinuxAck] = useState(false)
  const [shareVerified, setShareVerified] = useState(false)
  const isLinux = typeof window !== 'undefined' && window.electronAPI?.platform === 'linux'
  const inElectron = typeof window !== 'undefined' && !!window.electronAPI
  // BYOK with no LLM configured → hints would error on every question mid-call. Block Start and say why.
  const noLLM = !managed && providers.length === 0 && models.length === 0
  const canStart = dgAvailable && !noLLM && !!inElectron && (isLinux ? linuxAck : shareVerified)
  // Mic preflight is amber (may hear you); SysAudio on Win/mac is green.
  const micMode = sourceId === 'microphone'
  const audioPreflightColor = micMode ? '#fbbf24' : (isLinux ? '#fbbf24' : '#4ade80')

  const inp = { width: '100%', background: T.surface2, border: `1px solid ${T.border}`, color: T.text1, padding: '10px 12px', borderRadius: T.rCtrl, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: T.font }
  const preflightOk = (ok) => ok ? '#4ade80' : '#f87171'

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text1, fontFamily: T.font, overflowY: 'auto' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: T.text1 }}>Live Interview</div>
            <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>Verify share preview, then start. The overlay stays glanceable over your call.</div>
          </div>
          <button onClick={onHome} style={{ height: 38, padding: '0 16px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 13, cursor: 'pointer', fontFamily: T.font }}>← Back</button>
        </div>

        {/* Preflight — clear pass/fail before a real interview */}
        <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 8 }}>Preflight</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
            <div style={{ color: preflightOk(dgAvailable) }}>{dgAvailable ? '✓' : '✗'} Deepgram (required for Live)</div>
            <div style={{ color: preflightOk(!noLLM) }}>{noLLM ? '✗' : '✓'} AI model {managed ? '(Managed / auto-route)' : '(BYOK)'}</div>
            <div style={{ color: audioPreflightColor }}>
              {micMode
                ? '⚠ Microphone — may hear you; auto-hints wait for speaker lock (prefer System Audio on Win/macOS)'
                : isLinux
                  ? '⚠ System Audio unavailable on Linux — use Microphone'
                  : '✓ System Audio — hears the interviewer (recommended)'}
            </div>
            <div style={{ color: isLinux ? '#fbbf24' : (inElectron ? '#4ade80' : '#fbbf24') }}>
              {isLinux
                ? '⚠ Overlay stealth NOT supported on Linux — visible in screen share'
                : inElectron
                  ? '✓ Content protection available (Win/macOS) — still verify share preview'
                  : '⚠ Browser/dev mode — Live Start blocked (no screen-capture protection)'}
            </div>
          </div>
        </div>

        {!inElectron && (
          <div role="alert" style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#fca5a5' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Live Start blocked</div>
            <div>Live Interview needs the desktop app (Electron) for system audio + content protection. Open MockMate from the installed app, not a browser tab.</div>
          </div>
        )}

        {inElectron && !isLinux && (
          <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: T.text2 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#4ade80' }}>Verify share preview</div>
            <div style={{ marginBottom: 8, lineHeight: 1.45 }}>Before a real interview: open your meeting share preview and confirm the MockMate overlay does <strong style={{ color: T.text1 }}>not</strong> appear in what others see.</div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={shareVerified} onChange={e => setShareVerified(e.target.checked)} style={{ marginTop: 2 }} />
              <span>I verified in share preview — MockMate did not appear in what others would see.</span>
            </label>
          </div>
        )}

        {isLinux && (
          <div role="alert" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#fbbf24' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Linux: overlay will appear in screen share</div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', color: T.text2 }}>
              <input type="checkbox" checked={linuxAck} onChange={e => setLinuxAck(e.target.checked)} style={{ marginTop: 2 }} />
              <span>I understand MockMate is visible in screen share on Linux and I still want to start (practice only / I accept the risk).</span>
            </label>
          </div>
        )}

        {!dgAvailable && (
          <div role="alert" style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#fca5a5' }}>
            ⚠ Live needs a <strong>Deepgram key</strong> to transcribe the interviewer. Add one in <strong>Settings → Voice</strong>, then come back.
          </div>
        )}
        {dgAvailable && noLLM && (
          <div role="alert" style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#fca5a5' }}>
            ⚠ No AI model configured — hints would fail on every question. Add an AI key in <strong>Settings</strong> (or switch to MockMate AI when hosted Managed is available), then come back.
          </div>
        )}

        {/* Audio — needed before Start; keep above the fold */}
        <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text2, marginBottom: 8 }}>Audio source</div>
          {(() => {
            const systemId = audioSources.find(s => /screen|entire|display/i.test(s.name))?.id || 'microphone'
            const onMic = sourceId === 'microphone'
            return (
              <div style={{ fontSize: 12.5, color: T.text2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{onMic ? '🎤 Microphone' : '🖥️ System Audio'} <span style={{ color: T.text3 }}>· {onMic ? 'may hear you until speaker lock' : 'hears the interviewer (recommended on Win/macOS)'}</span></span>
                {!isLinux && (
                  <button type="button" onClick={() => setSourceId(onMic ? systemId : 'microphone')}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: T.accentFrom, cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0, fontFamily: T.font }}>
                    {onMic ? 'Use System Audio' : 'Use microphone instead'}
                  </button>
                )}
              </div>
            )
          })()}
        </div>

        <button disabled={!canStart} onClick={() => {
          if (profile.resume?.trim()) addDoc({ name: 'Resume', type: 'resume', text: profile.resume })
          if (profile.jobDescription?.trim()) addDoc({ name: 'Job Description', type: 'jd', text: profile.jobDescription })
          onStart({ profile, sourceId, provider: managed ? '' : provider })
        }}
          style={{ height: 48, background: canStart ? T.accent : T.surface2, color: canStart ? '#fff' : T.text3, border: 'none', borderRadius: T.rCtrl, fontSize: 15, fontWeight: 600, cursor: canStart ? 'pointer' : 'default', fontFamily: T.font }}>
          Start Live →
        </button>
        {!canStart && (
          <div style={{ fontSize: 11.5, color: T.text3, marginTop: -4 }}>
            {!inElectron ? 'Open the desktop app to start.'
              : !dgAvailable ? 'Add Voice (Deepgram) in Settings first.'
              : noLLM ? 'Configure an AI model in Settings first.'
              : isLinux ? 'Acknowledge the Linux screen-share risk above.'
              : 'Check the share-preview box above to enable Start.'}
          </div>
        )}

        <Section n={1} title="Interview" subtitle="Optional — name, role, company" defaultOpen={false}>
        <Field label="Your name"><input style={inp} value={profile.name || ''} placeholder="e.g. Charan" onChange={e => patch({ name: e.target.value })} /></Field>
        <Field label="Target role"><input style={inp} value={profile.targetRole || ''} placeholder="e.g. Senior AI Engineer" onChange={e => patch({ targetRole: e.target.value })} /></Field>
        <Field label="Target company (sharpens 'why us' answers + web search)"><input style={inp} value={profile.targetCompany || ''} placeholder="e.g. Stripe" onChange={e => patch({ targetCompany: e.target.value })} /></Field>
        </Section>

        <Section n={2} title="Documents & context" subtitle="Optional — resume, JD, files" defaultOpen={false}>
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
        <Field label="Documents (retrieves relevant parts per question)">
          <Documents />
        </Field>
        <Field label="Your voice & instructions (optional — shapes every answer)">
          <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={profile.customPrompt || ''}
            placeholder="e.g. 'Senior eng, talk like I'm chatting with a peer — casual, confident, short. Lean on my fintech work. Avoid buzzwords.'"
            onChange={e => patch({ customPrompt: e.target.value })} />
        </Field>
        </Section>

        <Section n={3} title="More options" subtitle="Model, language, coding" defaultOpen={false}>
        {!managed && (
          <Field label="AI model">
            <select style={inp} value={provider} onChange={e => setProvider(e.target.value)} disabled={!providers.length && !models.length}>
              {!providers.length && !models.length && <option value="">No models yet — add a key in Settings</option>}
              {models.length > 0
                ? models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)
                : providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>Manage keys in <strong style={{ color: T.text2 }}>Settings</strong>.</div>
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
function LiveOverlay({ profile, sourceId, provider: initialProvider, onEnd, panelSize, stealth, minimized, onStealth, onMinimize, onResize, onDrag, onSizePreset, opacity, onOpacity, screenAnalysis, screenAnalyzing, onDismissScreen, codingDetected, onCaptureScreen, onReanalyze, onPipActive, pip: initialPip, clickThrough, onClickThrough }) {
  const [transcript, setTranscript] = useState([])
  const [hint, setHint] = useState(null)
  const [hintLoading, setHintLoading] = useState(false)
  const [buyTimePhrase, setBuyTimePhrase] = useState('') // holds thinkingLabel only (never a scripted "Say:" line)
  const [manualQ, setManualQ] = useState('') // last candidate/interviewer text awaiting Answer this
  const [switchingAudio, setSwitchingAudio] = useState(false)
  const [pipWindow, setPipWindow] = useState(initialPip || null)
  const [pipProtected, setPipProtected] = useState(true)  // false → show warning banner
  const pipSupported = typeof window !== 'undefined' && !!window.documentPictureInPicture
  const bcRef = useRef(null)   // BroadcastChannel to sync state to PiP window
  const [streaming, setStreaming] = useState(false)
  const [usage, setUsage] = useState({ tokens: 0, cost: 0 })   // session token/cost burn (BYOK gauge)
  const [coachMode, setCoachMode] = useState(false)   // 💬 Answer (full answer) ↔ 🎓 Coach (structure only)
  const coachModeRef = useRef(false)
  // Answer verbosity — same SOT as Settings (`getAnswerStyle` / `persistAnswerStyle`).
  const [answerStyle, setAnswerStyle] = useState(() => getAnswerStyle())
  const answerStyleRef = useRef(getAnswerStyle())
  const [clock, setClock] = useState(0)
  const [error, setError] = useState('')
  const [extraContext, setExtraContext] = useState('')
  const [expandedAnswers, setExpandedAnswers] = useState(() => new Set()) // question text → full expand
  const extraContextRef = useRef('')

  const sessionIdRef = useRef(createSessionId())
  const hintGen = useRef(createGeneration('hint'))
  const sessionActiveRef = useRef(true)
  const pendingManualQ = useRef('')
  const lastHintText = useRef('')
  const hintInFlight = useRef(false)  // prevent double API calls
  const hintIncompleteRef = useRef(false)
  const hintAbortRef = useRef(null)   // aborts the in-flight /api/hint when a new question arrives
  const lockTimerRef = useRef(null)   // replaces the window._mockmateLockTimeout global
  const postMetaTimerRef = useRef(null)
  const profileRef = useRef(profile)
  const providerRef = useRef(initialProvider)
  const liveSourceIdRef = useRef(sourceId)
  const diarizationLockedRef = useRef(false)
  const degradedRef = useRef(false)
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
  const metricsRef = useRef(null)
  const hintTimingRef = useRef(null)

  useEffect(() => { extraContextRef.current = extraContext }, [extraContext])
  useEffect(() => { coachModeRef.current = coachMode }, [coachMode])   // so generateHint (a [] useCallback closure) reads the live value
  useEffect(() => { answerStyleRef.current = answerStyle; persistAnswerStyle(answerStyle) }, [answerStyle])

  useEffect(() => {
    bcRef.current = new BroadcastChannel('mockmate-live')
    sessionActiveRef.current = true
    return () => {
      sessionActiveRef.current = false
      hintGen.current.bump()
      bcRef.current?.close()
      try { pipWindow?.close() } catch {}
      clearInterval(streamTimer.current)
      // Abort any in-flight /api/hint so its .then() can't setState after unmount
      // (e.g. ending the session while an answer is still streaming/loading).
      try { hintAbortRef.current?.abort() } catch {}
      clearTimeout(lockTimerRef.current)
      clearTimeout(postMetaTimerRef.current)
      clearTimeout(finalDebounce.current)
      stopSpeaking()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function openProtectedPip() {
    if (!window.documentPictureInPicture) return
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 440, height: 620 })
      pip.document.title = 'MockMate — Protected'
      pip.document.body.style.cssText = `margin:0;padding:0;background:${T.bg};font-family:${T.font};color:${T.text1};overflow-y:auto;`
      mountPip(pip.document)
      pip.addEventListener('pagehide', () => setPipWindow(null))
      setPipWindow(pip)
      // Sync current state immediately
      bcRef.current?.postMessage({ type: 'init', transcript, hint, hintLoading, buyTimePhrase, lastQ: lastHintText.current, streaming })
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

  // Hint generation — generation ids so superseded/unmounted work never lands.
  async function generateHint(question, { force } = {}) {
    if (!question) return
    const sameQ = question === lastHintText.current
    if (!force && sameQ && hintInFlight.current) return
    if (!force && sameQ && !hintIncompleteRef.current) return
    if (force) hintIncompleteRef.current = false

    // Bump first so prior in-flight work fails isCurrent(); capture gen AFTER bump.
    const gen = hintGen.current.bump()
    const isCurrent = () => sessionActiveRef.current && hintGen.current.isCurrent(gen)

    // Cancel previous request/timers
    clearTimeout(lockTimerRef.current)
    clearTimeout(postMetaTimerRef.current)
    try { hintAbortRef.current?.abort() } catch {}
    const abort = new AbortController()
    hintAbortRef.current = abort
    lastHintText.current = question
    hintInFlight.current = true
    setManualQ('')
    pendingManualQ.current = ''

    let incomplete = false
    let gotToken = false
    const markIncomplete = (answer, hintObj, reason) => {
      incomplete = true
      hintIncompleteRef.current = true
      metricsRef.current?.markIncomplete?.()
      if (!isCurrent()) return
      const text = (answer || '').trimEnd()
      const patched = text ? `${text}\n\n[incomplete — ${reason}]` : ''
      const h = { ...(hintObj || { confidence: 'general' }), fullAnswer: answer || '', incomplete: true }
      if (patched) upsert({ answer: patched, hint: h })
      else upsert({ hint: h })
      setHint(prev => (prev ? { ...prev, incomplete: true } : h))
      setError(`Hint timed out — tap Retry`)
    }

    // Hard backstop: abort fetch + clear loading; mark incomplete if any answer.
    const lockTimeout = setTimeout(() => {
      if (!isCurrent()) return
      try { abort.abort() } catch {}
      hintInFlight.current = false
      setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
      if (gotToken || incomplete) markIncomplete(lastAnswer, lastHintObj, 'timed out')
      else {
        hintIncompleteRef.current = true
        incomplete = true
        setError('Hint timed out — tap Retry')
        upsert({ hint: { confidence: 'general', fullAnswer: '', incomplete: true } })
      }
    }, 30000)
    lockTimerRef.current = lockTimeout

    let lastAnswer = ''
    let lastHintObj = null

    if (isCurrent()) {
      setBuyTimePhrase(thinkingLabel(profileRef.current?.language))
      setHint(null)
      setStreaming(false)
      clearInterval(streamTimer.current)
      setHintLoading(true)
      setError(e => (e === 'Hint timed out — tap Retry' ? '' : e))
    }

    // Prior conversation turns (interviewer Qs + what YOU said) for LLM context — excludes
    // the current question (already pushed to convoRef) so it isn't sent twice.
    const priorTurns = () => {
      const h = convoRef.current
      const prior = (h.length && h[h.length - 1]?.text === question) ? h.slice(0, -1) : h
      return prior.slice(-12)
    }

    // Upsert the feed entry for this question (covers the early-trigger-then-onFinal case).
    const upsert = patch => {
      if (!isCurrent()) return
      setTranscript(t => t.some(s => s.text === question)
        ? t.map(s => s.text === question ? { ...s, ...patch } : s)
        : [...t, { text: question, ts: Date.now(), isQuestion: true, answer: '', ...patch }])
    }

    const clearTimers = () => {
      clearTimeout(lockTimeout)
      clearTimeout(postMetaTimerRef.current)
    }

    const finalize = (answer, hintObj) => {
      if (!isCurrent()) return
      if (incomplete || hintIncompleteRef.current) return // never finalize over an incomplete upsert
      clearTimers()
      setStreaming(false); setHintLoading(false); hintInFlight.current = false
      setBuyTimePhrase('')
      hintIncompleteRef.current = false
      const layers = glanceLayers(answer, hintObj || {})
      const finalHint = {
        ...(hintObj || { confidence: 'general' }),
        opener: layers.opener,
        keyPoints: layers.keyPoints,
        fullAnswer: layers.fullAnswer || answer,
        sampleAnswer: layers.fullAnswer || answer,
        incomplete: false,
      }
      setHint(finalHint)
      upsert({ isQuestion: true, answer: layers.fullAnswer || answer, hint: finalHint })
    }
    const resetSkip = () => {
      if (!isCurrent()) return
      clearTimers()
      setHintLoading(false); setStreaming(false); hintInFlight.current = false
      lastHintText.current = ''; setBuyTimePhrase(''); hintIncompleteRef.current = false
    }

    const armPostMetaWatchdog = () => {
      clearTimeout(postMetaTimerRef.current)
      postMetaTimerRef.current = setTimeout(() => {
        if (!isCurrent() || gotToken) return
        try { abort.abort() } catch {}
        hintInFlight.current = false
        setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
        markIncomplete('', lastHintObj, 'no tokens after meta')
      }, 20000)
    }

    // Document RAG — reuse speculative embed from debounce when the question matches.
    const spec = ragSpec.current
    const ragContext = (spec.q === question && spec.p)
      ? await spec.p.catch(() => '')
      : await retrieveContext(question, { budgetMs: 600 }).catch(() => '')
    if (ragSpec.current === spec) ragSpec.current = { q: '', p: null }
    if (!isCurrent()) return
    const mergedContext = () => [extraContextRef.current, ragContext].filter(Boolean).join('\n\n') || undefined

    // SAFETY NET — proven non-streaming endpoint (must pass mode + style).
    const runFallback = async () => {
      if (!isCurrent()) return
      const res = await apiFetch('/api/hint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({
          question, profile: profileRef.current, conversationHistory: priorTurns(),
          provider: providerRef.current, language: profileRef.current?.language || 'English',
          extraContext: mergedContext(), mode: coachModeRef.current ? 'coach' : 'answer',
          style: answerStyleRef.current, autoSkip: getAutoSkip(),
        })
      })
      const d = await res.json()
      if (!isCurrent()) return
      if (d.error) throw new Error(d.error)
      const h = d.hint
      if (!h || h.skip) { metricsRef.current?.markSkip?.(); resetSkip(); return }
      metricsRef.current?.markFirstToken?.(hintTimingRef.current)
      gotToken = true
      finalize(h.fullAnswer || h.sampleAnswer || '', h)
    }

    hintTimingRef.current = metricsRef.current?.startHint?.() || null
    try {
      const res = await apiFetch('/api/hint-stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({
          question, profile: profileRef.current, conversationHistory: priorTurns(),
          provider: providerRef.current, language: profileRef.current?.language || 'English',
          extraContext: mergedContext(), mode: coachModeRef.current ? 'coach' : 'answer',
          style: answerStyleRef.current, autoSkip: getAutoSkip(),
        })
      })
      if (!isCurrent()) return
      if (!res.ok || !res.body) { metricsRef.current?.markFallback?.(); await runFallback(); return }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let sseBuf = '', answer = '', hintObj = null

      reading: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!isCurrent()) { try { await reader.cancel() } catch {}; return }
        sseBuf += decoder.decode(value, { stream: true })
        let nn
        while ((nn = sseBuf.indexOf('\n\n')) !== -1) {
          const raw = sseBuf.slice(0, nn); sseBuf = sseBuf.slice(nn + 2)
          const ev = raw.match(/^event: (.*)$/m)?.[1]
          let data; try { data = JSON.parse(raw.match(/^data: ([\s\S]*)$/m)?.[1] ?? 'null') } catch { data = null }
          if (!isCurrent()) { try { await reader.cancel() } catch {}; return }

          if (ev === 'meta') {
            clearTimeout(lockTimeout)
            hintObj = {
              confidence: data?.confidence === 'resume' ? 'resume' : 'general',
              questionType: data?.type, pattern: data?.pattern || null,
              complexity: data?.complexity || null, watchOut: data?.watch || null,
              _searchSources: data?.searchSources, fullAnswer: '', sampleAnswer: ''
            }
            lastHintObj = hintObj
            if (isCurrent()) {
              setHint(hintObj); setHintLoading(false); setStreaming(true)
              upsert({ isQuestion: true, answer: '', hint: hintObj })
              armPostMetaWatchdog()
            }
          } else if (ev === 'token') {
            if (!isCurrent()) { try { await reader.cancel() } catch {}; return }
            if (!answer) metricsRef.current?.markFirstToken?.(hintTimingRef.current)
            gotToken = true
            clearTimeout(postMetaTimerRef.current)
            answer += typeof data === 'string' ? data : ''
            lastAnswer = answer
            // Glance layers on every token so main + PiP stay opener-first while streaming.
            const layers = glanceLayers(answer, hintObj || {})
            const liveHint = {
              ...(hintObj || { confidence: 'general' }),
              opener: layers.opener,
              keyPoints: layers.keyPoints,
              fullAnswer: answer,
            }
            upsert({ answer, hint: liveHint })
            setHint(liveHint)
          } else if (ev === 'usage') {
            if (!isCurrent()) continue
            const u = data || {}
            setUsage(s => ({ tokens: s.tokens + (u.input || 0) + (u.output || 0), cost: s.cost + estimateCost(u.model, u.input || 0, u.output || 0) }))
          } else if (ev === 'skip') {
            if (!isCurrent()) { try { await reader.cancel() } catch {}; return }
            metricsRef.current?.markSkip?.()
            resetSkip()
            try { await reader.cancel() } catch {}; return
          } else if (ev === 'error') {
            if (answer.trim()) {
              incomplete = true
              hintIncompleteRef.current = true
              metricsRef.current?.markIncomplete?.()
              if (isCurrent()) {
                const layers = glanceLayers(answer, hintObj || {})
                upsert({
                  answer: answer.trimEnd() + '\n\n[incomplete — connection/provider error]',
                  hint: { ...(hintObj || { confidence: 'general' }), opener: layers.opener, keyPoints: layers.keyPoints, fullAnswer: answer, incomplete: true },
                })
                setHint(h => h ? { ...h, incomplete: true } : { confidence: 'general', incomplete: true })
              }
            }
            try { await reader.cancel() } catch {}
            break reading
          }
        }
      }

      if (!isCurrent()) return
      // If incomplete already upserted, skip finalize that would clear incomplete.
      if (incomplete || hintIncompleteRef.current) {
        hintInFlight.current = false
        if (isCurrent()) {
          setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
        }
        clearTimers()
        return
      }
      if (!answer.trim()) { metricsRef.current?.markFallback?.(); await runFallback(); return }
      finalize(answer, hintObj)
    } catch (e) {
      if (e.name === 'AbortError') {
        // Superseded / unmounted: never touch UI (new gen owns it).
        // Timed-out current gen: incomplete path already mutated under isCurrent.
        if (!isCurrent()) return
        if (incomplete) {
          hintInFlight.current = false
          setHintLoading(false); setStreaming(false); setBuyTimePhrase('')
        }
        return
      }
      try { await runFallback() }
      catch (e2) {
        if (e2.name === 'AbortError') return
        if (!isCurrent()) return
        clearTimers()
        setHintLoading(false); setStreaming(false)
        hintInFlight.current = false
        hintIncompleteRef.current = true
        setBuyTimePhrase('')
        metricsRef.current?.markError?.(e2.message || e.message)
        setError(e2.message || e.message)
      }
    }
  }

  const onEarlyQuestion = useCallback((text, meta) => {
    if (!sessionActiveRef.current) return
    if (meta?.isCandidate) return   // never hint on candidate speech
    const trimmed = text.trim()
    if (!trimmed || trimmed.split(/\s+/).length < 4) return
    // Thinking label only — no scripted buy-time phrase. Skip if a hint is already in flight
    // for a different question (stale early from a previous utterance).
    if (hintInFlight.current) return
    setBuyTimePhrase(thinkingLabel(profileRef.current?.language))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onFinal = useCallback((text, meta) => {
    if (!sessionActiveRef.current) return
    const trimmed = text.trim()
    // Diarization: this was YOU speaking. Don't generate an answer to your own voice — but
    // DO record what you said, so the end-of-session review is the REAL conversation.
    if (meta?.isCandidate && !meta?.isQuestion) {
      if (trimmed && trimmed.split(/\s+/).length >= 2) convoRef.current.push({ role: 'candidate', text: trimmed, ts: Date.now() })
      return
    }
    if (meta?.isCandidate) return   // never hint if meta.isCandidate
    // Allow short follow-ups ("Why?") through — shouldTriggerHint softens after a prior Q.
    if (!trimmed) return
    const w = trimmed.split(/\s+/).filter(Boolean).length
    if (w < 3 && !/\?\s*$/.test(trimmed)) return
    // Coalesce fragments first; gate on the FULL coalesced string so we don't burn tokens on chatter.
    pendingQ.current = pendingQ.current ? `${pendingQ.current} ${trimmed}` : trimmed
    clearTimeout(finalDebounce.current)
    const terminal = /\?\s*$/.test(pendingQ.current)
    if (terminal) {
      const specQ = pendingQ.current.trim()
      ragSpec.current = { q: specQ, p: retrieveContext(specQ, { budgetMs: 600 }).catch(() => '') }
    }
    finalDebounce.current = setTimeout(() => {
      const q = pendingQ.current.trim(); pendingQ.current = ''
      if (!q) return
      const hadPriorQuestion = convoRef.current.some(t => t.role === 'interviewer')
      const gateMeta = {
        ...meta,
        hadPriorQuestion,
        diarizationLocked: diarizationLockedRef.current || meta?.diarizationLocked,
        degraded: degradedRef.current || meta?.degraded,
      }
      if (!shouldTriggerHint(q, gateMeta)) return
      if (isStragglerDuplicate(q, lastHintText.current)) { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); return }
      convoRef.current.push({ role: 'interviewer', text: q, ts: Date.now() })

      const isMic = liveSourceIdRef.current === 'microphone'
      // Mic mode: suppress auto-hints until diarization locked and not degraded.
      if (isMic && !(diarizationLockedRef.current && !degradedRef.current)) {
        pendingManualQ.current = q
        setManualQ(q)
        setTranscript(t => t.some(s => s.text === q)
          ? t
          : [...t, { text: q, ts: Date.now(), isQuestion: true, answer: undefined }])
        return
      }
      generateHint(q)
    }, terminal ? 250 : 450)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [liveSourceId, setLiveSourceId] = useState(sourceId)
  const audio = useSystemAudio(onFinal, reason => { metricsRef.current?.markError?.(reason); setError(`Transcription stopped: ${reason}`) }, onEarlyQuestion, () => metricsRef.current?.markSttReconnect?.())

  useEffect(() => { liveSourceIdRef.current = liveSourceId }, [liveSourceId])
  useEffect(() => {
    diarizationLockedRef.current = !!audio.diarizationLocked
    degradedRef.current = !!audio.degraded
  }, [audio.diarizationLocked, audio.degraded])

  function audioOpts() {
    return {
      keyterms: resumeKeyterms(profileRef.current),
      language: STT_LANG[profileRef.current?.language] || 'en-US',
    }
  }

  function retryTranscription() {
    setError('')
    audio.restart(liveSourceId, audioOpts()).catch(e => setError(`Could not restart transcription: ${e.message || e}`))
  }

  async function switchAudioSource() {
    const isLinux = window.electronAPI?.platform === 'linux'
    const next = liveSourceId === 'microphone' ? 'system' : 'microphone'
    if (next === 'system' && isLinux) {
      setError('System Audio is not available on Linux — staying on Microphone')
      return
    }
    let id = next
    if (next === 'system') {
      const srcs = await window.electronAPI?.getAudioSources?.() || []
      id = srcs.find(s => /screen|entire|display/i.test(s.name))?.id || 'microphone'
      if (id === 'microphone') {
        setError('System Audio not available — staying on Microphone')
        return
      }
    }
    setError('')
    setSwitchingAudio(true)
    setLiveSourceId(id === 'microphone' ? 'microphone' : id)
    try {
      await audio.restart(id, audioOpts())
    } catch (e) {
      setError(`Could not switch audio: ${e.message || e}`)
    } finally {
      setSwitchingAudio(false)
    }
  }

  // Sync all state to the PiP window whenever anything changes. Declared AFTER
  // `audio` so audio.active is in scope and can be a real dependency — otherwise
  // the PiP "Listening / Not capturing" indicator goes stale on reconnect/stop.
  useEffect(() => {
    if (!pipWindow || pipWindow.closed) return
    bcRef.current?.postMessage({
      type: 'update',
      transcript, hint, hintLoading, buyTimePhrase,
      lastQ: lastHintText.current,
      active: audio.active,
      streaming,
    })
  }, [transcript, hint, hintLoading, buyTimePhrase, pipWindow, audio.active, streaming]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    audio.start(liveSourceId, audioOpts())
    warmDocs()   // pre-embed uploaded docs now so the FIRST question is grounded (not just Q2+)
    metricsRef.current = createSessionMetrics('live')
    hintTimingRef.current = null
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
    try { metricsRef.current?.end({ tokens: usage.tokens, cost: usage.cost }) } catch {}
    metricsRef.current = null
    sessionActiveRef.current = false
    hintGen.current.bump()

    audio.stop(); stopSpeaking()
    clearTimeout(finalDebounce.current)
    clearTimeout(postMetaTimerRef.current)
    try { hintAbortRef.current?.abort() } catch {}
    // The REAL conversation: interviewer questions + what YOU actually said (diarized),
    // NOT the AI's suggested answers. Merge consecutive same-speaker segments into clean turns.
    const conversation = mergeTurns(convoRef.current)
    if (conversation.length === 0) { onEnd(); return }

    const hasCandidate = conversation.some(t => t.role === 'candidate')
    if (!hasCandidate) {
      // Pair interviewer turns with overlay AI hints so notes can show "hints below".
      const withHints = []
      for (const turn of conversation) {
        withHints.push(turn)
        if (turn.role === 'interviewer') {
          const match = transcript.find(s => s.isQuestion && s.text === turn.text && (s.answer || s.hint?.fullAnswer))
          const hintText = (match?.answer || match?.hint?.fullAnswer || '').trim()
          if (hintText) withHints.push({ role: 'hint', text: hintText, ts: turn.ts })
        }
      }
      onEnd({
        conversation: withHints.length ? withHints : conversation,
        report: {
          summary: 'No candidate speech was captured (System Audio hears the interviewer only, or Mic diarization never locked). Hints are below — this is not a scored interview.',
          overallScore: null,
          dimensions: [],
          strengths: [],
          improvements: ['Use Microphone with diarization lock, or speak so your answers are captured for a real score.'],
        },
      })
      return
    }

    setEnding(true)
    try {
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
  const isLinuxLive = typeof window !== 'undefined' && window.electronAPI?.platform === 'linux'
  const statusColor = switchingAudio ? '#f59e0b' : audio.active ? '#22c55e' : audio.reconnecting ? '#f59e0b' : '#ef4444'
  const statusLabel = switchingAudio ? 'Switching…' : audio.active ? 'Listening' : audio.reconnecting ? 'Reconnecting' : 'Paused'
  const titleExtra = (
    <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, boxShadow: `0 0 6px ${statusColor}`, animation: audio.active && !switchingAudio ? 'pulse 1.6s ease-in-out infinite' : 'none' }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
      <span style={{ fontSize: 11, color: T.text3, fontFamily: 'monospace' }}>{fmtClock(clock)}</span>
      {/* Hide Sys↔Mic switch on Linux (System Audio unavailable). */}
      {!isLinuxLive && (
        <button type="button" onClick={switchAudioSource} disabled={switchingAudio}
          title="Switch audio source mid-session (System Audio ↔ Microphone)"
          style={{ fontSize: 10, padding: '2px 7px', background: 'rgba(255,255,255,0.06)', color: T.text2, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, cursor: switchingAudio ? 'default' : 'pointer', opacity: switchingAudio ? 0.6 : 1 }}>
          {liveSourceId === 'microphone' ? '🎤 Mic' : '🖥️ Sys'}
        </button>
      )}
    </div>
  )

  // The only Live-specific action: content-protected PiP (verify in share preview — matrix UNKNOWN).
  const liveActions = pipSupported ? (
    <IconBtn icon="shield" active={!!pipWindow}
      onClick={pipWindow ? () => { pipWindow.close(); setPipWindow(null) } : openProtectedPip}
      title={pipWindow ? 'Protected window ON — verify it stays out of your share preview' : 'Open protected window — verify in share preview (browser matrix UNKNOWN)'} />
  ) : null

  if (ending) {
    return (
      <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} onStealth={onStealth}
        onMinimize={onMinimize} onResize={onResize} onDrag={onDrag} onSizePreset={onSizePreset}
        opacity={opacity} onOpacity={onOpacity}
        clickThrough={false} onClickThrough={onClickThrough}
        onClose={() => {}} extra={<span style={{ fontSize: 11, fontWeight: 600, color: '#5eead4' }}>Ending…</span>}>
        <div role="status" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text1 }}>Wrapping up…</div>
          <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.45 }}>Building your notes. This is not a fake score — wait a moment.</div>
        </div>
      </OverlayPanel>
    )
  }

  return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} onStealth={onStealth} actions={liveActions} confirmClose
      onMinimize={onMinimize} onResize={onResize} onDrag={onDrag} onSizePreset={onSizePreset}
      opacity={opacity} onOpacity={onOpacity}
      clickThrough={clickThrough} onClickThrough={onClickThrough}
      onClose={endSession} extra={titleExtra}>
      {/* ── Single scrollable chat feed ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column' }}>
        {error && (
          <div role="alert" style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 5, padding: '5px 8px', fontSize: 10, color: '#fca5a5', marginBottom: 6, lineHeight: 1.4 }}>
            ⚠ {error.includes('rate-limit') || error.includes('quota') ? 'API rate limited — try again or check Settings' : error}
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
              {/transcription|deepgram|connection|captur|token grant|audio/i.test(error) && (
                <>
                  <button onClick={retryTranscription}
                    style={{ background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.4)', color: '#5eead4', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>
                    Retry transcription
                  </button>
                  {!isLinuxLive && (
                    <button onClick={switchAudioSource}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: T.text2, borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>
                      Switch to {liveSourceId === 'microphone' ? 'System Audio' : 'Mic'}
                    </button>
                  )}
                </>
              )}
              <button onClick={() => { setError(''); hintInFlight.current = false; lastHintText.current = '' }}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
            </div>
          </div>
        )}

        {/* Coding platform auto-detected → one tap to capture + solve (no surprise auto-captures) */}
        {codingDetected && !screenAnalyzing && !screenAnalysis && (
          <button type="button" onClick={() => onCaptureScreen?.()}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 8, padding: '9px 11px', marginBottom: 8, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}>
            <span style={{ fontSize: 15 }}>💻</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>Coding question detected</div>
              <div style={{ fontSize: 10, color: T.text3 }}>Tap to read the screen and get a solution · or press Ctrl+Shift+U</div>
            </div>
            <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700, background: 'rgba(34,197,94,0.15)', padding: '4px 10px', borderRadius: 6 }}>Solve it →</span>
          </button>
        )}

        <ScreenAnalysisPanel analysis={screenAnalysis} analyzing={screenAnalyzing} onDismiss={onDismissScreen} onReanalyze={onReanalyze} onRecapture={onCaptureScreen} />

        {/* PiP active banner */}
        {pipWindow && !pipWindow.closed && pipProtected && (
          <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🛡️</span>
            <div>
              <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>Protected window active</div>
              <div style={{ fontSize: 10, color: T.text3 }}>Hints are in a content-protected window — verify in your share preview before a real interview</div>
            </div>
            <button onClick={() => { pipWindow.close(); setPipWindow(null) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
        )}

        {/* Warning: screen protection could not be applied — user must know */}
        {pipWindow && !pipWindow.closed && !pipProtected && (
          <div role="alert" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 12, color: '#f87171', fontWeight: 700 }}>Content protection unavailable — verify share preview</div>
              <div style={{ fontSize: 10, color: T.text3 }}>This window may appear in screen share. Restart MockMate or keep hints in the main overlay and verify preview.</div>
            </div>
          </div>
        )}

        {/* Empty state with status + keyboard shortcuts */}
        {transcript.length === 0 && !hintLoading && !audio.interim && (
          <div style={{ padding: '16px 4px' }}>
            {/* Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: audio.active ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${audio.active ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: audio.active ? '#22c55e' : '#ef4444', boxShadow: audio.active ? '0 0 8px #22c55e' : 'none', flexShrink: 0, animation: audio.active ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: audio.active ? '#4ade80' : audio.reconnecting ? '#f59e0b' : '#f87171', fontWeight: 700 }}>{audio.active ? 'Listening' : audio.reconnecting ? 'Reconnecting…' : 'Not capturing'}</div>
                <div style={{ fontSize: 10, color: T.text3 }}>
                  {!audio.active && !audio.reconnecting
                    ? 'Transcription stopped — retry or check Deepgram in Settings → Voice'
                    : audio.reconnecting
                      ? 'Connection dropped — restoring automatically'
                      : liveSourceId === 'microphone'
                        ? (audio.diarizationLocked && !audio.degraded
                          ? 'Speaker locked — auto-hints on'
                          : 'Listening — auto-hints after speaker lock, or tap Answer this')
                        : 'Listening for the interviewer…'}
                </div>
              </div>
              {!audio.active && !audio.reconnecting && (
                <button onClick={retryTranscription}
                  style={{ background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.4)', color: '#5eead4', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  Retry
                </button>
              )}
            </div>

            <div style={{ fontSize: 12, color: T.text3, lineHeight: 1.6, marginBottom: 14 }}>
              {liveSourceId === 'microphone'
                ? 'On mic, wait for speaker lock (or tap Answer this). Read the hint and answer in your own words.'
                : 'Hints appear when the interviewer asks a question. Read and respond in your own words.'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                ['Alt+H', 'Collapse / expand pill (icon stays on screen)'],
                ['— / eye', 'Collapse to pill · click pill to restore'],
                ['S / M / L', 'HUD sizes · compact by default'],
                ['◐ slider', 'Transparency'],
                ['Ctrl+Shift+U', 'Screenshot → solve coding question'],
                ['📌 pin', 'Pinned: stays when switching apps · Unpinned: hides on blur'],
              ].map(([key, desc]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#2dd4bf', background: 'rgba(13,148,136,0.15)', padding: '2px 7px', borderRadius: 5, fontFamily: 'monospace', fontWeight: 600, minWidth: 92, textAlign: 'center' }}>{key}</span>
                  <span style={{ fontSize: 11, color: T.text3 }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mic waiting for lock — Answer this for the queued question */}
        {manualQ && liveSourceId === 'microphone' && !(audio.diarizationLocked && !audio.degraded) && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, padding: '9px 11px', marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700, marginBottom: 3 }}>Waiting for speaker lock</div>
              <div style={{ fontSize: 12, color: T.text1, lineHeight: 1.4 }}>❓ {manualQ}</div>
            </div>
            <button type="button" onClick={() => generateHint(manualQ, { force: true })}
              style={{ background: 'rgba(94,234,212,0.15)', border: '1px solid rgba(94,234,212,0.4)', color: '#5eead4', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
              Answer this
            </button>
          </div>
        )}

        {/* ── Chat: each confirmed question + its answer ── */}
        {transcript.filter(s => s.isQuestion).map((s, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            {/* Q bubble */}
            <div style={{ fontSize: 12, color: T.text1, background: 'rgba(255,255,255,0.06)', borderRadius: '0 8px 8px 8px', padding: '7px 11px', marginBottom: 6, lineHeight: 1.5 }}>
              ❓ {s.text}
            </div>
            {/* A bubble (or incomplete stub with Retry) */}
            {s.hint && (s.answer !== undefined || s.hint.incomplete) && (
              <div style={{ marginLeft: 10 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  {s.hint.incomplete && <span style={badge('rgba(251,191,36,0.2)', '#fbbf24')}>⚠ INCOMPLETE</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                    {s.hint.incomplete && (
                      <button type="button" onClick={() => generateHint(s.text, { force: true })} style={btn('rgba(251,191,36,0.15)', '#fbbf24')}>Retry</button>
                    )}
                    <button onClick={() => navigator.clipboard?.writeText(s.hint.fullAnswer || s.hint.sampleAnswer || '')} style={btn('rgba(255,255,255,0.04)', T.text3)} title="Copy answer">📋</button>
                  </div>
                </div>
                {s.hint.resumeStory && <div style={{ borderLeft: '2px solid #4ade80', paddingLeft: 7, fontSize: 10, color: '#86efac', marginBottom: 6, fontStyle: 'italic' }}>{s.hint.resumeStory}</div>}
                {(() => {
                  const streamingThis = streaming && s.text === lastHintText.current
                  const layers = glanceLayers(s.answer || '', s.hint || {})
                  const expanded = expandedAnswers.has(s.text)
                  const showBullets = layers.keyPoints.length > 0
                  return (
                    <div role="log" aria-live="polite" aria-label="Suggested answer" style={{ fontSize: 13, color: s.hint.confidence === 'resume' ? '#dcfce7' : '#e8eaf0', background: s.hint.confidence === 'resume' ? 'rgba(6,30,18,0.96)' : 'rgba(20,18,32,0.96)', border: `1px solid ${s.hint.confidence === 'resume' ? 'rgba(34,197,94,0.3)' : 'rgba(13,148,136,0.32)'}`, borderRadius: '8px 8px 8px 0', padding: '10px 12px', lineHeight: 1.55, userSelect: 'text', WebkitUserSelect: 'text' }}>
                      {/* Opener-first while streaming — not a full markdown wall */}
                      <div style={{ fontWeight: 600, marginBottom: showBullets ? 8 : 0, lineHeight: 1.45 }}>
                        {layers.opener || (streamingThis ? '…' : '…')}
                        {streamingThis && <span style={{ display: 'inline-block', width: 2, height: '0.9em', background: T.accentFrom, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'blink 0.7s step-end infinite' }} />}
                      </div>
                      {showBullets && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                          {layers.keyPoints.map((pt, bi) => (
                            <div key={bi} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5, color: s.hint.confidence === 'resume' ? '#bbf7d0' : T.text1 }}>
                              <span style={{ color: T.accentFrom, flexShrink: 0, marginTop: 2, fontSize: 10 }}>▸</span>
                              <span>{pt}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {!streamingThis && ((layers.fullAnswer || '').length > (layers.opener || '').length + 40) && (
                        expanded ? (
                          <>
                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, marginTop: 2, lineHeight: 1.7 }}>{renderMd(layers.fullAnswer || s.answer || '')}</div>
                            <button type="button" onClick={() => setExpandedAnswers(prev => { const n = new Set(prev); n.delete(s.text); return n })}
                              style={{ background: 'none', border: 'none', color: '#5eead4', fontSize: 11, cursor: 'pointer', padding: '6px 0 0', fontWeight: 600 }}>Collapse</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setExpandedAnswers(prev => new Set(prev).add(s.text))}
                            style={{ background: 'none', border: 'none', color: '#5eead4', fontSize: 11, cursor: 'pointer', padding: '2px 0 0', fontWeight: 600 }}>Expand full answer</button>
                        )
                      )}
                    </div>
                  )
                })()}
                {s.hint.watchOut && <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>⚠ {s.hint.watchOut}</div>}
              </div>
            )}
          </div>
        ))}

        {/* Currently loading — Thinking… only (no scripted Say:) */}
        {hintLoading && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: T.text2, background: 'rgba(255,255,255,0.05)', borderRadius: '0 8px 8px 8px', padding: '7px 11px', marginBottom: 6 }}>
              ❓ {lastHintText.current}
            </div>
            <div style={{ marginLeft: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 7, padding: '7px 10px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 11, color: '#5eead4', marginBottom: 4, fontWeight: 600 }}>{buyTimePhrase || thinkingLabel(profileRef.current?.language)}</div>
              <div style={{ height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '40%', background: `linear-gradient(90deg,${T.accentFrom},#3b82f6)`, animation: 'slide 1.2s ease-in-out infinite' }} />
              </div>
            </div>
          </div>
        )}

        {audio.interim && <div style={{ fontSize: 11, color: T.text3, fontStyle: 'italic', marginBottom: 4, paddingLeft: 4 }}>… {audio.interim}</div>}
        <div ref={bottomRef} />

        {/* Secondary controls — collapsed so glance path stays opener + bullets */}
        <details style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <summary style={{ listStyle: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', color: T.text3, userSelect: 'none' }}>
            OPTIONS {coachMode ? '· COACH' : ''}{answerStyle !== 'concise' ? ` · ${answerStyle.toUpperCase()}` : ''}{extraContext ? ' · CTX' : ''}{usage.tokens > 0 ? ` · ${(usage.tokens / 1000).toFixed(1)}k` : ''}
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setAnswerStyle(s => s === 'concise' ? 'balanced' : s === 'balanced' ? 'detailed' : 'concise')}
                title="Answer length — Concise (fastest glance) · Balanced · Detailed"
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: answerStyle === 'balanced' ? 'rgba(255,255,255,0.04)' : 'rgba(20,184,166,0.15)', border: `1px solid ${answerStyle === 'balanced' ? 'rgba(255,255,255,0.1)' : 'rgba(20,184,166,0.4)'}`, color: answerStyle === 'balanced' ? T.text2 : '#5eead4', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', borderRadius: 100, padding: '3px 9px', cursor: 'pointer' }}>
                {answerStyle === 'concise' ? '⚡ CONCISE' : answerStyle === 'detailed' ? '📖 DETAILED' : '⚖ BALANCED'}
              </button>
              <button type="button" onClick={() => {
                const next = !coachModeRef.current
                coachModeRef.current = next
                setCoachMode(next)
                const q = lastHintText.current
                if (q) generateHint(q, { force: true })
              }}
                title="Coach = structure; Answer = full spoken answer"
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: coachMode ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${coachMode ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.1)'}`, color: coachMode ? '#4ade80' : T.text2, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', borderRadius: 100, padding: '3px 9px', cursor: 'pointer' }}>
                {coachMode ? '🎓 COACH' : '💬 ANSWER'}
              </button>
              {usage.tokens > 0 && (
                <span title={`This session: ${usage.tokens.toLocaleString()} tokens · est. $${usage.cost.toFixed(3)}`}
                  style={{ fontSize: 10, color: T.text3, fontFamily: 'monospace', marginLeft: 'auto' }}>
                  {(usage.tokens / 1000).toFixed(1)}k tok · ~${usage.cost.toFixed(2)}
                </span>
              )}
            </div>
            <textarea value={extraContext} onChange={e => setExtraContext(e.target.value)}
              placeholder="Extra context — e.g. 'Focus on Python' · 'System design round'"
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(20,184,166,0.25)', borderRadius: 5, color: T.text1, fontSize: 10, padding: '5px 7px', resize: 'vertical', minHeight: 44, outline: 'none', fontFamily: T.font, lineHeight: 1.5, boxSizing: 'border-box' }} rows={2} />
          </div>
        </details>
      </div>
    </OverlayPanel>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function LiveCompanion({ onHome, onPhaseChange, panelSize, stealth, minimized, onStealth, onMinimize, onResize, onDrag, onSizePreset, opacity, onOpacity, screenAnalysis, screenAnalyzing, onDismissScreen, codingDetected, onCaptureScreen, onReanalyze, onPipActive, clickThrough, onClickThrough }) {
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
      onStart={config => {
        // Do not auto-open Protected/PiP — user opens it explicitly from the live overlay.
        setSessionConfig({ ...config, pip: null })
        setPhase('live')
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
      onResize={onResize} onDrag={onDrag} onSizePreset={onSizePreset}
      opacity={opacity} onOpacity={onOpacity}
      onEnd={data => {
        setSessionNotes(data); setPhase('notes')
        // Persist to Sessions only when we actually scored candidate speech.
        if (data?.report && data.report.overallScore != null && data?.conversation?.length) {
          try { saveSession({ report: data.report, transcript: data.conversation, config: { domainLabel: (sessionConfig?.profile?.targetRole) || 'Live interview' }, profile: sessionConfig?.profile || {} }) } catch {}
        }
      }}
      screenAnalysis={screenAnalysis} screenAnalyzing={screenAnalyzing} onDismissScreen={onDismissScreen}
      codingDetected={codingDetected} onCaptureScreen={onCaptureScreen} onReanalyze={onReanalyze}
      onPipActive={onPipActive}
      clickThrough={clickThrough} onClickThrough={onClickThrough}
    />
  )
}
