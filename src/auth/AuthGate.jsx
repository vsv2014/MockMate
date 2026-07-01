import React, { useState, useEffect, useCallback } from 'react'
import { T } from './tokens'
import { Spinner } from './ui'
import Welcome from './Welcome'
import Login from './Login'
import Signup from './Signup'
import Onboarding from './Onboarding'
import { login, signup, fetchMe, logout as apiLogout, updateProfile, forgotPassword, getToken, setUnauthorizedHandler } from './api'
import { loadProfile, saveProfile } from '../lib/profile'

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
    setSession(me)
    setStatus('ready')
    return me
  }, [])

  // Boot: resume an existing session if the stored token is still valid.
  useEffect(() => {
    setUnauthorizedHandler(() => { setSession(null); setView('login'); setStatus('auth') })
    let alive = true
    ;(async () => {
      const token = await getToken()
      if (!token) { if (alive) { setView(seenWelcome() ? 'login' : 'welcome'); setStatus('auth') } return }
      try { await loadSession() }
      catch { if (alive) { setView('login'); setStatus('auth') } }
    })()
    return () => { alive = false }
  }, [loadSession])

  // ── Handlers passed to the screens ──
  const handleLogin = useCallback(async (creds) => {
    await login(creds)        // stores JWT (throws on bad creds → Login shows the error)
    await loadSession()       // → ready
  }, [loadSession])

  const handleSignup = useCallback(async (form) => {
    await signup(form)        // stores JWT (throws → Signup shows the error)
    markSeenWelcome()
    await loadSession()       // populate session.user for onboarding (stays in 'auth')
    setView('onboarding')
    setStatus('auth')
  }, [loadSession])

  const handleOnboarding = useCallback(async ({ currentRole, targetRole, yearsExp, resumeText }) => {
    // Local-first: profile + resume stay on the device (reused by Solo/Jobs/Career).
    const prof = loadProfile()
    saveProfile({
      ...prof,
      name: session?.user?.name || prof.name || '',
      currentRole: currentRole || prof.currentRole || '',
      targetRole: targetRole || prof.targetRole || '',
      resume: resumeText || prof.resume || '',
    })
    // Backend: role/experience only (never the resume — that's local unless synced).
    await updateProfile({ currentRole, targetRole, yearsExp })
    await loadSession()       // → ready (enters the app)
  }, [session])

  const doLogout = useCallback(async () => {
    await apiLogout()
    markSeenWelcome()
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
      logout: doLogout,
      refresh: loadSession,
    })
  }

  // Auth flow
  if (view === 'welcome') {
    return <Welcome
      onGetStarted={() => { markSeenWelcome(); setView('signup') }}
      onSignIn={() => { markSeenWelcome(); setView('login') }}
    />
  }
  if (view === 'signup') {
    return <Signup onSubmit={handleSignup} onSwitchToLogin={() => setView('login')} />
  }
  if (view === 'onboarding') {
    return <Onboarding onComplete={handleOnboarding} />
  }
  return <Login onSubmit={handleLogin} onSwitchToSignup={() => setView('signup')} onForgot={forgotPassword} />
}

function LoadingScreen() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
      background: T.bg, color: T.text2, fontFamily: T.font,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <Spinner />
        <span style={{ fontSize: 12 }}>Loading…</span>
      </div>
    </div>
  )
}
