import React, { useState, useEffect } from 'react'
import { apiFetch } from './lib/apiClient'
import { T } from './auth/tokens'
import { getAiMode, setAiMode, MANAGED_AVAILABLE } from './lib/aiMode'

// Reusable API-key entry. Used BOTH at the global level (Home → Settings) and inside
// Live Companion, so keys can be configured once without entering any specific mode.
// Keys are MERGED into userData/.env by the main process (adding one never wipes others)
// and applied live, so they immediately work for Solo, Companion, and Jobs alike.

const inp = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px',
  background: T.surface2, border: `1px solid ${T.border}`,
  borderRadius: T.rCtrl, color: T.text1, fontSize: 12, outline: 'none',
  fontFamily: T.font,
}

// LLM providers shown as labeled rows. `match` maps a configured provider (from
// /api/providers) back to its row so we can show a live "Added" badge.
const PROVIDERS = [
  { k: 'OPENAI_API_KEY', name: 'OpenAI', hint: 'GPT-4o · GPT-4o-mini', match: /openai|gpt/i },
  { k: 'ANTHROPIC_API_KEY', name: 'Anthropic', hint: 'Claude Opus · Sonnet · Haiku', match: /anthropic|claude/i },
  { k: 'GEMINI_API_KEY', name: 'Google Gemini', hint: 'free tier', free: true, match: /gemini|google/i },
  { k: 'GROQ_API_KEY', name: 'Groq', hint: 'free · fastest', free: true, match: /groq/i },
]
const EMPTY = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', DEEPGRAM_API_KEY: '', OPENAI_MODEL: '', ADZUNA_APP_ID: '', ADZUNA_APP_KEY: '' }

function Pill({ color, bg, children }) {
  return <span style={{ fontSize: 9.5, fontWeight: 600, color, background: bg, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{children}</span>
}

// A single labeled key field: name + hint on the left, status/free pill on the right,
// input below. Far clearer than a placeholder-only box that loses its label on focus.
function KeyField({ name, hint, value, onChange, added, free, secret = true, note, link }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: T.text1 }}>{name}</span>
        {hint && <span style={{ fontSize: 10.5, color: T.text3 }}>{hint}</span>}
        <span style={{ marginLeft: 'auto' }}>
          {added
            ? <Pill color={T.success} bg="rgba(34,197,94,0.14)">✓ Added</Pill>
            : free ? <Pill color="#5eead4" bg="rgba(20,184,166,0.14)">Free</Pill> : null}
        </span>
      </div>
      <input type={secret ? 'password' : 'text'} placeholder={added ? '•••••••• — paste a new key to replace' : `Paste your ${name} key`}
        value={value} autoComplete="off" spellCheck={false} onChange={onChange}
        style={inp}
        onFocus={e => e.target.style.borderColor = T.accentFrom}
        onBlur={e => e.target.style.borderColor = T.border} />
      {note && <div style={{ fontSize: 10, color: T.text2, lineHeight: 1.4 }}>{note}{link && <> <a href={link.href} style={{ color: T.accentFrom }}>{link.label}</a></>}</div>}
    </div>
  )
}

// Big selectable AI-provider card (Managed vs BYOK) — the design #37 chooser.
function ProviderCard({ selected, onSelect, icon, accent, title, subtitle, recommended, desc, checks, cta }) {
  return (
    <div onClick={onSelect} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer',
      background: T.surface1, border: `1.5px solid ${selected ? accent : T.border}`, borderRadius: T.rCard, padding: '16px' }}>
      {recommended && <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 10, fontWeight: 600, color: T.success, background: 'rgba(16,185,129,0.14)', padding: '2px 9px', borderRadius: 999 }}>Recommended</span>}
      <div style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 18, background: `${accent}1f`, border: `1px solid ${accent}44` }}>{icon}</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text1 }}>{title}</div>
        <div style={{ fontSize: 12, color: accent, marginTop: 1 }}>{subtitle}</div>
      </div>
      <div style={{ fontSize: 12.5, color: T.text2, lineHeight: 1.5 }}>{desc}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {checks.map(c => <div key={c} style={{ display: 'flex', gap: 8, fontSize: 12, color: T.text2 }}><span style={{ color: T.success, flexShrink: 0 }}>✓</span><span>{c}</span></div>)}
      </div>
      <button onClick={e => { e.stopPropagation(); onSelect() }}
        style={{ marginTop: 'auto', height: 42, borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font, fontSize: 13, fontWeight: 600,
          background: selected ? accent : 'transparent', color: selected ? '#fff' : accent, border: `1px solid ${accent}` }}>
        {selected ? `✓ ${cta}` : cta}
      </button>
    </div>
  )
}

