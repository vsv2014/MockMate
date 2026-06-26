import React, { useState } from 'react'
import { T } from './tokens'
import { AuthShell, brandMark } from './AuthShell'
import { Field, FormError, PrimaryButton, TextLink, ProgressSteps } from './ui'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Signup screen (step 1 of 2 — onboarding is step 2) ────────────────────────
// Props:
//   onSubmit({ name, email, password })  async — resolves on success, throws ApiError
//   onSwitchToLogin()
export default function Signup({ onSubmit, onSwitchToLogin }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState({})       // per-field
  const [formError, setFormError] = useState(null)

  function setField(key, setter) {
    return e => {
      setter(e.target.value)
      if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }))
      if (formError) setFormError(null)
    }
  }

  function validate() {
    const next = {}
    if (!name.trim()) next.name = 'Please enter your name'
    if (!EMAIL_RE.test(email.trim())) next.email = 'Please enter a valid email address'
    if (password.length < 8) next.password = 'Password must be at least 8 characters'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy || !validate()) return
    setBusy(true)
    try {
      await onSubmit({ name: name.trim(), email: email.trim(), password })
    } catch (err) {
      // 409 → the email is taken; surface it inline on the email field.
      if (err?.status === 409) setErrors(prev => ({ ...prev, email: 'That email is already registered' }))
      else setFormError(err?.message || 'Could not create your account. Please try again.')
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 22 }}>
        {brandMark(40)}
        <h1 style={{
          marginTop: 14, fontSize: 22, fontWeight: 600, letterSpacing: '0.2px',
          background: T.chrome, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>Create your account</h1>
        <p style={{ marginTop: 4, fontSize: 13, fontWeight: 400, color: T.text2 }}>Practice. Go live. Get hired.</p>
      </div>

      <ProgressSteps step={1} total={2} label="Step 1 of 2 · Account" />

      <form onSubmit={handleSubmit} noValidate>
        <Field
          id="mm-name" label="Full name" autoComplete="name" autoFocus
          value={name} placeholder="Santhosh Vishal" error={errors.name}
          onChange={setField('name', setName)}
        />
        <Field
          id="mm-email" label="Email" type="email" inputMode="email" autoComplete="email"
          value={email} placeholder="you@company.com" error={errors.email}
          onChange={setField('email', setEmail)}
        />
        <Field
          id="mm-password" label="Password" type={show ? 'text' : 'password'} autoComplete="new-password"
          value={password} placeholder="At least 8 characters" error={errors.password}
          style={{ marginBottom: 0 }}
          onChange={setField('password', setPassword)}
          reveal revealed={show} onToggleReveal={() => setShow(s => !s)}
        />

        <FormError>{formError}</FormError>

        <div style={{ marginTop: 18 }}>
          <PrimaryButton busy={busy} busyLabel="Creating account…">Create account</PrimaryButton>
        </div>
      </form>

      <div style={{
        marginTop: 22, paddingTop: 18, borderTop: `1px solid ${T.border}`,
        textAlign: 'center', fontSize: 13, fontWeight: 400, color: T.text2,
      }}>
        Already have an account?{' '}
        <TextLink strong onClick={onSwitchToLogin}>Sign in instead</TextLink>
      </div>
    </AuthShell>
  )
}
