import React, { useState, useEffect, useRef, useCallback } from 'react'
import Solo from './Solo'
import LiveCompanion from './LiveCompanion'
import Report from './Report'

const inElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron

// ── Not in Electron ───────────────────────────────────────────────────────────
function BrowserGate() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#08090e', fontFamily: 'system-ui', textAlign: 'center', padding: 40 }}>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#6d28d9', marginBottom: 12, letterSpacing: '-0.02em' }}>MockMate</div>
        <div style={{ fontSize: 13, color: '#334155', marginBottom: 20 }}>This is a desktop app. Open it from your terminal:</div>
        <code style={{ background: '#12131e', border: '1px solid #1e2030', padding: '8px 16px', borderRadius: 6, fontSize: 13, color: '#a5b4fc' }}>npm run dev</code>
        <div style={{ fontSize: 11, color: '#1e293b', marginTop: 16 }}>The app will open as a floating window over your screen.</div>
      </div>
    </div>
  )
}

// ── Electron shell — wraps every screen in the floating overlay ───────────────
function ElectronShell() {
  const [view, setView] = useState('home')
  const [report, setReport] = useState(null)
  const [panelSize, setPanelSize] = useState({ w: 420, h: 560 })
  const [opacity, setOpacity] = useState(0.95)
  const [stealth, setStealth] = useState(false)
  const [stealthConfirm, setStealthConfirm] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [screenAnalysis, setScreenAnalysis] = useState(null)   // vision analysis result
  const [screenAnalyzing, setScreenAnalyzing] = useState(false)
  const profileRef = useRef({})
  const resizing = useRef(false)
  const resizeStart = useRef({})

  useEffect(() => {
    document.documentElement.style.background = '#08090e'
    document.body.style.background = '#08090e'
  }, [])

  // Listen for Ctrl+Shift+U screen captures from Electron
  useEffect(() => {
    window.electronAPI?.onScreenCaptured(async (base64) => {
      setScreenAnalyzing(true)
      setScreenAnalysis(null)
      // Switch to home if needed so panel is visible
      try {
        const d = await fetch('/api/analyze-screen', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, profile: profileRef.current })
        }).then(r => r.json())
        setScreenAnalysis(d.analysis || { error: d.error })
      } catch (e) {
        setScreenAnalysis({ error: e.message })
      }
      setScreenAnalyzing(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    const onKey = e => { if (e.altKey && e.key === 'h') handleStealthToggle() }
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
    if (!stealth) {
      // Going INTO stealth — show confirmation first
      setStealthConfirm(true)
    } else {
      // Coming OUT of stealth — always allow immediately
      setStealth(false)
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
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)}
      onClose={goHome} title="Solo Practice">
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Solo onHome={goHome} overlay />
      </div>
    </OverlayPanel>
  )

  if (view === 'companion') return (
    <LiveCompanion onHome={goHome} panelSize={panelSize} stealth={stealth} opacity={opacity} onOpacity={setOpacity}
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)}
      onResize={startResize} onDrag={startDrag}
      screenAnalysis={screenAnalysis} screenAnalyzing={screenAnalyzing} onDismissScreen={() => setScreenAnalysis(null)} />
  )

  if (view === 'report') return (
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} opacity={opacity} onOpacity={setOpacity}
      onDrag={startDrag} onResize={startResize}
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)}
      onClose={goHome} title="Feedback">
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        <Report report={report} onAgain={goHome} overlay />
      </div>
    </OverlayPanel>
  )

  // ── Home screen ──
  return (
    <>
    {stealthConfirm && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'all' }}>
        <div style={{ background: '#12131e', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px', maxWidth: 320, fontFamily: 'system-ui', color: '#e2e8f0' }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Enable stealth mode?</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16, lineHeight: 1.5 }}>
            The panel will fade to nearly invisible. Press <kbd style={{ background: '#1e2030', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>Alt+H</kbd> or click 🛡 again to restore it.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setStealth(true); setStealthConfirm(false) }}
              style={{ flex: 1, padding: '8px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Yes, go stealth
            </button>
            <button onClick={() => setStealthConfirm(false)}
              style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.06)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    <OverlayPanel panelSize={panelSize} stealth={stealth} minimized={minimized} opacity={opacity} onOpacity={setOpacity}
      onDrag={startDrag} onResize={startResize}
      onStealth={handleStealthToggle} onMinimize={() => setMinimized(m => !m)}
      onClose={() => window.close?.()}
      title="MockMate">
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 10px' }}>

        {/* Solo Practice card */}
        <div onClick={() => setView('solo')} style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, padding: '14px 16px', marginBottom: 10, cursor: 'pointer',
          transition: 'border-color 0.15s'
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(109,40,217,0.5)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
        >
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>🤖 Solo Practice</div>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
            AI interviewer asks questions tailored to your role and resume. You speak — it listens, probes, and scores you.
          </div>
        </div>

        {/* Live Companion card */}
        <div onClick={() => setView('companion')} style={{
          background: 'rgba(109,40,217,0.12)', border: '1px solid rgba(109,40,217,0.25)',
          borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
          transition: 'border-color 0.15s'
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(109,40,217,0.6)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(109,40,217,0.25)'}
        >
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>🎯 Live Interview Companion</div>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
            Floats over your Zoom / Teams / Meet call. Captures what you hear, generates answers instantly — invisible to all screen capture.
          </div>
          <div style={{ fontSize: 11, color: '#4ade80', marginTop: 8 }}>🛡 Protected — excluded from screen recording</div>
        </div>

        <div style={{ marginTop: 14, fontSize: 10, color: '#1e293b', textAlign: 'center', lineHeight: 1.8 }}>
          Drag title bar to move  ·  ◢ to resize  ·  Alt+H to hide  ·  🛡 to stealth
        </div>
        <ScreenAnalysisPanel analysis={screenAnalysis} analyzing={screenAnalyzing} onDismiss={() => setScreenAnalysis(null)} />
      </div>
    </OverlayPanel>
    </>
  )
}

// ── Reusable floating panel shell ─────────────────────────────────────────────
// ── Screen Analysis Panel — shown when Ctrl+Shift+U is pressed ───────────────
export function ScreenAnalysisPanel({ analysis, analyzing, onDismiss }) {
  const TYPE_LABEL = { coding: '💻 Coding', system_design: '🏗️ System Design', behavioral: '🧩 Behavioral', slide: '📊 Slide', other: '💬 General' }
  if (!analyzing && !analysis) return null
  return (
    <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: 10, padding: '12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>📸 Screen Analysis</span>
        <span style={{ fontSize: 9, color: '#92400e', background: 'rgba(234,179,8,0.15)', padding: '1px 6px', borderRadius: 8 }}>Ctrl+Shift+U</span>
        <button onClick={onDismiss} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13 }}>✕</button>
      </div>
      {analyzing
        ? <div style={{ fontSize: 12, color: '#92400e' }}>Analyzing screen…</div>
        : analysis?.error
          ? <div style={{ fontSize: 12, color: '#f87171' }}>⚠ {analysis.error}</div>
          : analysis && (
            <>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 9, padding: '1px 7px', background: 'rgba(234,179,8,0.15)', color: '#fbbf24', borderRadius: 10, fontWeight: 700 }}>{TYPE_LABEL[analysis.contentType] || analysis.contentType}</span>
                {analysis.pattern && <span style={{ fontSize: 9, padding: '1px 7px', background: 'rgba(109,40,217,0.3)', color: '#c7d2fe', borderRadius: 10, fontWeight: 700 }}>⚡ {analysis.pattern}</span>}
                {analysis.complexity && <span style={{ fontSize: 9, padding: '1px 7px', background: 'rgba(28,25,23,0.8)', color: '#a8a29e', borderRadius: 10, fontFamily: 'monospace' }}>{analysis.complexity}</span>}
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

export function OverlayPanel({ children, panelSize, stealth, minimized, onDrag, onResize, onStealth, onMinimize, onClose, title, extra, opacity = 0.95, onOpacity }) {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0,
        width: panelSize.w,
        height: minimized ? 'auto' : panelSize.h,
        background: 'rgba(8,9,14,0.93)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        boxShadow: '0 16px 64px rgba(0,0,0,0.85)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        opacity: stealth ? 0.06 : opacity,
        transition: 'opacity 0.2s',
        pointerEvents: 'all',
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        userSelect: 'none'
      }}>
        {/* Title bar */}
        <div onMouseDown={onDrag} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.25)', cursor: 'grab', flexShrink: 0
        }}>
          <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 800 }}>M</span>
          <span style={{ fontSize: 11, color: '#6d28d9', fontWeight: 700 }}>{title || 'MockMate'}</span>
          {extra && <div onMouseDown={e => e.stopPropagation()}>{extra}</div>}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }} onMouseDown={e => e.stopPropagation()}>
            {/* Transparency slider */}
            {onOpacity && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Transparency">
                <span style={{ fontSize: 9, color: '#334155' }}>◑</span>
                <input type="range" min="0.2" max="1" step="0.05" value={opacity}
                  onChange={e => onOpacity(parseFloat(e.target.value))}
                  style={{ width: 52, accentColor: '#6d28d9', cursor: 'pointer' }} />
              </div>
            )}
            <Btn onClick={onStealth} active={stealth} title="Stealth (Alt+H) — fade panel nearly invisible">🛡</Btn>
            <Btn onClick={onMinimize}>{minimized ? '⬜' : '⬛'}</Btn>
            <Btn onClick={onClose} danger>✕</Btn>
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

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
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