// Compact "How MockMate AI works" flow (design #37).
function HowItWorks() {
  const steps = [['💬', 'You ask a question'], ['☁️', 'MockMate receives it'], ['🧠', 'Smart router picks the best model'], ['⚡', 'Auto failover if needed'], ['✓', 'Instant answer delivered']]
  return (
    <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '14px 16px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text1, marginBottom: 12 }}>How MockMate AI works</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, flexWrap: 'wrap' }}>
        {steps.map(([ic, label], i) => (
          <React.Fragment key={i}>
            <div style={{ flex: 1, minWidth: 84, textAlign: 'center' }}>
              <div style={{ fontSize: 18 }}>{ic}</div>
              <div style={{ fontSize: 10.5, color: T.text2, marginTop: 4, lineHeight: 1.3 }}>{label}</div>
            </div>
            {i < steps.length - 1 && <div style={{ color: T.text3, alignSelf: 'center', fontSize: 12 }}>→</div>}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {['GPT', 'Claude', 'Gemini', 'Groq'].map(p => <span key={p} style={{ fontSize: 10, color: T.text3, background: T.surface2, border: `1px solid ${T.border}`, padding: '2px 8px', borderRadius: 999 }}>{p}</span>)}
      </div>
      <div style={{ fontSize: 10.5, color: T.text3, marginTop: 12, textAlign: 'center' }}>🔒 Your interview data is encrypted and never used to train models.</div>
    </div>
  )
}

// onSaved: called after a successful save so a parent can refresh its provider list.
// showStatus: when true, shows which providers are currently configured.
export default function ApiKeysPanel({ onSaved, showStatus = false, onModeChange }) {
  const [keyVals, setKeyVals] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [configured, setConfigured] = useState([])
  const [dg, setDg] = useState(false)
  const [showAdv, setShowAdv] = useState(false)
  const [mode, setModeState] = useState(getAiMode())
  const setMode = m => { setAiMode(m); setModeState(m); onModeChange?.(m) }

  const refresh = () => apiFetch('/api/providers').then(r => r.json()).then(d => {
    setConfigured(d.providers || []); setDg(!!d.deepgram)
  }).catch(() => {})
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = k => e => setKeyVals(v => ({ ...v, [k]: e.target.value }))
  const isAdded = p => configured.some(c => p.match.test(c.label || c.id || ''))

  async function save() {
    const lines = Object.entries(keyVals).filter(([, v]) => v.trim()).map(([k, v]) => `${k}=${v.trim()}`).join('\n')
    if (!lines) { setMsg('Enter at least one key'); return }
    setSaving(true); setMsg('')
    try {
      const r = await window.electronAPI?.writeEnv?.(lines + '\n')
      if (!r?.ok) throw new Error(r?.error || 'Save failed')
      await window.electronAPI?.applyKeys?.()      // applies the keys live (no relaunch)
      await new Promise(res => setTimeout(res, 1200))
      setKeyVals(EMPTY); setMsg('✓ Saved')
      await refresh()
      onSaved?.()
    } catch (e) { setMsg('⚠ ' + e.message) }
    setSaving(false)
  }

  const sectionLabel = { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: T.text3, textTransform: 'uppercase', margin: '2px 0 -2px' }
  const card = { display: 'flex', flexDirection: 'column', gap: 12, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '13px 14px' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: T.font }}>

      {/* ── AI provider — two-card chooser (design #37) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <ProviderCard selected={mode === 'managed'} onSelect={() => setMode('managed')}
          icon="✨" accent={T.accentFrom} title="Managed AI" subtitle="Powered by MockMate" recommended
          desc="No API keys. No setup. We automatically choose the best model for every task."
          checks={['No API keys required', 'Automatic best-model routing', 'Built-in failover & reliability', 'Optimized for interviews', 'Ready instantly']}
          cta="Use MockMate AI" />
        <ProviderCard selected={mode === 'byok'} onSelect={() => setMode('byok')}
          icon="🔑" accent="#8b5cf6" title="Bring your own API key" subtitle="Advanced"
          desc="Use your OpenAI, Anthropic, Gemini or Groq API keys."
          checks={['Pick your own models', 'Use your existing credits', 'Stored locally on this device', 'Advanced configuration']}
          cta="Use my own API key" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, padding: '9px 12px', fontSize: 11.5, color: T.text2 }}>
        <span>ⓘ</span><span>You can switch between these anytime. Your interviews and data are always private.</span>
      </div>

      {mode === 'managed' && <HowItWorks />}

      {mode === 'byok' && (<>
      {/* ── AI model ── */}
      <div style={sectionLabel}>AI model · add at least one</div>
      <div style={card}>
        {PROVIDERS.map(p => (
          <KeyField key={p.k} name={p.name} hint={p.hint} free={p.free} added={isAdded(p)}
            value={keyVals[p.k]} onChange={set(p.k)} />
        ))}
        <div style={{ fontSize: 10.5, color: '#86efac', lineHeight: 1.45, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: T.rCtrl, padding: '8px 10px' }}>
          💡 Add a <strong>second key</strong> (e.g. OpenAI + a free Gemini). If one is rate-limited or down, MockMate auto-switches mid-interview.
        </div>
      </div>

      {/* ── Voice ── */}
      <div style={sectionLabel}>Voice · optional</div>
      <div style={card}>
        <KeyField name="Deepgram" hint="live transcription" added={dg}
          value={keyVals.DEEPGRAM_API_KEY} onChange={set('DEEPGRAM_API_KEY')}
          note="Needed to answer by voice in Solo & Live. Free tier at" link={{ href: 'https://deepgram.com', label: 'deepgram.com' }} />
      </div>

      {/* ── Advanced (collapsed) ── */}
      <button onClick={() => setShowAdv(a => !a)}
        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: T.text2, fontSize: 11, fontWeight: 500, cursor: 'pointer', padding: 0, fontFamily: T.font }}>
        {showAdv ? '▾ Hide advanced' : '▸ Advanced — custom model & job search'}
      </button>
      {showAdv && (
        <div style={card}>
          <KeyField name="Custom OpenAI model id" hint="optional" secret={false}
            value={keyVals.OPENAI_MODEL} onChange={set('OPENAI_MODEL')}
            note="Blank = GPT-4o. Set any OpenAI model id to run it on your key. For Claude/Gemini/Groq, add the key above and pick the model in-app." />
          <div style={{ height: 1, background: T.border }} />
          <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.45 }}>
            <strong style={{ color: T.text1 }}>Job search (Adzuna)</strong> — free keys from <a href="https://developer.adzuna.com" style={{ color: T.accentFrom }}>developer.adzuna.com</a> add real local/on-site postings to Matching Jobs. Without them, only remote roles show.
          </div>
          <KeyField name="Adzuna App ID" secret={false} value={keyVals.ADZUNA_APP_ID} onChange={set('ADZUNA_APP_ID')} />
          <KeyField name="Adzuna App Key" value={keyVals.ADZUNA_APP_KEY} onChange={set('ADZUNA_APP_KEY')} />
        </div>
      )}

      {/* ── Save ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} disabled={saving}
          style={{ flex: 1, height: 42, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: T.font }}>
          {saving ? 'Saving…' : 'Save keys'}
        </button>
        {msg && <span style={{ fontSize: 11, fontWeight: 500, color: msg.startsWith('⚠') ? T.danger : T.success }}>{msg}</span>}
      </div>
      <div style={{ fontSize: 10, color: T.text3, textAlign: 'center' }}>Keys are stored only on this machine.</div>
      </>)}
    </div>
  )
}
