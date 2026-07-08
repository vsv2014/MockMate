import React, { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from './lib/apiClient'
import Solo from './Solo'
import LiveCompanion from './LiveCompanion'
import Jobs from './Jobs'
import Career from './Career'
import Account from './Account'
import AuthGate from './auth/AuthGate'
import { T } from './auth/tokens'
import { AppShell, DashboardHome, SessionsTable } from './Dashboard'
import SoloFeedback from './SoloFeedback'
import ApiKeysPanel from './ApiKeys'
import { getAiMode } from './lib/aiMode'
import { loadSessions, deleteSession } from './history'
import { scoreColor, TYPE_LABEL } from './lib/ui'
import { CODING_LANGUAGES } from './lib/languages'

const inElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron
const isLinux = typeof window !== 'undefined' && window.electronAPI?.platform === 'linux'

// Views that render in the full windowed app shell (large window + sidebar). Solo runs
// here too — there's no interviewer watching, so it gets the roomy dashboard, not the
// overlay. ONLY the Live companion drops to the compact always-on-top overlay.
const SHELL_VIEWS = ['home', 'solo', 'jobs', 'career', 'settings', 'account', 'history']

// ── Not in Electron — show landing page ──────────────────────────────────────
function BrowserGate() {
  // Redirect to the landing page served from public/
  window.location.replace('/landing.html')
  return null
}

// ── Electron shell — wraps every screen in the floating overlay ───────────────
function ElectronShell({ auth }) {
  const [view, setView] = useState('home')
  const [report, setReport] = useState(null)
  const [panelSize, setPanelSize] = useState({ w: 420, h: 560 })
  const [opacity, setOpacity] = useState(1)   // solid by default for readability; the slider can dim it
  const [stealth, setStealth] = useState(false)
  const [clickThrough, setClickThrough] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [screenAnalysis, setScreenAnalysis] = useState(null)   // vision analysis result
  const [screenAnalyzing, setScreenAnalyzing] = useState(false)
  const profileRef = useRef({})
  const resizing = useRef(false)
  const resizeStart = useRef({})

  useEffect(() => {
    // Transparent body — no dark rectangle if panel is hidden
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  }, [])

  const [noProviders, setNoProviders] = useState(false)
  const [meetingActive, setMeetingActive] = useState(false)
  const [codingDetected, setCodingDetected] = useState(false)
  const [browserShareWarning, setBrowserShareWarning] = useState(false)
  const recheckProviders = useCallback(() => {
    apiFetch('/api/providers').then(r => r.json()).then(d => {
      setNoProviders(!d.providers?.length)
    }).catch(() => {})
  }, [])
  useEffect(() => { recheckProviders() }, [recheckProviders])

  // First-run welcome: show once, only when no keys exist yet. Dismissed permanently
  // after the user saves a key or taps "Skip", so returning users never see it.
  const [welcomed, setWelcomed] = useState(() => { try { return localStorage.getItem('mm-welcomed') === '1' } catch { return false } })
  const dismissWelcome = useCallback(() => { try { localStorage.setItem('mm-welcomed', '1') } catch {} ; setWelcomed(true) }, [])
  // Managed AI needs no setup, so the first-run "connect a key" gate only applies to BYOK mode.
  const showWelcome = getAiMode() === 'byok' && !welcomed && noProviders

  // Past Solo sessions (stored locally, ~3 months) — for review/copy.
  const [sessions, setSessions] = useState(() => loadSessions())
  const [openSession, setOpenSession] = useState(null)
  const refreshSessions = useCallback(() => setSessions(loadSessions()), [])

  // Auto-detect meeting apps (Zoom, Teams, Meet) + coding platforms (LeetCode, etc.)
  useEffect(() => {
    const cleanups = []
    cleanups.push(window.electronAPI?.onMeetingDetected(active => setMeetingActive(active)))
    cleanups.push(window.electronAPI?.onCodingDetected?.(active => setCodingDetected(active)))
    cleanups.push(window.electronAPI?.onShortcutStealth?.(() => setStealth(s => !s)))
    // Browser mode: warn if screen capture is likely active (getDisplayMedia check)
    if (!window.electronAPI?.isElectron) {
      navigator.mediaDevices?.addEventListener?.('devicechange', () => setBrowserShareWarning(true))
    }
    return () => cleanups.forEach(c => c?.())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Run vision analysis on a screenshot (optionally in a chosen coding language).
  const lastShotRef = useRef(null)
  const runAnalysis = useCallback(async (base64, language) => {
    if (!base64) return
    setScreenAnalyzing(true)
    setScreenAnalysis(null)
    try {
      const d = await apiFetch('/api/analyze-screen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, profile: profileRef.current, language })
      }).then(r => r.json())
      setScreenAnalysis(d.analysis || { error: d.error })
    } catch (e) {
      setScreenAnalysis({ error: e.message })
    }
    setScreenAnalyzing(false)
  }, [])

  // Re-solve the SAME captured screen in a different language (no re-capture).
  const reanalyze = useCallback((language) => { if (lastShotRef.current) runAnalysis(lastShotRef.current, language) }, [runAnalysis])

  // Listen for screen captures (Ctrl+Shift+U or "Solve it" button) from Electron
  useEffect(() => {
    const cleanup = window.electronAPI?.onScreenCaptured((base64) => {
      lastShotRef.current = base64       // remember it so language switching can re-solve
      runAnalysis(base64)
    })
    return () => cleanup?.()
  }, [runAnalysis])

  // Resize + stealth keyboard shortcut
  useEffect(() => {
    const onMove = e => {
      if (!resizing.current) return
      setPanelSize({
        w: Math.max(360, resizeStart.current.w + e.clientX - resizeStart.current.x),
        h: Math.max(200, resizeStart.current.h + e.clientY - resizeStart.current.y)
      })
    }
    const onUp = () => { resizing.current = false }
    // Alt+H in browser only (Electron handles it via global shortcut in main.cjs)
    const onKey = e => { if (e.altKey && e.key === 'h' && !inElectron) handleStealthToggle() }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function handleStealthToggle() {
    if (inElectron) {
      // Electron: hide the entire OS window — completely gone from screen and screen share
      // Press Alt+H again to restore (global shortcut registered in main.cjs)
      window.electronAPI.hideWindow()
    } else {
      // Browser: just dim (can't fully protect without Electron)
      setStealth(s => !s)
    }
  }

  function startDrag(e) {
    const onMove = ev => {
      window.electronAPI.windowDrag(ev.screenX - lastX, ev.screenY - lastY)
      lastX = ev.screenX; lastY = ev.screenY
    }
    let lastX = e.screenX, lastY = e.screenY
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.preventDefault()
  }

  function startResize(e) {
    resizing.current = true
    resizeStart.current = { x: e.clientX, y: e.clientY, w: panelSize.w, h: panelSize.h }
    e.stopPropagation(); e.preventDefault()
  }

  function goHome() { setReport(null); setOpenSession(null); refreshSessions(); setView('home') }
  function openHistory() { refreshSessions(); setOpenSession(null); setView('history') }

  // Live sub-phase (setup | live | notes), reported by LiveCompanion — drives window sizing.
  const [companionPhase, setCompanionPhase] = useState('setup')

  // Resize the OS window: full dashboard for shell views + Live setup/feedback; compact
  // invisible overlay for the live interview itself.
  useEffect(() => {
    let mode
    if (view === 'companion') mode = companionPhase === 'live' ? 'overlay' : 'app'
    else mode = (!showWelcome && SHELL_VIEWS.includes(view)) ? 'app' : 'overlay'
    window.electronAPI?.setWindowMode?.(mode)
  }, [view, showWelcome, companionPhase])

  // The sessions list is a snapshot — refresh it when the Sessions tab opens so a
  // just-finished interview shows up without navigating away and back.
  useEffect(() => { if (view === 'history') refreshSessions() }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── First-run welcome — guide a brand-new user straight to adding a key ──
  if (showWelcome) return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} opacity={opacity} onOpacity={setOpacity}
      onDrag={startDrag} onResize={startResize}
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)} clickThrough={clickThrough} onClickThrough={() => setClickThrough(c => !c)}
      onClose={dismissWelcome} title="Connect your AI" autoHeight>
      <div style={{ padding: '14px 16px 16px', fontFamily: T.font }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: T.text1, marginBottom: 4 }}>Connect your AI</div>
        <div style={{ fontSize: 12.5, color: T.text2, lineHeight: 1.55, marginBottom: 12 }}>
          One last step — add at least one AI key to power your interviews. Keys stay <strong style={{ color: T.text1 }}>on this machine</strong> and unlock every mode.
        </div>
        <ApiKeysPanel onSaved={() => { recheckProviders(); dismissWelcome() }} />
        <button onClick={dismissWelcome}
          style={{ width: '100%', marginTop: 12, height: 40, background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: T.font }}>
          Skip for now — I'll add keys later
        </button>
        <div style={{ fontSize: 10, color: T.text3, textAlign: 'center', marginTop: 8 }}>You can always manage keys from Home → ⚙ API Keys &amp; Settings.</div>
      </div>
    </OverlayPanel>
  )

  // ── Full windowed app shell (dashboard + sidebar) for the management views ──
  if (SHELL_VIEWS.includes(view)) {
    const shellHeader = { fontSize: 20, fontWeight: 600, color: T.text1, marginBottom: 4 }
    let content = null
    if (view === 'home') content = (
      <>
        <ScreenAnalysisPanel analysis={screenAnalysis} analyzing={screenAnalyzing} onDismiss={() => setScreenAnalysis(null)} onReanalyze={reanalyze} />
        <DashboardHome auth={auth} sessions={sessions} noProviders={noProviders}
          onNav={setView} onCapture={() => window.electronAPI?.captureScreen?.()} />
      </>
    )
    else if (view === 'solo') content = <Solo onHome={goHome} />
    else if (view === 'jobs') content = <div style={{ maxWidth: 820, margin: '0 auto' }}><div style={shellHeader}>Matching Jobs</div><Jobs onHome={goHome} noProviders={noProviders} /></div>
    else if (view === 'career') content = <div style={{ maxWidth: 820, margin: '0 auto' }}><div style={shellHeader}>Resume Studio</div><Career onHome={goHome} noProviders={noProviders} onSettings={() => setView('settings')} /></div>
    else if (view === 'settings') content = (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={shellHeader}>Settings</div>
        <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.5, marginBottom: 16 }}>Choose how MockMate gets its AI. <strong>MockMate AI</strong> is managed for you — nothing to set up. Power users can bring their own keys.</div>
        <ApiKeysPanel showStatus onSaved={recheckProviders} onModeChange={recheckProviders} />
        <div style={{ marginTop: 18, padding: '14px 16px', background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>App updates</div>
            <div style={{ fontSize: 11.5, color: T.text2, marginTop: 2 }}>MockMate updates automatically in the background. Check now to see what's available.</div>
          </div>
          <button onClick={() => window.electronAPI?.checkForUpdates?.()}
            style={{ height: 36, padding: '0 16px', background: 'transparent', color: T.text1, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: T.font, whiteSpace: 'nowrap' }}>Check for updates</button>
        </div>
      </div>
    )
    else if (view === 'account') content = <div style={{ maxWidth: 640, margin: '0 auto' }}><div style={shellHeader}>Account</div><Account auth={auth} noProviders={noProviders} onManageKeys={() => setView('settings')} /></div>
    else if (view === 'history') content = (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {openSession ? (
          <SoloFeedback report={openSession.report} transcript={openSession.transcript}
            onAgain={() => setOpenSession(null)} onAgainLabel="← Back to sessions" />
        ) : (
          <>
            <div style={shellHeader}>Past Sessions</div>
            <SessionsTable sessions={sessions} onOpen={s => setOpenSession(s)}
              onDelete={id => { deleteSession(id); refreshSessions() }} />
          </>
        )}
      </div>
    )

    return (
      <AppShell active={view} onNav={setView} auth={auth} meetingActive={meetingActive}
        stealth={stealth} onStealth={handleStealthToggle}
        onMinimize={() => window.electronAPI?.hideWindow?.()} onClose={() => window.close?.()}>
        {content}
      </AppShell>
    )
  }

  // Live Interview is the only view that renders as the compact floating overlay — everything
  // else lives in the dashboard shell (handled above).
  if (view === 'companion') return (
    <LiveCompanion onHome={goHome} onPhaseChange={setCompanionPhase} panelSize={panelSize} stealth={stealth} opacity={opacity} onOpacity={setOpacity}
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)} clickThrough={clickThrough} onClickThrough={() => setClickThrough(c => !c)}
      onResize={startResize} onDrag={startDrag}
      screenAnalysis={screenAnalysis} screenAnalyzing={screenAnalyzing} onDismissScreen={() => setScreenAnalysis(null)}
      codingDetected={codingDetected} onCaptureScreen={() => window.electronAPI?.captureScreen?.()}
      onReanalyze={reanalyze}
      onPipActive={active => setStealth(active)} />
  )

  return null   // every other view is handled by the dashboard shell above
}

