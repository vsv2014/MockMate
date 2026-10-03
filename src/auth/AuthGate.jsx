import React, { useState, useEffect, useCallback } from 'react'
import { T } from './tokens'
import { Spinner } from './ui'
import Welcome from './Welcome'
import Login from './Login'
import Signup from './Signup'
import Onboarding from './Onboarding'
import { WindowControls } from './AuthShell'
import { login, signup, fetchMe, logout as apiLogout, updateProfile, forgotPassword, getToken, setUnauthorizedHandler, refreshSession, usesDeviceLocalAccounts } from './api'
import { loadProfile, saveProfile } from '../lib/profile'
import { getAiMode, setAiMode, setGuestMode, MANAGED_AVAILABLE } from '../lib/aiMode'
import { setActiveAccountScope, clearActiveAccountScope } from '../lib/accountScope'

const SEEN_WELCOME = 'mm-seen-welcome'
const seenWelcome = () => { try { return localStorage.getItem(SEEN_WELCOME) === '1' } catch { return false } }
const markSeenWelcome = () => { try { localStorage.setItem(SEEN_WELCOME, '1') } catch {} }

// ── AuthGate ──────────────────────────────────────────────────────────────────
// Gates the app behind authentication. `children` is a render prop that receives
// the live session: { user, plan, usage, logout, refresh }.
export default function AuthGate({ children }) {
  const [status, setStatus] = useState('loading')   // 'loading' | 'auth' | 'ready'
  const [view, setView] = useState('welcome')        // 'welcome' | 'login' | 'signup' | 'onboarding'
  const [session, setSession] = useState(null)       // { user, plan, usage }

  const loadSession = useCallback(async () => {
    const me = await fetchMe()
    setActiveAccountScope(me?.user?.id || me?.user?._id || me?.user?.email || 'guest')
    setGuestMode(false)
    setSession(me)
    setStatus('ready')
    return me
  }, [])

  // Boot: resume an existing session if the stored token is still valid.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearActiveAccountScope()
      setGuestMode(false)
      setSession(null); setView('login'); setStatus('auth')
    })
    let alive = true
    ;(async () => {
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

  // Keep access tokens fresh while the app stays open (default JWT is 7d).
  useEffect(() => {
    if (status !== 'ready' || session?.guest) return
    const id = setInterval(() => { refreshSession().catch(() => {}) }, 12 * 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [status, session?.guest])

  // ── Handlers passed to the screens ──
  const handleLogin = useCallback(async (creds) => {
    await login(creds)
    await loadSession()
  }, [loadSession])

  const handleSignup = useCallback(async (form) => {
    await signup(form)
    markSeenWelcome()
    await loadSession()
    setView('onboarding')
    setStatus('auth')
  }, [loadSession])

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

  // Try-before-auth: guest state is durable so a process restart cannot leave a stale managed
  // preference active without a JWT. Preserve the user's pre-guest choice and restore it on login.
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

  // ── Render ──
  if (status === 'loading') return <LoadingScreen />

  if (status === 'ready' && session) {
    return children({
      user: session.user,
      plan: session.plan,
      usage: session.usage,
      limits: session.limits,
      guest: !!session.guest,
      signIn: goSignIn,
      logout: doLogout,
      refresh: loadSession,
    })
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
  return <Login onSubmit={handleLogin} onSwitchToSignup={() => setView('signup')}
    onForgot={usesDeviceLocalAccounts ? undefined : forgotPassword} onGuest={enterGuest} />
}

function LoadingScreen() {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: T.bg, color: T.text2, fontFamily: T.font }}>
      <WindowControls />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <Spinner />
        <span style={{ fontSize: 12 }}>Loading…</span>
      </div>
    </div>
  )
}
