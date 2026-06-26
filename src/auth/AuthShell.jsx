import React from 'react'
import { T } from './tokens'

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
        'radial-gradient(ellipse at 25% 20%, rgba(124,58,237,0.10), transparent 55%),' +
        'radial-gradient(ellipse at 80% 85%, rgba(249,115,22,0.07), transparent 55%)',
      fontFamily: T.font, color: T.text1,
    }}>
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