// Lightweight, dependency-free syntax highlighter — generic across Python/JS/
// Java/C++/Go/TS. Tokenizes comments, strings, numbers, and common keywords;
// good enough for a read-at-a-glance hint, no heavy library in the bundle.
const CODE_KEYWORDS = new Set([
  'function','def','return','if','else','elif','for','while','class','const','let','var',
  'int','long','float','double','void','bool','boolean','char','string','str','public','private',
  'protected','static','new','import','from','export','async','await','try','catch','except',
  'finally','throw','throws','raise','break','continue','in','of','is','not','and','or','None',
  'null','nil','true','false','True','False','this','self','super','struct','func','fn','package',
  'interface','type','enum','switch','case','default','do','lambda','yield','with','as','typeof',
  'instanceof','extends','implements','abstract','final','override','val','var','print','println','echo'
])
function highlightCode(code) {
  const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|([^\sA-Za-z0-9_$]+)/g
  const out = []
  let m, i = 0
  while ((m = re.exec(code)) !== null) {
    let color = '#e6edf3'
    if (m[1]) color = '#8b949e'                              // comment
    else if (m[2]) color = '#a5d6ff'                         // string
    else if (m[3]) color = '#79c0ff'                         // number
    else if (m[4]) color = CODE_KEYWORDS.has(m[4]) ? '#ff7b72' : '#e6edf3'  // keyword / identifier
    out.push(<span key={i++} style={{ color }}>{m[0]}</span>)
  }
  return out
}

