import React, { useState, useEffect } from 'react'
import { apiFetch } from './lib/apiClient'
import { T } from './auth/tokens'
import { getAiMode, setAiMode, MANAGED_AVAILABLE } from './lib/aiMode'
import { configuredProviderNames } from './lib/modelPicker'

// Reusable API-key entry. Used BOTH at the global level (Home → Settings) and inside
// Live Companion, so keys can be configured once without entering any specific mode.
// Keys are MERGED into encrypted userData/.env.enc by the main process (safeStorage; plaintext .env migrated)
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
  { k: 'GROQ_API_KEY', name: 'Groq', hint: 'free · fastest — best to start', free: true, match: /groq/i,
    note: 'No credit card. Create a free key at', link: { href: 'https://console.groq.com/keys', label: 'console.groq.com/keys' } },
  { k: 'GEMINI_API_KEY', name: 'Google Gemini', hint: 'free tier', free: true, match: /gemini|google/i,
    note: 'Free with a Google account at', link: { href: 'https://aistudio.google.com/apikey', label: 'aistudio.google.com/apikey' } },
  { k: 'OPENAI_API_KEY', name: 'OpenAI', hint: 'GPT-4o · GPT-4o-mini — paid API', match: /openai|gpt/i,
    note: 'Needs billing credit (not ChatGPT Plus) at', link: { href: 'https://platform.openai.com/api-keys', label: 'platform.openai.com' } },
  { k: 'ANTHROPIC_API_KEY', name: 'Anthropic', hint: 'Claude — paid API', match: /anthropic|claude/i,
    note: 'Needs billing credit at', link: { href: 'https://console.anthropic.com/settings/keys', label: 'console.anthropic.com' } },
  { k: 'CEREBRAS_API_KEY', name: 'Cerebras', hint: 'fast inference', match: /cerebras/i,
    note: 'Create a key at', link: { href: 'https://cloud.cerebras.ai', label: 'cloud.cerebras.ai' } },
]
const EMPTY = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', CEREBRAS_API_KEY: '', DEEPGRAM_API_KEY: '', OPENAI_MODEL: '', GROQ_VISION_MODEL: '', VISION_API_KEY: '', VISION_MODEL: '', VISION_BASE_URL: '', ADZUNA_APP_ID: '', ADZUNA_APP_KEY: '' }

