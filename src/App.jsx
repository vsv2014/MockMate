import React, { useState, useEffect, useRef, useCallback } from 'react'
import Solo from './Solo'
import LiveCompanion from './LiveCompanion'
import Report from './Report'

const inElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron
const isLinux = typeof window !== 'undefined' && window.electronAPI?.platform === 'linux'

// ── Not in Electron — show landing page ──────────────────────────────────────
function BrowserGate() {
  // Redirect to the landing page served from public/
  window.location.replace('/landing.html')
  return null
}

// ── Electron shell — wraps every screen in the floating overlay ───────────────
function ElectronShell() {
  const [view, setView] = useState('home')
  const [report, setReport] = useState(null)
  const [panelSize, setPanelSize] = useState({ w: 420, h: 560 })
  const [opacity, setOpacity] = useState(0.95)
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
  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(d => {
      if (!d.providers?.length) setNoProviders(true)
    }).catch(() => {})
  }, [])

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
      const d = await fetch('/api/analyze-screen', {
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

  function goHome() { setReport(null); setView('home') }

  // Solo and Companion take over the full panel content — render them directly
  if (view === 'solo') return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} opacity={opacity} onOpacity={setOpacity}
      onDrag={startDrag} onResize={startResize}
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)} clickThrough={clickThrough} onClickThrough={() => setClickThrough(c => !c)}
      onClose={goHome} title="Solo Practice">
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Solo onHome={goHome} overlay />
      </div>
    </OverlayPanel>
  )

  if (view === 'companion') return (
    <LiveCompanion onHome={goHome} panelSize={panelSize} stealth={stealth} opacity={opacity} onOpacity={setOpacity}
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)} clickThrough={clickThrough} onClickThrough={() => setClickThrough(c => !c)}
      onResize={startResize} onDrag={startDrag}
      screenAnalysis={screenAnalysis} screenAnalyzing={screenAnalyzing} onDismissScreen={() => setScreenAnalysis(null)}
      codingDetected={codingDetected} onCaptureScreen={() => window.electronAPI?.captureScreen?.()}
      onReanalyze={reanalyze}
      onPipActive={active => setStealth(active)} />
  )

  if (view === 'report') return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} opacity={opacity} onOpacity={setOpacity}
      onDrag={startDrag} onResize={startResize}
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)} clickThrough={clickThrough} onClickThrough={() => setClickThrough(c => !c)}
      onClose={goHome} title="Feedback">
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        <Report report={report} onAgain={goHome} overlay />
      </div>
    </OverlayPanel>
  )

  // ── Home screen ──
  return (
    <>
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} opacity={opacity} onOpacity={setOpacity}
      onDrag={startDrag} onResize={startResize}
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)} clickThrough={clickThrough} onClickThrough={() => setClickThrough(c => !c)}
      onClose={() => window.close?.()}
      title="MockMate" autoHeight>
      <div style={{ padding: '12px 14px 14px' }}>

        {!inElectron && (
          <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '8px 10px', marginBottom: 8, fontSize: 11, color: '#fca5a5', lineHeight: 1.5 }}>
            ⚠ <strong>Browser mode</strong> — this overlay IS visible during screen share. Run <code style={{ background: '#1c0505', padding: '0 3px', borderRadius: 2 }}>npm run dev</code> to launch the protected Electron app instead.
          </div>
        )}
        {isLinux && (
          <div style={{ background: '#431407', border: '1px solid #7c2d12', borderRadius: 7, padding: '7px 10px', marginBottom: 8, fontSize: 11, color: '#fdba74', lineHeight: 1.6 }}>
            ⚠ <strong>Linux can't hide this overlay from screen share</strong> (no OS support). For practice & coaching this doesn't matter. For a live call, put MockMate on a <strong>second monitor you don't share</strong> — or use Windows/macOS for a fully hidden overlay.
          </div>
        )}
        {meetingActive && (
          <div onClick={() => setView('companion')}
            style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 7, padding: '8px 10px', marginBottom: 8, fontSize: 11, color: '#4ade80', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', flexShrink: 0 }} />
            <span><strong>Meeting detected</strong> — tap to start Live Companion</span>
          </div>
        )}
        {noProviders && (
          <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '7px 10px', marginBottom: 8, fontSize: 11, color: '#fca5a5' }}>
            ⚠ No API keys. Add to <code style={{ background: '#1c0505', padding: '0 3px', borderRadius: 2 }}>.env</code> and restart.
          </div>
        )}

        <ScreenAnalysisPanel analysis={screenAnalysis} analyzing={screenAnalyzing} onDismiss={() => setScreenAnalysis(null)} />

        <div onClick={() => setView('solo')} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '12px 14px', marginBottom: 8, cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(109,40,217,0.5)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>🤖 Solo Practice</div>
          <div style={{ fontSize: 11, color: '#475569' }}>AI interviewer · follow-up probes · scored report</div>
        </div>

        <div onClick={() => setView('companion')} style={{ background: 'rgba(109,40,217,0.12)', border: '1px solid rgba(109,40,217,0.3)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(109,40,217,0.7)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(109,40,217,0.3)'}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>🎯 Live Interview Companion</div>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 5 }}>Floats over Zoom / Teams / Meet · real-time AI answers</div>
          <div style={{ fontSize: 10, color: '#4ade80' }}>🛡 Invisible to all screen capture</div>
        </div>

        {/* Keyboard shortcuts */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, color: '#334155', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 6 }}>KEYBOARD SHORTCUTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              ['Ctrl+Shift+U', 'Screen capture + AI analysis'],
              ['Ctrl+Shift+H', 'Stealth — fade panel invisible'],
              ['Alt+H', 'Stealth (keyboard alt)'],
              ['⠿ Drag', 'Move overlay anywhere'],
              ['◢ Corner', 'Resize panel'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 7px', background: 'rgba(255,255,255,0.02)', borderRadius: 5 }}>
                <code style={{ fontSize: 9, color: '#6d28d9', background: 'rgba(109,40,217,0.12)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace' }}>{k}</code>
                <span style={{ fontSize: 9, color: '#334155' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </OverlayPanel>
    </>
  )
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

const CODE_LANGS = ['Python', 'Java', 'C++', 'JavaScript', 'Go', 'TypeScript']

// ── Screen Analysis Panel — shown when Ctrl+Shift+U is pressed ───────────────
export function ScreenAnalysisPanel({ analysis, analyzing, onDismiss, onReanalyze, onRecapture }) {
  const TYPE_LABEL = { coding: '💻 Coding', system_design: '🏗️ System Design', behavioral: '🧩 Behavioral', slide: '📊 Slide', other: '💬 General' }
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
                  {analysis.pattern && <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(109,40,217,0.3)', color: '#c7d2fe', borderRadius: 10, fontWeight: 700 }}>⚡ {analysis.pattern}</span>}
                  {analysis.complexity && <span style={{ fontSize: 9, padding: '2px 8px', background: '#0d1117', color: '#7ee787', borderRadius: 10, fontFamily: 'monospace' }}>{analysis.complexity}</span>}
                  {analysis.language && <span style={{ fontSize: 9, padding: '2px 8px', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', borderRadius: 10 }}>{analysis.language}</span>}
                </div>
                {analysis.detectedText && <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', marginBottom: 8, borderLeft: '2px solid rgba(34,197,94,0.3)', paddingLeft: 7 }}>{analysis.detectedText}</div>}
                {/* Language switcher — re-solve the same screen in another language, no re-capture */}
                {onReanalyze && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {CODE_LANGS.map(lang => {
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
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: bg, color: base, border: 'none', borderRadius: 7, cursor: 'pointer',
        fontSize: 14, lineHeight: 1, transition: 'background 0.12s', flexShrink: 0
      }}><Glyph name={icon} /></button>
  )
}

export function OverlayPanel({ children, panelSize, stealth, minimized, onDrag, onResize, onStealth, onMinimize, onClose, title, extra, actions, opacity = 0.95, autoHeight, clickThrough, confirmClose }) {
  const [confirming, setConfirming] = useState(false)
  const confirmTimer = useRef(null)
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
        background: 'rgba(8,9,14,0.94)',
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
            : <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700 }}>{title || 'MockMate'}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }} onMouseDown={e => e.stopPropagation()}>
            {actions}
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
        #mockmate-overlay *{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.18) transparent}
        #mockmate-overlay ::-webkit-scrollbar{width:6px;height:6px}
        #mockmate-overlay ::-webkit-scrollbar-track{background:transparent}
        #mockmate-overlay ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.16);border-radius:3px}
        #mockmate-overlay ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.3)}
        #mockmate-overlay ::-webkit-scrollbar-corner{background:transparent}`}</style>
    </div>
  )
}

function Btn({ children, onClick, active, danger, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      fontSize: 10, padding: '2px 8px',
      background: active ? '#7f1d1d' : danger ? '#450a0a' : 'rgba(255,255,255,0.06)',
      color: active ? '#fca5a5' : danger ? '#fca5a5' : '#475569',
      border: 'none', borderRadius: 4, cursor: 'pointer'
    }}>{children}</button>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  if (!inElectron) return <BrowserGate />
  return <ElectronShell />
}