// ── Code block with one-tap copy + syntax highlighting — the core of Coding mode ──
export function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(code || '')
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div style={{ background: '#0d1117', border: '1px solid #1f2733', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderBottom: '1px solid #1f2733', background: 'rgba(255,255,255,0.02)' }}>
        <span style={{ fontSize: 10, color: '#7d8590', fontFamily: 'monospace' }}>{language || 'code'}</span>
        <button onClick={copy} style={{ marginLeft: 'auto', background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)', color: copied ? '#4ade80' : '#94a3b8', border: 'none', borderRadius: 5, padding: '2px 9px', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '10px 12px', overflowX: 'auto', maxHeight: 260 }}>
        <code style={{ fontFamily: "'Menlo','Consolas',monospace", fontSize: 12, lineHeight: 1.6, color: '#e6edf3', whiteSpace: 'pre' }}>{highlightCode(code || '')}</code>
      </pre>
    </div>
  )
}

// ── Screen Analysis Panel — shown when Ctrl+Shift+U is pressed ───────────────
export function ScreenAnalysisPanel({ analysis, analyzing, onDismiss, onReanalyze, onRecapture }) {
  if (!analyzing && !analysis) return null
  const isCoding = analysis?.contentType === 'coding'
  // Coding mode uses a green/dev accent; everything else keeps the amber capture accent.
  const accent = isCoding ? 'rgba(34,197,94,0.25)' : 'rgba(234,179,8,0.25)'
  const accentBg = isCoding ? 'rgba(34,197,94,0.06)' : 'rgba(234,179,8,0.08)'
  return (
    <div style={{ background: accentBg, border: `1px solid ${accent}`, borderRadius: 10, padding: '12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: isCoding ? '#4ade80' : '#fbbf24' }}>{isCoding ? '💻 Coding Solution' : '📸 Screen Analysis'}</span>
        <span style={{ fontSize: 9, color: '#64748b', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 8 }}>Ctrl+Shift+U</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {onRecapture && <button onClick={onRecapture} title="Re-capture the screen" style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>↻</button>}
          <button onClick={onDismiss} title="Dismiss" style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      </div>
      {analyzing
        ? <div style={{ fontSize: 12, color: '#92400e' }}>Analyzing screen…</div>
        : analysis?.error
          ? <div style={{ fontSize: 12, color: '#f87171' }}>⚠ {analysis.error}</div>
          : isCoding
            ? (
              <>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {analysis.pattern && <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(20,184,166,0.3)', color: '#99f6e4', borderRadius: 10, fontWeight: 700 }}>⚡ {analysis.pattern}</span>}
                  {analysis.complexity && <span style={{ fontSize: 9, padding: '2px 8px', background: '#0d1117', color: '#7ee787', borderRadius: 10, fontFamily: 'monospace' }}>{analysis.complexity}</span>}
                  {analysis.language && <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', borderRadius: 10 }}>{analysis.language}</span>}
                </div>
                {analysis.detectedText && <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', marginBottom: 8, borderLeft: '2px solid rgba(34,197,94,0.3)', paddingLeft: 7 }}>{analysis.detectedText}</div>}
                {/* Language switcher — re-solve the same screen in another language, no re-capture */}
                {onReanalyze && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {CODING_LANGUAGES.map(lang => {
                      const on = (analysis.language || '').toLowerCase() === lang.toLowerCase()
                      return (
                        <button key={lang} onClick={() => onReanalyze(lang)} title={`Solve in ${lang}`}
                          style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', border: 'none', fontWeight: 600,
                            background: on ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)', color: on ? '#4ade80' : '#64748b' }}>{lang}</button>
                      )
                    })}
                  </div>
                )}
                {Array.isArray(analysis.approach) && analysis.approach.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>APPROACH</div>
                    {analysis.approach.map((step, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3, fontSize: 12, color: '#cbd5e1' }}>
                        <span style={{ color: '#4ade80', flexShrink: 0 }}>{i + 1}.</span><span>{step}</span>
                      </div>
                    ))}
                  </div>
                )}
                {analysis.code && <CodeBlock code={analysis.code} language={analysis.language} />}
                {Array.isArray(analysis.edgeCases) && analysis.edgeCases.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 4 }}>EDGE CASES</div>
                    {analysis.edgeCases.map((ec, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>• {ec}</div>
                    ))}
                  </div>
                )}
                {analysis.watchOut && <div style={{ fontSize: 11, color: '#f59e0b' }}>⚠ {analysis.watchOut}</div>}
              </>
            )
            : analysis && (
              <>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontSize: 9, padding: '1px 7px', background: 'rgba(234,179,8,0.15)', color: '#fbbf24', borderRadius: 10, fontWeight: 700 }}>{TYPE_LABEL[analysis.contentType] || analysis.contentType}</span>
                </div>
                {analysis.detectedText && <div style={{ fontSize: 11, color: '#a16207', fontStyle: 'italic', marginBottom: 8, borderLeft: '2px solid rgba(234,179,8,0.3)', paddingLeft: 7 }}>{analysis.detectedText}</div>}
                {analysis.resumeStory && <div style={{ fontSize: 11, color: '#86efac', borderLeft: '2px solid #4ade80', paddingLeft: 7, marginBottom: 8 }}>{analysis.resumeStory}</div>}
                <div style={{ fontSize: 14, color: '#fef3c7', lineHeight: 1.7, marginBottom: 8 }}>{analysis.fullAnswer}</div>
                {analysis.watchOut && <div style={{ fontSize: 11, color: '#f59e0b' }}>⚠ {analysis.watchOut}</div>}
              </>
            )
      }
    </div>
  )
}

