import React, { useState } from 'react'
import ApiKeysPanel from './ApiKeys'

// Account screen — lives inside the overlay (Settings entry). Uses the overlay's
// existing teal/slate visual language so it sits coherently with every other
// in-app screen; the purple brand gradient is reserved for the avatar only.
//
// Plan limits are shown here for transparency; Phase 2 enforces them server-side.
const PLAN_LIMITS = {
  free: { llmCalls: 30, sttMinutes: 30, label: 'Free' },
  pro: { llmCalls: 500, sttMinutes: 300, label: 'Pro' },
}

export default function Account({ auth, noProviders, openKeys, onKeysSaved }) {
  const user = auth?.user || {}
  const plan = auth?.plan === 'pro' ? 'pro' : 'free'
  const limits = PLAN_LIMITS[plan]
  const usage = auth?.usage || { llmCalls: 0, sttSeconds: 0 }
  const sttMinutes = Math.round((usage.sttSeconds || 0) / 60)

  const name = (user.name || '').trim()
  const initials = (name || user.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?'
  const isPro = plan === 'pro'

  // BYO keys: open when requested from the Home footer, or when none are configured yet.
  const [keysOpen, setKeysOpen] = useState(!!openKeys || !!noProviders)
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    try { await auth?.logout?.() } catch { setSigningOut(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Identity ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg,#7c3aed,#f97316)' }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || 'Your account'}</div>
            <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email || ''}</div>
          </div>
          <PlanBadge pro={isPro} />
        </div>
      </div>

      {/* ── Plan + usage ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={sectionLabel}>USAGE THIS MONTH</span>
          <span style={{ fontSize: 10, color: '#475569' }}>{limits.label} plan · {usage.period || ''}</span>
        </div>
        <UsageBar label="AI responses" used={usage.llmCalls || 0} limit={limits.llmCalls} unit="calls" />
        <div style={{ height: 10 }} />
        <UsageBar label="Live transcription" used={sttMinutes} limit={limits.sttMinutes} unit="min" />

        {!isPro ? (
          <>
            <button disabled title="Available soon — billing launches in a later update"
              style={{ ...upgradeBtn, opacity: 0.5, cursor: 'not-allowed' }}>
              ⚡ Upgrade to Pro
            </button>
            <div style={{ fontSize: 10, color: '#475569', textAlign: 'center', marginTop: 6 }}>
              Pro (500 calls · 300 min/mo) — coming soon
            </div>
          </>
        ) : (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, fontSize: 12, color: '#fbbf24', fontWeight: 600 }}>
            ✦ Pro is active
          </div>
        )}
      </div>

      {/* ── BYO API keys ── */}
      <div style={card}>
        <button onClick={() => setKeysOpen(o => !o)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Use my own API keys</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Bring your own OpenAI / Claude / Gemini / Groq / Deepgram keys — unlimited, billed to you. Stored only on this device.</div>
          </div>
          <span style={{ fontSize: 12, color: '#94a3b8', transform: keysOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
        </button>
        {keysOpen && (
          <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
            <ApiKeysPanel showStatus onSaved={onKeysSaved} />
          </div>
        )}
      </div>

      {/* ── Sign out ── */}
      <button onClick={signOut} disabled={signingOut}
        style={{ width: '100%', padding: '10px', background: '#3a1518', border: '1px solid #5a2228', color: '#ff8b8b', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: signingOut ? 'default' : 'pointer', opacity: signingOut ? 0.6 : 1 }}>
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  )
}

// ── Usage progress bar ──
function UsageBar({ label, used, limit, unit }) {
  const pct = Math.min(100, Math.round((used / limit) * 100))
  const over = used >= limit
  const near = pct >= 80
  const color = over ? '#f87171' : near ? '#fbbf24' : '#2dd4bf'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: '#cbd5e1' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{used} / {limit} {unit}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function PlanBadge({ pro }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 5, color: pro ? '#fbbf24' : '#94a3b8', background: pro ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)', border: `1px solid ${pro ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.1)'}` }}>{pro ? 'PRO' : 'FREE'}</span>
  )
}

const card = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px' }
const sectionLabel = { fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#475569' }
const upgradeBtn = { width: '100%', marginTop: 14, padding: '10px', border: 'none', borderRadius: 8, background: 'linear-gradient(135deg,#7c3aed,#f97316)', color: '#fff', fontSize: 13, fontWeight: 600 }
