import React from 'react'
import { T } from './tokens'

// ── WindowControls ──────────────────────────────────────────────────────────────
// Shared frameless-window chrome for every pre-auth state. The signed-in app uses
// the same visual rhythm, so auth no longer feels like a floating modal on an empty
// desktop surface.
export function WindowControls() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.isElectron) return null

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
    width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 9,
    border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.035)', color: T.text2,
    cursor: 'pointer', fontSize: 14, lineHeight: 1, fontFamily: T.font,
    transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease',
  }
  const noDrag = e => e.stopPropagation()
  return (
    <div onMouseDown={startDrag} title="Drag to move" style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: 48, zIndex: 30,
      display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 0 14px', cursor: 'move',
      WebkitUserSelect: 'none', userSelect: 'none',
      background: 'linear-gradient(180deg, rgba(14,16,22,0.94), rgba(14,16,22,0.72))',
      backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
      borderBottom: `1px solid ${T.border}`,
    }}>
      <img src="/icon.png" alt="" width={24} height={24} style={{ borderRadius: 7, display: 'block', boxShadow: '0 4px 16px rgba(20,184,166,0.18)' }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: T.text1, letterSpacing: '0.15px' }}>MockMate</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
        <button className="mm-window-btn" title="Minimize" aria-label="Minimize" onMouseDown={noDrag}
          onClick={() => api.hideWindow?.()} style={btn}>–</button>
        <button className="mm-window-btn" title="Close" aria-label="Close" onMouseDown={noDrag}
          onClick={() => window.close()} style={{ ...btn, color: '#f87171' }}>✕</button>
      </div>
    </div>
  )
}