// Clean, evenly-sized icon button with a tooltip (shows the shortcut). Big enough
// to hit under interview pressure; no cryptic text labels.
// Inline SVG icons — emoji glyphs render as empty boxes on Linux (no color-emoji
// font is guaranteed), so every header icon is a real vector that draws on any OS.
function Glyph({ name }) {
  const p = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'eye':      return <svg {...p}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
    case 'minimize': return <svg {...p}><line x1="5" y1="12" x2="19" y2="12" /></svg>
    case 'expand':   return <svg {...p}><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
    case 'stop':     return <svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
    case 'close':    return <svg {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
    case 'shield':   return <svg {...p}><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /></svg>
    default:         return <span style={{ fontSize: 14 }}>{name}</span>
  }
}

export function IconBtn({ icon, title, onClick, active, danger }) {
  const [hover, setHover] = useState(false)
  const base = danger ? '#f87171' : active ? '#4ade80' : '#94a3b8'
  const bg = hover ? (danger ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.1)')
    : active ? 'rgba(34,197,94,0.14)' : 'transparent'
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-pressed={active || undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: bg, color: base, border: 'none', borderRadius: 7, cursor: 'pointer',
        fontSize: 14, lineHeight: 1, transition: 'background 0.12s', flexShrink: 0
      }}><Glyph name={icon} /></button>
  )
}

