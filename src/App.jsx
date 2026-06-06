import React, { useState, useEffect, useRef, useCallback } from 'react'
import Solo from './Solo'
import LiveCompanion from './LiveCompanion'
import Report from './Report'

const inElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron

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
  const [browserShareWarning, setBrowserShareWarning] = useState(false)
  useEffect(() => {
    fetch('/api/providers').then(r => r.json()).then(d => {
      if (!d.providers?.length) setNoProviders(true)
    }).catch(() => {})
  }, [])

  // Auto-detect meeting apps (Zoom, Teams, Meet)
  useEffect(() => {
    window.electronAPI?.onMeetingDetected(active => setMeetingActive(active))
    window.electronAPI?.onShortcutStealth?.(() => setStealth(s => !s))
    // Browser mode: warn if screen capture is likely active (getDisplayMedia check)
    if (!window.electronAPI?.isElectron) {
      navigator.mediaDevices?.addEventListener?.('devicechange', () => setBrowserShareWarning(true))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

export function OverlayPanel({ children, panelSize, stealth, minimized, onDrag, onResize, onStealth, onMinimize, onClose, title, extra, opacity = 0.95, onOpacity, autoHeight, clickThrough, onClickThrough }) {
  return (
    <div id="mockmate-overlay" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      <div style={{
        position: 'absolute', left: 0, top: 0,
        width: panelSize.w,
        height: (minimized || autoHeight) ? 'auto' : panelSize.h,
        background: 'rgba(8,9,14,0.93)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
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
            <Btn onClick={onStealth} title={inElectron ? 'Hide (Alt+H) — restore with Alt+H' : 'Dim (Alt+H)'}>
              {inElectron ? 'hide' : 'dim'}
            </Btn>
            <Btn onClick={onClickThrough} active={clickThrough} title="Click-through mode — interact with things behind">click-thru</Btn>
            <Btn onClick={onMinimize} title="Compact">{minimized ? '▲' : '▼'}</Btn>
            <Btn onClick={onClose} danger title="Close">✕</Btn>
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
