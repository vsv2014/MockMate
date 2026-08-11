import React, { useState, useEffect } from 'react'
import { startCheckout, openBillingPortal } from './auth/api'
import { T } from './auth/tokens'

// Account screen — lives inside the shell. ENFORCED caps come from the server
// (auth.limits, via /auth/me → backend/src/plans.js). FALLBACK only covers the brief
// window before /auth/me resolves (or an older backend that predates `limits`).
const FALLBACK = {
  free: { llmCalls: 40, sttSeconds: 30 * 60 },
  pro: { llmCalls: 100000, sttSeconds: 30000 * 60 },   // effectively unlimited (fair use)
}

export default function Account({ auth, onManageKeys }) {
  const user = auth?.user || {}
  const isGuest = !!auth?.guest
  const plan = auth?.plan === 'pro' ? 'pro' : 'free'
  const planLabel = isGuest ? 'Guest' : (plan === 'pro' ? 'Pro' : 'Free')
  const limits = auth?.limits || FALLBACK[plan]
  const usage = auth?.usage || { llmCalls: 0, sttSeconds: 0 }
  const sttMinutes = Math.round((usage.sttSeconds || 0) / 60)
  const sttLimitMinutes = Math.round((limits.sttSeconds || 0) / 60)

  const name = (user.name || '').trim()
  const initials = (name || user.email || (isGuest ? 'G' : '?')).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?'
  const isPro = !isGuest && plan === 'pro'

  const [signingOut, setSigningOut] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMsg, setBillingMsg] = useState('')

  // Checkout completes in the browser, so the plan flips server-side (via webhook) while this
  // window is in the background. Re-fetch the session when the user returns so Pro shows up
  // without a manual reload.
  useEffect(() => {
    const onFocus = () => { auth?.refresh?.() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [auth])

  async function signOut() {
    if (!window.confirm(isGuest ? 'Leave guest session and return to sign-in?' : 'Sign out of MockMate?')) return
    setSigningOut(true)
    try { await auth?.logout?.() } catch { setSigningOut(false) }
  }

  async function upgrade() {
    setBillingBusy(true); setBillingMsg('')
    try { await startCheckout() }        // opens Stripe Checkout in the browser
    catch (e) { setBillingMsg(e?.message || 'Could not start checkout.') }
    finally { setBillingBusy(false) }
  }
  async function manageSubscription() {
    setBillingBusy(true); setBillingMsg('')
    try { await openBillingPortal() }
    catch (e) { setBillingMsg(e?.message || 'Could not open billing portal.') }
    finally { setBillingBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Identity ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, color: '#fff', background: T.accent }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isGuest ? 'Guest session' : (name || 'Your account')}</div>
            <div style={{ fontSize: 11, color: T.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isGuest ? 'Local only · BYOK on this device' : (user.email || '')}
            </div>
          </div>
          {isGuest ? <GuestBadge /> : <PlanBadge pro={isPro} />}
        </div>
      </div>

      {/* ── Plan + usage (signed-in) / guest honesty ── */}
      {isGuest ? (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text1, marginBottom: 6 }}>Exploring as a guest</div>
          <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.5 }}>
            Sessions and keys stay on this device. There is no Free/Pro plan for guests — sign in for an account and Managed AI when the hosted backend is available.
          </div>
        </div>
      ) : (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={sectionLabel}>USAGE THIS MONTH</span>
          <span style={{ fontSize: 10, color: T.text3 }}>{planLabel} plan{usage.period ? ` · ${usage.period}` : ''}</span>
        </div>
        <UsageBar label="AI responses" used={usage.llmCalls || 0} limit={limits.llmCalls} unit="calls" />
        <div style={{ height: 10 }} />
        <UsageBar label="Live transcription" used={sttMinutes} limit={sttLimitMinutes} unit="min" />

        {!isPro ? (
          <>
            <button onClick={upgrade} disabled={billingBusy}
              style={{ ...upgradeBtn, opacity: billingBusy ? 0.6 : 1, cursor: billingBusy ? 'default' : 'pointer' }}>
              {billingBusy ? 'Opening checkout…' : '⚡ Upgrade to Pro'}
            </button>
            <div style={{ fontSize: 10, color: T.text3, textAlign: 'center', marginTop: 6 }}>
              Pro — unlimited AI responses under fair use. Cancel anytime.
            </div>
          </>
        ) : (
          <>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, fontSize: 12, color: '#fbbf24', fontWeight: 600 }}>
              ✦ Pro is active
            </div>
            <button onClick={manageSubscription} disabled={billingBusy}
              style={{ width: '100%', marginTop: 10, padding: '9px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.borderStrong}`, color: T.text1, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: billingBusy ? 'default' : 'pointer', opacity: billingBusy ? 0.6 : 1 }}>
              {billingBusy ? 'Opening…' : 'Manage subscription'}
            </button>
          </>
        )}
        {billingMsg && <div style={{ fontSize: 11, color: '#fbbf24', textAlign: 'center', marginTop: 8 }}>{billingMsg}</div>}
      </div>
      )}

      {/* ── API keys live in Settings (single source of truth) ── */}
      <button onClick={() => onManageKeys?.()} style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>API keys</div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>Bring your own OpenAI / Claude / Gemini / Groq / Deepgram keys — managed in Settings.</div>
        </div>
        <span style={{ fontSize: 12, color: '#5eead4', fontWeight: 600, whiteSpace: 'nowrap' }}>Manage in Settings →</span>
      </button>

      {/* ── Sign out / leave guest ── */}
      <button onClick={signOut} disabled={signingOut}
        style={{ width: '100%', padding: '10px', background: '#3a1518', border: '1px solid #5a2228', color: '#ff8b8b', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: signingOut ? 'default' : 'pointer', opacity: signingOut ? 0.6 : 1 }}>
        {signingOut ? (isGuest ? 'Leaving…' : 'Signing out…') : (isGuest ? 'Leave guest session' : 'Sign out')}
      </button>
    </div>
  )
}

// ── Usage progress bar ──
function UsageBar({ label, used, limit, unit }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const over = limit > 0 && used >= limit
  const near = pct >= 80
  const color = over ? '#f87171' : near ? '#fbbf24' : '#2dd4bf'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: T.text1 }}>{label}</span>
        <span style={{ fontSize: 11, color: T.text2, fontVariantNumeric: 'tabular-nums' }}>{used} / {limit} {unit}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function PlanBadge({ pro }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 5, color: pro ? '#fbbf24' : T.text2, background: pro ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)', border: `1px solid ${pro ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.1)'}` }}>{pro ? 'PRO' : 'FREE'}</span>
  )
}
function GuestBadge() {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 5, color: '#5eead4', background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.3)' }}>GUEST</span>
  )
}

const card = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.borderStrong}`, borderRadius: 10, padding: '14px', fontFamily: T.font }
const sectionLabel = { fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: T.text3 }
const upgradeBtn = { width: '100%', marginTop: 14, padding: '10px', border: 'none', borderRadius: 8, background: T.accent, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: T.font }