// ── Score trend — dependency-free inline SVG line chart of recent session scores ──
// Renders nothing until there are at least 2 scored sessions (a single point isn't a
// trend). Uses a uniform-scaled viewBox so dots stay circular at any panel width.
function ScoreTrend({ sessions }) {
  const all = (sessions || []).filter(s => typeof s.score === 'number')
  if (all.length < 2) return null
  const scored = all.slice().reverse().slice(-20)   // oldest → newest, most recent 20
  const truncated = all.length > scored.length
  const n = scored.length
  const W = 300, H = 96, padX = 12, padTop = 10, padBot = 16
  const xAt = i => padX + (n === 1 ? (W - 2 * padX) / 2 : i * (W - 2 * padX) / (n - 1))
  const yAt = v => padTop + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - padTop - padBot)
  const pts = scored.map((s, i) => ({ x: xAt(i), y: yAt(s.score), s }))
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const avg = Math.round(scored.reduce((a, s) => a + s.score, 0) / n)
  const delta = scored[n - 1].score - scored[0].score
  const fmt = ts => { try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '' } }
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Score trend</span>
        <span style={{ fontSize: 10, color: '#64748b' }}>avg {avg}</span>
        <span style={{ fontSize: 10, color: delta >= 0 ? '#4ade80' : '#f87171' }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} since {truncated ? 'shown start' : 'first'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[75, 50].map(g => (
          <g key={g}>
            <line x1={padX} x2={W - padX} y1={yAt(g)} y2={yAt(g)} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 3" />
            <text x={W - padX} y={yAt(g) - 2} fontSize="7" fill="#475569" textAnchor="end">{g}</text>
          </g>
        ))}
        <path d={line} fill="none" stroke="rgba(45,212,191,0.75)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.6" fill={scoreColor(p.s.score)} stroke="#0a0a12" strokeWidth="1">
            <title>{`${p.s.score}/100 · ${fmt(p.s.ts)}${p.s.label ? ' · ' + p.s.label : ''}`}</title>
          </circle>
        ))}
        <text x={padX} y={H - 3} fontSize="7" fill="#475569" textAnchor="start">{fmt(scored[0].ts)}</text>
        <text x={W - padX} y={H - 3} fontSize="7" fill="#475569" textAnchor="end">{fmt(scored[n - 1].ts)}</text>
      </svg>
    </div>
  )
}

