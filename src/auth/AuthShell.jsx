import React from 'react'
import { T } from './tokens'

// ── WindowControls ──────────────────────────────────────────────────────────────
// The main window is frameless + transparent + skipTaskbar on Win/macOS (see
// electron/main.cjs), so it has NO OS title bar and NO taskbar entry — the ONLY way to
// move/minimize/close is in-app chrome. The authed app gets that from OverlayPanel/
// AppShell; the auth screens (Welcome/Login/Signup/Onboarding/Loading) had none, which
// trapped the user (Task Manager was the only way to quit). This slim top bar fixes that:
// a draggable region + minimize + close, present on every pre-auth screen.
export function WindowControls() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.isElectron) return null   // browser dev has real window chrome — nothing to add

  // JS-based drag via IPC (matches App.jsx startDrag) — the frameless transparent window
  // doesn't get native drag, and this is the pattern the rest of the app already uses.
  const startDrag = e => {
    if (e.button !== 0) return
    let lastX = e.screenX, lastY = e.screenY
    const onMove = ev => { api.windowDrag?.(ev.screenX - lastX, ev.screenY - lastY); lastX = ev.screenX; lastY = ev.screenY }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.preventDefault()
  }
  const btn = {
    width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 8,
    border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.04)', color: T.text2,
    cursor: 'pointer', fontSize: 14, lineHeight: 1, fontFamily: T.font,
  }
  // stopPropagation on button mousedown so clicking a control doesn't also start a window drag.
  const noDrag = e => e.stopPropagation()
  return (
    <div onMouseDown={startDrag} title="Drag to move" style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: 40, zIndex: 20,
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
      padding: '0 12px', cursor: 'move', WebkitUserSelect: 'none', userSelect: 'none',
    }}>
      <button title="Minimize" aria-label="Minimize" onMouseDown={noDrag}
        onClick={() => api.hideWindow?.()} style={btn}>–</button>
      <button title="Close" aria-label="Close" onMouseDown={noDrag}
        onClick={() => window.close()} style={{ ...btn, color: '#f87171' }}>✕</button>
    </div>
  )
}

// ── AuthShell ─────────────────────────────────────────────────────────────────
// Full-window layout for the new SaaS surfaces (Login / Signup / Onboarding /
// Account). Centers a single card on the #0c0c0c ground with the spec's accent
// glows, and carries the scoped CSS that inline styles can't express
// (input :focus, ::placeholder, button :hover, keyframes, focus rings).
//
// Scoped under #mm-auth so none of this leaks into the legacy overlay styles.
export function AuthShell({ children, maxWidth = 360 }) {
  return (
    <div id="mm-auth" style={{
      position: 'fixed', inset: 0, overflow: 'auto',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px',
      background: T.bg,
      backgroundImage:
        'radial-gradient(ellipse at 25% 20%, rgba(20,184,166,0.10), transparent 55%),' +
        'radial-gradient(ellipse at 80% 85%, rgba(249,115,22,0.07), transparent 55%)',
      fontFamily: T.font, color: T.text1,
    }}>
      <WindowControls />
      <div style={{
        width: '100%', maxWidth,
        background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard,
        padding: 28, boxShadow: '0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}>
        {children}
      </div>

      <style>{`
        #mm-auth, #mm-auth * { font-family: ${T.font}; box-sizing: border-box; }
        #mm-auth .mm-input::placeholder { color: ${T.text3}; }
        #mm-auth .mm-input:focus { border-color: ${T.accentFrom}; }
        #mm-auth .mm-input:hover:not(:focus) { border-color: ${T.borderStrong}; }
        #mm-auth .mm-primary:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 8px 24px ${T.accentGlow}; }
        #mm-auth .mm-primary:not(:disabled):active { transform: translateY(0); }
        #mm-auth .mm-reveal:hover { color: ${T.text1}; background: rgba(255,255,255,0.06); }
        #mm-auth .mm-link:hover { text-decoration: underline; }
        #mm-auth button:focus-visible, #mm-auth input:focus-visible {
          outline: 2px solid ${T.accentFrom}; outline-offset: 2px; border-radius: ${T.rCtrl}px;
        }
        @keyframes mm-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          #mm-auth *, #mm-auth *::before, #mm-auth *::after { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
  )
}

// ── Brand mark ────────────────────────────────────────────────────────────────
// Gradient rounded-square logo. Inline SVG glyph (no emoji — they break on Linux).
export function brandMark(size = 56) {
  const radius = Math.round(size * 0.3)
  const g = Math.round(size * 0.5)
  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      background: T.accent, display: 'grid', placeItems: 'center', flexShrink: 0,
      boxShadow: `0 6px 20px ${T.accentGlow}`,
    }}>
      <svg width={g} height={g} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19V6.5a1 1 0 0 1 1.8-.6L12 14l6.2-8.1a1 1 0 0 1 1.8.6V19" />
      </svg>
    </div>
  )
}