function Pill({ color, bg, children }) {
  return <span style={{ fontSize: 9.5, fontWeight: 600, color, background: bg, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{children}</span>
}

// A single labeled key field: name + hint on the left, status/free pill on the right,
// input below. Far clearer than a placeholder-only box that loses its label on focus.
function KeyField({ name, hint, value, onChange, added, free, secret = true, note, link, onRemove }) {
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
        {added && onRemove && <button type="button" onClick={onRemove}
          style={{ background: 'none', border: 'none', color: '#fca5a5', fontSize: 10, cursor: 'pointer', padding: '2px 0 2px 5px' }}>Remove</button>}
      </div>
      <input type={secret ? 'password' : 'text'} placeholder={added ? '•••••••• — paste a new key to replace' : `Paste your ${name} key`}
        value={value} autoComplete="off" spellCheck={false} onChange={onChange}
        style={inp}
        onFocus={e => e.target.style.borderColor = T.accentFrom}
        onBlur={e => e.target.style.borderColor = T.border} />
      {note && <div style={{ fontSize: 10, color: T.text2, lineHeight: 1.4 }}>{note}{link && <> <a href={link.href} target="_blank" rel="noopener noreferrer" style={{ color: T.accentFrom }}>{link.label}</a></>}</div>}
    </div>
  )
}

// Big selectable AI-provider card (Managed vs BYOK) — the design #37 chooser.
function ProviderCard({ selected, onSelect, icon, accent, title, subtitle, recommended, desc, checks, cta }) {
  return (
    <div role="radio" aria-checked={selected} tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, cursor: 'pointer',
        background: T.surface1, border: `1.5px solid ${selected ? accent : T.border}`, borderRadius: T.rCard, padding: '16px' }}>
      {recommended && <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 10, fontWeight: 600, color: T.success, background: 'rgba(16,185,129,0.14)', padding: '2px 9px', borderRadius: 999 }}>Recommended</span>}
      <div style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 18, background: `${accent}1f`, border: `1px solid ${accent}44` }} aria-hidden="true">{icon}</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: T.text1 }}>{title}</div>
        <div style={{ fontSize: 12, color: accent, marginTop: 1 }}>{subtitle}</div>
      </div>
      <div style={{ fontSize: 12.5, color: T.text2, lineHeight: 1.5 }}>{desc}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {checks.map(c => <div key={c} style={{ display: 'flex', gap: 8, fontSize: 12, color: T.text2 }}><span style={{ color: T.success, flexShrink: 0 }}>✓</span><span>{c}</span></div>)}
      </div>
      <button type="button" onClick={e => { e.stopPropagation(); onSelect() }}
        style={{ marginTop: 'auto', height: 42, borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font, fontSize: 13, fontWeight: 600,
          background: selected ? accent : 'transparent', color: selected ? '#fff' : accent, border: `1px solid ${accent}` }}>
        {selected ? `✓ ${cta}` : cta}
      </button>
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

  async function removeProvider(provider, label) {
    if (!window.confirm(`Clear the saved ${label} configuration from this device?`)) return
    setMsg('')
    const r = await window.electronAPI?.removeProviderKey?.(provider)
    if (!r?.ok) { setMsg(`⚠ ${r?.error || 'Could not remove key'}`); return }
    setMsg(`✓ ${label} removed`)
    await window.electronAPI?.applyKeys?.()
    await refresh()
    onSaved?.()
  }

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

  const byokRecommended = !MANAGED_AVAILABLE || mode === 'byok'
  const configuredNames = configuredProviderNames([], configured)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: T.font }}>

      {/* Voice first — required for Live; prevents “AI ready but Live blocked” surprise */}
      <div style={sectionLabel}>Voice · required for Live · needed for Solo voice</div>
      <div style={card}>
        <KeyField name="Deepgram" hint="live transcription" added={dg}
          value={keyVals.DEEPGRAM_API_KEY} onChange={set('DEEPGRAM_API_KEY')}
          onRemove={() => removeProvider('deepgram', 'Deepgram')}
          note="Required for Live Interview and Solo voice. Prefer a Project/Owner key (Member keys may fail token grant). Free tier at" link={{ href: 'https://console.deepgram.com', label: 'console.deepgram.com' }} />
        {mode === 'managed' && !dg && (
          <div role="status" style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.4 }}>Managed AI does not include voice — add a Deepgram key here (Live will not start without it).</div>
        )}
      </div>

      {/* ── AI provider — two-card chooser ── */}
      <div style={sectionLabel}>AI · how MockMate gets models</div>
      <div role="radiogroup" aria-label="AI mode" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <ProviderCard selected={mode === 'managed'} onSelect={() => setMode('managed')}
          icon="✨" accent={T.accentFrom} title="Managed AI" subtitle="Hosted proxy (when configured)"
          recommended={MANAGED_AVAILABLE}
          desc="Routes through MockMate’s authenticated backend with platform keys. Requires sign-in and a configured hosted API. Until then, add BYOK keys so Live/Solo still work."
          checks={['No personal API keys (when hosted)', 'Automatic model routing', 'Built-in failover', 'Usage caps may apply', 'Needs account + hosted API']}
          cta="Use Managed AI" />
        <ProviderCard selected={mode === 'byok'} onSelect={() => setMode('byok')}
          icon="🔑" accent="#8b5cf6" title="Bring your own API key" subtitle={byokRecommended ? 'Best choice until Managed is hosted' : 'Use your own provider keys'}
          recommended={!MANAGED_AVAILABLE}
          desc="Use your OpenAI, Anthropic, Gemini, Groq, or Cerebras keys. Keys stay in local app storage; interview content still goes to those providers."
          checks={['Pick your own models', 'Use your existing credits', 'Keys encrypted at rest on this device', 'Test keys before a real interview']}
          cta="Use my own API key" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, padding: '9px 12px', fontSize: 11.5, color: T.text2 }}>
        <span aria-hidden="true">ⓘ</span><span>You can switch anytime. BYOK keys stay local; audio/resume/screenshots still go to the providers you call — not “never leave the device.”</span>
      </div>

      {showStatus && (
        <div role="status" style={{ ...card, fontSize: 12, color: T.text2 }}>
          <div style={{ fontWeight: 600, color: T.text1, marginBottom: 4 }}>Currently configured</div>
          <div>AI: {configuredNames.length ? configuredNames.join(', ') : (mode === 'managed' ? 'Managed unavailable / no provider reported' : 'None yet')}</div>
          <div style={{ marginTop: 2 }}>Voice: {dg ? 'Deepgram connected' : 'Off'}</div>
        </div>
      )}

      {mode === 'byok' && (<>
      {/* ── AI model ── */}
      <div style={sectionLabel}>AI model · add at least one</div>
      <div style={card}>
        {PROVIDERS.map(p => (
          <KeyField key={p.k} name={p.name} hint={p.hint} free={p.free} added={isAdded(p)}
            onRemove={() => removeProvider(p.k.replace('_API_KEY', '').toLowerCase(), p.name)}
            note={p.note} link={p.link}
            value={keyVals[p.k]} onChange={set(p.k)} />
        ))}
        <div style={{ fontSize: 10.5, color: '#86efac', lineHeight: 1.45, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: T.rCtrl, padding: '8px 10px' }}>
          Start free with <strong>Groq</strong> or <strong>Gemini</strong> — no card needed. Add a second key for failover if one is rate-limited. (ChatGPT Plus is <strong>not</strong> an API key.)
        </div>
      </div>
      </>)}

      {mode === 'byok' && (<>
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
          <button type="button" onClick={() => removeProvider('openai_model', 'OpenAI model overrides')} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#fca5a5', padding: 0, fontSize: 10.5, cursor: 'pointer' }}>Clear OpenAI model overrides</button>
          <KeyField name="Groq vision model id" hint="optional · screenshots" secret={false}
            value={keyVals.GROQ_VISION_MODEL} onChange={set('GROQ_VISION_MODEL')}
            note="Uses the Groq key above only for screenshot analysis. Leave blank unless your Groq account exposes a vision-capable model." />
          <button type="button" onClick={() => removeProvider('groq_vision', 'Groq vision override')} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#fca5a5', padding: 0, fontSize: 10.5, cursor: 'pointer' }}>Clear Groq vision override</button>
          <div style={{ height: 1, background: T.border }} />
          <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.45 }}><strong style={{ color: T.text1 }}>Custom vision gateway</strong> — OpenAI-compatible endpoints only.</div>
          <KeyField name="Vision base URL" secret={false} value={keyVals.VISION_BASE_URL} onChange={set('VISION_BASE_URL')} />
          <KeyField name="Vision model id" secret={false} value={keyVals.VISION_MODEL} onChange={set('VISION_MODEL')} />
          <KeyField name="Vision API key" value={keyVals.VISION_API_KEY} onChange={set('VISION_API_KEY')} />
          <button type="button" onClick={() => removeProvider('custom_vision', 'custom vision gateway')} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#fca5a5', padding: 0, fontSize: 10.5, cursor: 'pointer' }}>Clear custom vision gateway</button>
          <div style={{ height: 1, background: T.border }} />
          <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.45 }}>
            <strong style={{ color: T.text1 }}>Job search (Adzuna)</strong> — free keys from <a href="https://developer.adzuna.com" style={{ color: T.accentFrom }}>developer.adzuna.com</a> add real local/on-site postings to Matching Jobs. Without them, only remote roles show.
          </div>
          <KeyField name="Adzuna App ID" secret={false} value={keyVals.ADZUNA_APP_ID} onChange={set('ADZUNA_APP_ID')} />
          <KeyField name="Adzuna App Key" value={keyVals.ADZUNA_APP_KEY} onChange={set('ADZUNA_APP_KEY')} />
          <button type="button" onClick={() => removeProvider('adzuna', 'Adzuna job-search')} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#fca5a5', padding: 0, fontSize: 10.5, cursor: 'pointer' }}>Clear Adzuna configuration</button>
        </div>
      )}
      </>)}

      {/* ── Save (BYOK fields + always-visible Deepgram) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} disabled={saving}
          style={{ flex: 1, height: 42, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: T.font }}>
          {saving ? 'Saving…' : 'Save keys'}
        </button>
        {msg && <span style={{ fontSize: 11, fontWeight: 500, color: msg.startsWith('⚠') ? T.danger : T.success }}>{msg}</span>}
      </div>
      <div style={{ fontSize: 10, color: T.text3, textAlign: 'center' }}>Keys are encrypted at rest on this machine (OS keychain when available).</div>
    </div>
  )
}