export function OverlayPanel({ children, panelSize, stealth, minimized, onDrag, onResize, onStealth, onMinimize, onClose, title, extra, actions, opacity = 0.95, autoHeight, clickThrough, confirmClose }) {
  const [confirming, setConfirming] = useState(false)
  const confirmTimer = useRef(null)
  // 📌 Pin — keep the overlay above full-screen Zoom/Meet. Persisted so it survives
  // view changes, and re-asserted on mount so the window matches the saved state.
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem('mm-pinned') === '1' } catch { return false } })
  useEffect(() => { if (inElectron) window.electronAPI?.setPin?.(pinned) }, [pinned])
  function togglePin() {
    setPinned(p => { const v = !p; try { localStorage.setItem('mm-pinned', v ? '1' : '0') } catch {} ; return v })
  }
  function handleClose() {
    if (!confirmClose) return onClose?.()
    if (confirming) { clearTimeout(confirmTimer.current); onClose?.(); return }
    setConfirming(true)
    confirmTimer.current = setTimeout(() => setConfirming(false), 3000)
  }
  return (
    <div id="mockmate-overlay" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0,
        width: panelSize.w,
        height: (minimized || autoHeight) ? 'auto' : panelSize.h,
        background: 'rgba(8,9,14,0.96)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        boxShadow: '0 16px 64px rgba(0,0,0,0.85)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        opacity: stealth ? 0.2 : opacity,
        transition: 'opacity 0.1s',
        pointerEvents: clickThrough ? 'none' : 'all',
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        userSelect: 'none'
      }}>
        {/* Header — status/title on the left, a tidy icon toolbar on the right */}
        <div onMouseDown={onDrag} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 7px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.25)', cursor: 'grab', flexShrink: 0
        }}>
          {extra
            ? <div onMouseDown={e => e.stopPropagation()}>{extra}</div>
            : <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.88)', fontWeight: 600, fontFamily: T.font }}>{title || 'MockMate'}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }} onMouseDown={e => e.stopPropagation()}>
            {actions}
            {inElectron && (
              <button onClick={togglePin} onMouseDown={e => e.stopPropagation()}
                title={pinned ? 'Pinned above full-screen apps — click to unpin' : 'Pin above full-screen apps (Zoom/Meet)'}
                aria-label={pinned ? 'Unpin overlay from above full-screen apps' : 'Pin overlay above full-screen apps'} aria-pressed={pinned}
                style={{ height: 28, width: 28, display: 'grid', placeItems: 'center', background: pinned ? 'rgba(13,148,136,0.35)' : 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, opacity: pinned ? 1 : 0.6 }}>📌</button>
            )}
            <IconBtn icon="eye" onClick={onStealth} title={inElectron ? 'Hide overlay  (Alt+H)' : 'Dim  (Alt+H)'} />
            <IconBtn icon={minimized ? 'expand' : 'minimize'} onClick={onMinimize} title={minimized ? 'Expand' : 'Minimize'} />
            {confirming
              ? <button onClick={handleClose} onMouseDown={e => e.stopPropagation()} title="Confirm end"
                  style={{ height: 28, padding: '0 10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>End?</button>
              : <IconBtn icon={confirmClose ? 'stop' : 'close'} onClick={handleClose} danger title={confirmClose ? 'End interview' : 'Close'} />}
          </div>
        </div>

        {!minimized && children}

        {/* Resize handle */}
        {!minimized && (
          <div onMouseDown={onResize} style={{
            position: 'absolute', bottom: 0, right: 0, width: 14, height: 14,
            cursor: 'se-resize',
            background: 'linear-gradient(135deg,transparent 50%,rgba(255,255,255,0.08) 50%)',
            borderRadius: '0 0 12px 0'
          }} />
        )}
      </div>

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        #mockmate-overlay button:focus-visible, #mockmate-overlay a:focus-visible, #mockmate-overlay input:focus-visible, #mockmate-overlay select:focus-visible, #mockmate-overlay textarea:focus-visible{outline:2px solid #2dd4bf;outline-offset:2px;border-radius:6px}
        #mockmate-overlay *{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.18) transparent}
        #mockmate-overlay ::-webkit-scrollbar{width:6px;height:6px}
        #mockmate-overlay ::-webkit-scrollbar-track{background:transparent}
        #mockmate-overlay ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.16);border-radius:3px}
        #mockmate-overlay ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.3)}
        #mockmate-overlay ::-webkit-scrollbar-corner{background:transparent}`}</style>
    </div>
  )
}


