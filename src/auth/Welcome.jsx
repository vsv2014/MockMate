import React from 'react'
import { T } from './tokens'
import { AuthShell, brandMark } from './AuthShell'
import { PrimaryButton, TextLink } from './ui'

// ── Welcome screen (first launch, before login) ───────────────────────────────
// Props: onGetStarted() → signup, onSignIn() → login
export default function Welcome({ onGetStarted, onSignIn, onGuest }) {
  return (
    <AuthShell>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 26 }}>
        {brandMark(56)}
        <h1 style={{
          marginTop: 16, fontSize: 30, fontWeight: 600, letterSpacing: '0.3px',
          background: T.chrome, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>MockMate</h1>
        <p style={{ marginTop: 6, fontSize: 14, fontWeight: 400, color: T.text2 }}>Practice. Go live. Get hired.</p>
      </div>

      <PrimaryButton type="button" onClick={onGetStarted}>Get started</PrimaryButton>
      <div style={{ marginTop: 10 }}>
        <button
          type="button" onClick={onSignIn}
          style={{
            width: '100%', height: 44, borderRadius: T.rCtrl, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${T.borderStrong}`,
            color: T.text1, fontFamily: T.font, fontSize: 14, fontWeight: 500,
          }}
        >Sign in</button>
      </div>

      {onGuest && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <TextLink onClick={onGuest}>Try it without an account →</TextLink>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>Uses your own API key locally. Sign in anytime to sync &amp; use MockMate AI.</div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 24 }}>
        {['Invisible overlay', 'AI feedback', 'Job matching'].map(tag => (
          <span key={tag} style={{
            fontSize: 11, fontWeight: 400, color: T.text2,
            padding: '5px 11px', borderRadius: 999, border: `1px solid ${T.border}`, background: T.surface2,
          }}>{tag}</span>
        ))}
      </div>
    </AuthShell>
  )
}
