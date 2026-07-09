import React, { useState } from 'react'
import { T } from './tokens'
import { AuthShell, brandMark } from './AuthShell'
import { Field, FormError, PrimaryButton, TextLink } from './ui'

// ── Login screen ──────────────────────────────────────────────────────────────
// Presentational + local form state. Transport lives in the parent via `onSubmit`
// (the single API wrapper) so this screen stays decoupled from how the token is
// fetched/stored.
//
// Props:
//   onSubmit({ email, password })  async — resolves on success, throws Error(msg)
//   onSwitchToSignup()             go to the Signup screen
//   onForgot()                     "Forgot password?" (Phase 2; may be undefined)
export default function Login({ onSubmit, onSwitchToSignup, onForgot, onGuest }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [forgotSent, setForgotSent] = useState(false)   // shows the generic "reset link sent" notice

  const canSubmit = email.trim() && password && !busy

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setBusy(true)
    try {
      await onSubmit({ email: email.trim(), password })
      // success: parent stores the JWT and swaps the view
    } catch (err) {
      // Never reveal which field was wrong — the wrapper maps 401 → this message.
      setError(err?.message || 'Incorrect email or password')
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
        {brandMark(40)}
        <h1 style={{
          marginTop: 14, fontSize: 22, fontWeight: 600, letterSpacing: '0.2px',
          background: T.chrome, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>Welcome back</h1>
        <p style={{ marginTop: 4, fontSize: 13, fontWeight: 400, color: T.text2 }}>Sign in to continue to MockMate</p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <Field
          id="mm-email" label="Email" type="email" inputMode="email" autoComplete="email" autoFocus
          value={email} placeholder="you@company.com"
          onChange={e => { setEmail(e.target.value); error && setError(null) }}
        />
        <Field
          id="mm-password" label="Password" type={show ? 'text' : 'password'} autoComplete="current-password"
          value={password} placeholder="••••••••" style={{ marginBottom: 0 }}
          onChange={e => { setPassword(e.target.value); error && setError(null) }}
          reveal revealed={show} onToggleReveal={() => setShow(s => !s)}
        />

        <FormError>{error}</FormError>

        <div style={{ marginTop: 18 }}>
          <PrimaryButton busy={busy} busyLabel="Signing in…" disabled={!canSubmit}>Sign in</PrimaryButton>
        </div>

        <div style={{ textAlign: 'center', marginTop: 14 }}>
          {forgotSent
            ? <span style={{ fontSize: 12, color: T.text2, lineHeight: 1.5 }}>If an account exists for that email, a reset link is on its way.</span>
            : <TextLink onClick={() => {
                if (!email.trim()) { setError('Enter your email above to reset it.'); return }
                setError(null); setForgotSent(true); try { onForgot?.(email.trim()) } catch {}
              }}>Forgot password?</TextLink>}
        </div>
      </form>

      <div style={{
        marginTop: 22, paddingTop: 18, borderTop: `1px solid ${T.border}`,
        textAlign: 'center', fontSize: 13, fontWeight: 400, color: T.text2,
      }}>
        New to MockMate?{' '}
        <TextLink strong onClick={onSwitchToSignup}>Create an account</TextLink>
      </div>

      {onGuest && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <TextLink onClick={onGuest}>Try it without an account →</TextLink>
        </div>
      )}
    </AuthShell>
  )
}