// ── Home tile — new design-system card (dark surface, gradient accents, Kanit) ──
// `accent` is the hover/border color for the tile; `glow` optionally tints the surface.
function HomeTile({ onClick, icon, title, sub, accent = T.borderStrong, glow, badge, right }) {
  const [h, setH] = React.useState(false)
  return (
    <div onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: glow ? `linear-gradient(135deg, ${glow}, ${T.surface1})` : T.surface1,
        border: `1px solid ${h ? accent : T.border}`,
        borderRadius: T.rCard, padding: '12px 14px', cursor: 'pointer',
        transform: h ? 'translateY(-1px)' : 'none',
        boxShadow: h ? '0 8px 22px rgba(0,0,0,0.4)' : 'none',
        transition: 'border-color .14s, transform .14s, box-shadow .14s',
        fontFamily: T.font,
      }}>
      {icon && (typeof icon === 'string'
        ? <div style={{
            width: 34, height: 34, flexShrink: 0, borderRadius: 9, display: 'grid', placeItems: 'center',
            fontSize: 16, background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.border}`,
          }}>{icon}</div>
        : <div style={{ flexShrink: 0 }}>{icon}</div>)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: T.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          {badge}
        </div>
        {sub && <div style={{ fontSize: 11, color: T.text2, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  if (!inElectron) return <BrowserGate />
  return <AuthGate>{auth => <ElectronShell auth={auth} />}</AuthGate>
}
