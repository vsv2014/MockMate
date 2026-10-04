import React, { useState, useEffect, useCallback } from 'react'
import { T } from './tokens'
import { Spinner } from './ui'
import Welcome from './Welcome'
import Login from './Login'
import Signup from './Signup'
import Onboarding from './Onboarding'
import { WindowControls, AuthShell, brandMark } from './AuthShell'
import { PrimaryButton, TextLink } from './ui'
import { login, signup, fetchMe, logout as apiLogout, updateProfile, forgotPassword, getToken, setUnauthorizedHandler, refreshSession, usesDeviceLocalAccounts, consumeOAuthRedirectToken, resendVerification } from './api'
import { loadProfile, saveProfile } from '../lib/profile'
import { getAiMode, setAiMode, setGuestMode } from '../lib/aiMode'
import { setActiveAccountScope, clearActiveAccountScope } from '../lib/accountScope'

const SEEN_WELCOME = 'mm-seen-welcome'
const seenWelcome = () => { try { return localStorage.getItem(SEEN_WELCOME) === '1' } catch { return false } }
const markSeenWelcome = () => { try { localStorage.setItem(SEEN_WELCOME, '1') } catch {} }

// ── AuthGate ──────────────────────────────────────────────────────────────────
// Gates the app behind authentication. `children` is a render prop that receives
// the live session: { user, plan, usage, logout, refresh }.
export default function AuthGate({ children }) {
  const [status, setStatus] = useState('loading')
  const [view, setView] = useState('welcome')
  const [session, setSession] = useState(null)
  const [pendingEmail, setPendingEmail] = useState('')

  const loadSession = useCallback(async () => {
    const me = await fetchMe()
    setActiveAccountScope(me?.user?.id || me?.user?._id || me?.user?.email || 'guest')
    setGuestMode(false)
    setSession(me)
    setStatus('ready')
    return me
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearActiveAccountScope()
      setGuestMode(false)
      setSession(null); setView('login'); setStatus('auth')
    })
    let alive = true
    ;(async () => {
      await consumeOAuthRedirectToken()
      const token = await getToken()
      if (!token) { if (alive) { clearActiveAccountScope(); setView(seenWelcome() ? 'login' : 'welcome'); setStatus('auth') } return }
      try {
        try { await refreshSession() } catch { /* expired → loadSession will 401 */ }
        await loadSession()
      }
      catch { if (alive) { clearActiveAccountScope(); setView('login'); setStatus('auth') } }
    })()
    return () => { alive = false }
  }, [loadSession])

  useEffect(() => {
    if (status !== 'ready' || session?.guest) return
    const id = setInterval(() => { refreshSession().catch(() => {}) }, 12 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [status, session?.guest])

  const handleLogin = useCallback(async (creds) => {
    await login(creds)
    await loadSession()
  }, [loadSession])

  const handleSignup = useCallback(async (form) => {
    const result = await signup(form)
    markSeenWelcome()
    // Explicit union branch (round-5 review P1): when the backend requires email
    // verification it returns NO token. Never call loadSession() here — render the
    // "check your email" state instead.
    if (result?.verificationRequired) {
      setPendingEmail(form?.email || result?.user?.email || '')
      setView('verify-email')
      setStatus('auth')
      return
    }
    await loadSession()
    setView('onboarding')
    setStatus('auth')
  }, [loadSession])

  const handleResendVerification = useCallback(async (email) => {
    await resendVerification(email)
  }, [])

  const handleOnboarding = useCallback(async ({ currentRole, targetRole, yearsExp, resumeText }) => {
    const prof = loadProfile()
    saveProfile({
      ...prof,
      name: session?.user?.name || prof.name || '',
      currentRole: currentRole || prof.currentRole || '',
      targetRole: targetRole || prof.targetRole || '',
      yearsExp: yearsExp || prof.yearsExp || '',
      resume: resumeText || prof.resume || '',
    })
    await updateProfile({ currentRole, targetRole, yearsExp })
    await loadSession()
  }, [session, loadSession])

  const doLogout = useCallback(async () => {
    await apiLogout()
    markSeenWelcome()
    clearActiveAccountScope()
    setGuestMode(false)
    setSession(null); setView('login'); setStatus('auth')
  }, [])

  const enterGuest = useCallback(() => {
    markSeenWelcome()
    clearActiveAccountScope()
    const previous = getAiMode()
    setGuestMode(true, previous)
    setAiMode('byok')
    setSession({ user: null, plan: 'guest', guest: true, usage: null, limits: null })
    setStatus('ready')
  }, [])

  const goSignIn = useCallback(() => {
    clearActiveAccountScope()
    setSession(null); setView('login'); setStatus('auth')
  }, [])

  if (status === 'loading') return <LoadingScreen />

  if (status === 'ready' && session) {
    const app = children({
      user: session.user,
      plan: session.plan,
      usage: session.usage,
      limits: session.limits,
      guest: !!session.guest,
      signIn: goSignIn,
      logout: doLogout,
      refresh: loadSession,
    })
    return (
      <div className="mm-ready-stage">
        {app}
        <style>{`
          .mm-ready-stage { position: fixed; inset: 0; overflow: hidden; background: ${T.bg}; }
          .mm-ready-stage .mm-shell {
            animation: mm-workspace-enter 260ms cubic-bezier(.2,.75,.25,1) both;
            background-image:
              radial-gradient(circle at 75% -10%, rgba(20,184,166,.055), transparent 28%),
              linear-gradient(180deg, rgba(255,255,255,.008), transparent 24%) !important;
          }
          .mm-ready-stage .mm-shell > div:first-of-type {
            background: rgba(18,21,27,.92) !important;
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            box-shadow: 0 8px 30px rgba(0,0,0,.12);
          }
          .mm-ready-stage .mm-shell > div:nth-of-type(2) > div:not([style*="overflow-y"]) {
            background: linear-gradient(180deg, rgba(18,21,27,.98), rgba(15,18,24,.98)) !important;
          }
          .mm-ready-stage .mm-shell > div:nth-of-type(2) > div[style*="overflow-y"] {
            padding: 28px clamp(24px, 3vw, 38px) 38px !important;
            scroll-behavior: smooth;
          }
          .mm-ready-stage .mm-shell > div:nth-of-type(2) > div[style*="overflow-y"] > * {
            width: min(1180px, 100%); margin-left: auto; margin-right: auto;
          }
          .mm-ready-stage .mm-shell button,
          .mm-ready-stage .mm-shell input,
          .mm-ready-stage .mm-shell textarea,
          .mm-ready-stage .mm-shell select {
            transition: background-color 170ms ease, border-color 170ms ease, color 170ms ease,
              box-shadow 170ms ease, opacity 170ms ease, transform 170ms ease;
          }
          .mm-ready-stage .mm-shell button:active:not(:disabled) { transform: scale(.988); }
          @keyframes mm-workspace-enter {
            from { opacity: 0; transform: translateY(5px) scale(.998); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @media (max-width: 900px) {
            .mm-ready-stage .mm-shell > div:nth-of-type(2) > div[style*="overflow-y"] {
              padding: 22px 20px 30px !important;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .mm-ready-stage .mm-shell,
            .mm-ready-stage .mm-shell * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
          }
        `}</style>
      </div>
    )
  }

  if (view === 'welcome') {
    return <Welcome
      onGetStarted={() => { markSeenWelcome(); setView('signup') }}
      onSignIn={() => { markSeenWelcome(); setView('login') }}
      onGuest={enterGuest}
    />
  }
  if (view === 'signup') return <Signup onSubmit={handleSignup} onSwitchToLogin={() => setView('login')} />
  if (view === 'onboarding') return <Onboarding onComplete={handleOnboarding} />
  if (view === 'verify-email') return <VerifyEmailSent
    email={pendingEmail}
    onResend={handleResendVerification}
    onBackToLogin={() => { setPendingEmail(''); setView('login') }}
  />
  return <Login onSubmit={handleLogin} onSwitchToSignup={() => setView('signup')}
    onForgot={usesDeviceLocalAccounts ? undefined : forgotPassword} onGuest={enterGuest}
    onResendVerification={usesDeviceLocalAccounts ? undefined : handleResendVerification} />
}

// ── VerifyEmailSent ───────────────────────────────────────────────────────────
// Shown after a signup that requires email verification: the backend created the
// account but issued NO token, so this is a waiting state — not a session.
function VerifyEmailSent({ email, onResend, onBackToLogin }) {
  const [resendState, setResendState] = useState('idle') // idle | busy | sent | error
  return (
    <AuthShell>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
        {brandMark(40)}
        <h1 style={{
          marginTop: 14, fontSize: 22, fontWeight: 600, letterSpacing: '0.2px',
          background: T.chrome, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>Check your email</h1>
        <p style={{ marginTop: 8, fontSize: 13, fontWeight: 400, color: T.text2, textAlign: 'center', lineHeight: 1.6, maxWidth: 340 }}>
          We created your MockMate account{email ? <> for <strong style={{ color: T.text }}>{email}</strong></> : ''}, but you
          need to verify that email before signing in. Click the link in the message we just sent
          (valid for 24 hours), then come back and sign in.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PrimaryButton onClick={onBackToLogin}>I’ve verified — sign in</PrimaryButton>
        <div style={{ textAlign: 'center' }}>
          {resendState === 'sent'
            ? <span style={{ fontSize: 12, color: T.text2 }}>Verification email sent again. Check your inbox (and spam).</span>
            : <TextLink onClick={async () => {
                if (resendState === 'busy') return
                setResendState('busy')
                try { await onResend(email); setResendState('sent') }
                catch { setResendState('error') }
              }}>{resendState === 'busy' ? 'Sending…' : resendState === 'error' ? 'Couldn’t resend — try again' : 'Resend verification email'}</TextLink>}
        </div>
      </div>
    </AuthShell>
  )
}

function LoadingScreen() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: T.text2, fontFamily: T.font,
      background: '#0B0D12',
      backgroundImage: 'radial-gradient(circle at 50% 38%, rgba(20,184,166,.10), transparent 28%), linear-gradient(180deg,#0B0D12,#090A0F)',
    }}>
      <WindowControls />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, animation: 'mm-load-in 220ms ease both' }}>
        <Spinner />
        <span style={{ fontSize: 12 }}>Opening MockMate…</span>
      </div>
      <style>{`@keyframes mm-load-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`}</style>
    </div>
  )
}