// ── AuthShell ─────────────────────────────────────────────────────────────────
// Full-window branded composition. On desktop widths the form sits beside a calm
// product context panel instead of floating alone in a black void; on compact
// windows the context panel collapses and the form remains focused and usable.
export function AuthShell({ children, maxWidth = 360 }) {
  return (
    <div id="mm-auth" style={{
      position: 'fixed', inset: 0, overflow: 'auto',
      padding: '76px 34px 34px',
      background: '#0B0D12',
      backgroundImage:
        'radial-gradient(circle at 18% 12%, rgba(20,184,166,0.16), transparent 34%),' +
        'radial-gradient(circle at 88% 82%, rgba(249,115,22,0.08), transparent 30%),' +
        'linear-gradient(145deg, rgba(255,255,255,0.018), transparent 42%),' +
        'linear-gradient(180deg, #0B0D12 0%, #090A0F 100%)',
      fontFamily: T.font, color: T.text1,
    }}>
      <WindowControls />

      <div className="mm-auth-stage">
        <section className="mm-auth-story" aria-hidden="true">
          <div className="mm-auth-eyebrow"><span /> MOCKMATE DESKTOP</div>
          <h2>Stay focused on the conversation.</h2>
          <p>Practice, prepare, and use live interview assistance from one calm workspace — without the UI fighting for your attention.</p>

          <div className="mm-auth-points">
            <div><span>01</span><div><strong>Prepare once</strong><small>Resume, role context, and interview preferences stay together.</small></div></div>
            <div><span>02</span><div><strong>Move naturally</strong><small>Solo practice and Live assistance share the same visual language.</small></div></div>
            <div><span>03</span><div><strong>Keep control</strong><small>Desktop-first, private-by-default workflows with clear status and recovery.</small></div></div>
          </div>

          <div className="mm-auth-foot">Built for focused interview sessions, not dashboard noise.</div>
        </section>

        <main className="mm-auth-card-wrap">
          <div className="mm-auth-card" style={{ maxWidth }}>
            {children}
          </div>
        </main>
      </div>

      <style>{`
        #mm-auth, #mm-auth * { font-family: ${T.font}; box-sizing: border-box; }
        #mm-auth .mm-auth-stage {
          width: min(1080px, 100%); min-height: calc(100vh - 110px); margin: 0 auto;
          display: grid; grid-template-columns: minmax(280px, .92fr) minmax(390px, 1.08fr);
          align-items: center; gap: clamp(42px, 7vw, 88px);
          animation: mm-auth-fade 260ms cubic-bezier(.2,.75,.25,1) both;
        }
        #mm-auth .mm-auth-story { max-width: 470px; padding: 18px 4px 18px 8px; }
        #mm-auth .mm-auth-eyebrow {
          display: flex; align-items: center; gap: 9px; margin-bottom: 22px;
          color: #7dd3c7; font-size: 11px; font-weight: 600; letter-spacing: .15em;
        }
        #mm-auth .mm-auth-eyebrow > span {
          width: 7px; height: 7px; border-radius: 999px; background: #2dd4bf;
          box-shadow: 0 0 18px rgba(45,212,191,.65);
        }
        #mm-auth .mm-auth-story h2 {
          margin: 0; max-width: 440px; color: #F2F4F7; font-size: clamp(34px, 4vw, 54px);
          line-height: 1.02; font-weight: 600; letter-spacing: -1.4px;
        }
        #mm-auth .mm-auth-story > p {
          margin: 18px 0 28px; max-width: 430px; color: #9A9FA9; font-size: 14px; line-height: 1.7;
        }
        #mm-auth .mm-auth-points { display: grid; gap: 11px; }
        #mm-auth .mm-auth-points > div {
          display: grid; grid-template-columns: 34px 1fr; gap: 12px; align-items: start;
          padding: 13px 14px; border: 1px solid rgba(255,255,255,.065); border-radius: 13px;
          background: linear-gradient(120deg, rgba(255,255,255,.035), rgba(255,255,255,.014));
        }
        #mm-auth .mm-auth-points > div > span { color: #5eead4; font-size: 10px; font-weight: 600; padding-top: 2px; }
        #mm-auth .mm-auth-points strong { display: block; color: #E8EAEE; font-size: 12.5px; font-weight: 600; }
        #mm-auth .mm-auth-points small { display: block; margin-top: 3px; color: #787E88; font-size: 10.5px; line-height: 1.45; }
        #mm-auth .mm-auth-foot { margin-top: 22px; color: #646A74; font-size: 10.5px; }
        #mm-auth .mm-auth-card-wrap { display: flex; justify-content: center; width: 100%; }
        #mm-auth .mm-auth-card {
          width: 100%; padding: 30px;
          background: linear-gradient(180deg, rgba(24,26,33,.96), rgba(16,18,24,.96));
          border: 1px solid rgba(255,255,255,.09); border-radius: 20px;
          box-shadow: 0 34px 90px rgba(0,0,0,.46), 0 0 0 1px rgba(20,184,166,.025), inset 0 1px 0 rgba(255,255,255,.045);
          backdrop-filter: blur(20px); WebkitBackdropFilter: blur(20px);
          animation: mm-auth-rise 320ms cubic-bezier(.2,.75,.25,1) both;
        }
        #mm-auth .mm-input { transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease; }
        #mm-auth .mm-input::placeholder { color: ${T.text3}; }
        #mm-auth .mm-input:focus { border-color: ${T.accentFrom}; box-shadow: 0 0 0 3px rgba(20,184,166,.08); }
        #mm-auth .mm-input:hover:not(:focus) { border-color: ${T.borderStrong}; }
        #mm-auth button { transition: transform 160ms ease, background-color 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease, opacity 160ms ease; }
        #mm-auth .mm-primary:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 10px 26px ${T.accentGlow}; }
        #mm-auth .mm-primary:not(:disabled):active { transform: translateY(0) scale(.992); }
        #mm-auth .mm-reveal:hover { color: ${T.text1}; background: rgba(255,255,255,0.06); }
        #mm-auth .mm-link:hover { text-decoration: underline; }
        #mm-auth .mm-window-btn:hover { background: rgba(255,255,255,.075) !important; border-color: rgba(255,255,255,.13) !important; color: #f4f4f5 !important; }
        #mm-auth button:focus-visible, #mm-auth input:focus-visible {
          outline: 2px solid ${T.accentFrom}; outline-offset: 2px; border-radius: ${T.rCtrl}px;
        }
        @keyframes mm-spin { to { transform: rotate(360deg); } }
        @keyframes mm-auth-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mm-auth-rise { from { opacity: 0; transform: translateY(10px) scale(.992); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @media (max-width: 860px) {
          #mm-auth { padding: 70px 20px 26px !important; }
          #mm-auth .mm-auth-stage { grid-template-columns: 1fr; min-height: calc(100vh - 96px); }
          #mm-auth .mm-auth-story { display: none; }
          #mm-auth .mm-auth-card { max-width: 430px !important; }
        }
        @media (max-width: 520px) {
          #mm-auth { padding-left: 12px !important; padding-right: 12px !important; }
          #mm-auth .mm-auth-card { padding: 24px 20px; border-radius: 16px; }
        }
        @media (prefers-reduced-motion: reduce) {
          #mm-auth *, #mm-auth *::before, #mm-auth *::after { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
  )
}

// ── Brand mark ────────────────────────────────────────────────────────────────
export function brandMark(size = 56) {
  const radius = Math.round(size * 0.3)
  const g = Math.round(size * 0.5)
  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      background: T.accent, display: 'grid', placeItems: 'center', flexShrink: 0,
      boxShadow: `0 8px 24px ${T.accentGlow}`,
    }}>
      <svg width={g} height={g} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19V6.5a1 1 0 0 1 1.8-.6L12 14l6.2-8.1a1 1 0 0 1 1.8.6V19" />
      </svg>
    </div>
  )
}
