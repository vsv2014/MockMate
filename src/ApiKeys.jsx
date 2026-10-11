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
  borderRadius: T.rCtrl, color: T.text1, fontSize: 12,
  fontFamily: T.font,
}

// Provider ids map to stable credential families returned by /api/providers; display labels
// and model names may change independently, so they are not used to infer which key is saved.
const PROVIDERS = [
  { k: 'GROQ_API_KEY', name: 'Groq', hint: 'free · fastest — best to start', free: true, providerIds: ['groq'], testId: 'groq',
    note: 'No credit card. Create a free key at', link: { href: 'https://console.groq.com/keys', label: 'console.groq.com/keys' } },
  { k: 'GEMINI_API_KEY', name: 'Google Gemini', hint: 'free tier', free: true, providerIds: ['gemini', 'gemini_flash_lite', 'gemini_3_flash'], testId: 'gemini',
    note: 'Free with a Google account at', link: { href: 'https://aistudio.google.com/apikey', label: 'aistudio.google.com/apikey' } },
  { k: 'OPENAI_API_KEY', name: 'OpenAI', hint: 'GPT-4o · GPT-4o-mini — paid API', providerIds: ['openai', 'openai_mini', 'gpt_5', 'gpt_56_sol', 'gpt_56_terra', 'gpt_56_luna'], testId: 'openai_mini',
    note: 'Needs billing credit (not ChatGPT Plus) at', link: { href: 'https://platform.openai.com/api-keys', label: 'platform.openai.com' } },
  { k: 'ANTHROPIC_API_KEY', name: 'Anthropic', hint: 'Claude — paid API', providerIds: ['claude_fable', 'claude_opus', 'claude_sonnet_5', 'claude_sonnet', 'claude_haiku'], testId: 'claude_haiku',
    note: 'Needs billing credit at', link: { href: 'https://console.anthropic.com/settings/keys', label: 'console.anthropic.com' } },
  { k: 'CEREBRAS_API_KEY', name: 'Cerebras', hint: 'fast inference', providerIds: ['cerebras'], testId: 'cerebras',
    note: 'Create a key at', link: { href: 'https://cloud.cerebras.ai', label: 'cloud.cerebras.ai' } },
]
const EMPTY = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', CEREBRAS_API_KEY: '', DEEPGRAM_API_KEY: '', OPENAI_MODEL: '', GROQ_VISION_MODEL: '', VISION_API_KEY: '', VISION_MODEL: '', VISION_BASE_URL: '', ADZUNA_APP_ID: '', ADZUNA_APP_KEY: '' }

function Pill({ color, bg, children }) {
  return <span style={{ fontSize: 9.5, fontWeight: 600, color, background: bg, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{children}</span>
}

// A labeled key field with explicit saved/test state and a single associated input label.
function KeyField({ name, hint, value, onChange, added, free, secret = true, note, link, onRemove, onTest, testState }) {
  const id = `mm-key-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const noteId = `${id}-note`
  const testId = `${id}-test-status`
  const edited = !!value?.trim()
  const testing = testState?.status === 'testing'
  const badge = edited ? 'Replacement unsaved'
    : testState?.status === 'ok' ? 'Connection verified'
      : testState?.status === 'error' ? 'Configured · test failed'
        : testing ? 'Configured · testing'
          : added ? 'Configured · untested'
            : 'Entered · unsaved'
  const statusColor = testState?.status === 'ok' && !edited ? T.success : '#fbbf24'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label htmlFor={id} style={{ fontSize: 12.5, fontWeight: 500, color: T.text1 }}>{name}</label>
        {hint && <span style={{ fontSize: 10.5, color: T.text3 }}>{hint}</span>}
        <span style={{ marginLeft: 'auto' }}>
          {added || edited
            ? <Pill color={statusColor} bg={statusColor === T.success ? 'rgba(34,197,94,0.14)' : 'rgba(251,191,36,0.12)'}>{badge}</Pill>
            : free ? <Pill color="#5eead4" bg="rgba(20,184,166,0.14)">Free</Pill> : null}
        </span>
        {added && onTest && <button type="button" onClick={onTest} disabled={testing || edited}
          title={edited ? 'Save the replacement key before testing it.' : 'Sends one short text request; the provider may charge a small amount.'}
          aria-label={`Test ${name} connection`} aria-describedby={testState?.message ? testId : undefined}
          style={{ background: 'none', border: '1px solid rgba(94,234,212,0.3)', color: '#5eead4', fontSize: 10, cursor: testing || edited ? 'not-allowed' : 'pointer', opacity: testing || edited ? 0.55 : 1, padding: '3px 7px', borderRadius: 6 }}>
          {testing ? 'Testing…' : testState?.status === 'ok' || testState?.status === 'error' ? 'Test again' : 'Test connection'}
        </button>}
        {added && onRemove && <button type="button" onClick={onRemove} aria-label={`Remove saved ${name} key`}
          style={{ background: 'none', border: 'none', color: '#fca5a5', fontSize: 10, cursor: 'pointer', padding: '2px 0 2px 5px' }}>Remove</button>}
      </div>
      <input id={id} type={secret ? 'password' : 'text'} placeholder={added ? '•••••••• — paste a new key to replace' : `Paste your ${name} key`}
        value={value} autoComplete="off" spellCheck={false} onChange={onChange}
        aria-describedby={note ? noteId : undefined}
        style={inp}
        onFocus={e => e.target.style.borderColor = T.accentFrom}
        onBlur={e => e.target.style.borderColor = T.border} />
      {testState?.message && <div id={testId} role={testState.status === 'error' ? 'alert' : 'status'} aria-live={testState.status === 'error' ? 'assertive' : 'polite'} style={{ fontSize: 10.5, color: testState.status === 'error' ? T.danger : T.success }}>{testState.message}</div>}
      {note && <div id={noteId} style={{ fontSize: 10, color: T.text2, lineHeight: 1.4 }}>{note}{added && onTest && ' Testing sends one short request to the provider and may incur a small usage charge.'}{link && <> <a href={link.href} target="_blank" rel="noopener noreferrer" style={{ color: T.accentFrom }}>{link.label}</a></>}</div>}
    </div>
  )
}

// Native radio inputs provide arrow-key navigation and avoid nested clickable controls.
function ProviderCard({ selected, onSelect, value, icon, accent, title, subtitle, recommended, desc, checks, cta, disabled = false }) {
  const descriptionId = `mm-ai-mode-${value}-description`
  return (
    <label className="mm-ai-provider-card" style={{ position: 'relative', display: 'block', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.58 : 1 }}>
      <input type="radio" name="ai-mode" value={value} checked={selected} disabled={disabled} onChange={onSelect}
        aria-label={`${title}: ${subtitle}`} aria-describedby={descriptionId}
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }} />
      <div className="mm-ai-provider-content" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, minHeight: '100%',
        background: T.surface1, border: `1.5px solid ${selected ? accent : T.border}`, borderRadius: T.rCard, padding: '16px' }}>
        {recommended && <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 10, fontWeight: 600, color: T.success, background: 'rgba(16,185,129,0.14)', padding: '2px 9px', borderRadius: 999 }}>Recommended</span>}
        <div style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 18, background: `${accent}1f`, border: `1px solid ${accent}44` }} aria-hidden="true">{icon}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.text1 }}>{title}</div>
          <div style={{ fontSize: 12, color: accent, marginTop: 1 }}>{subtitle}</div>
        </div>
        <div id={descriptionId} style={{ fontSize: 12.5, color: T.text2, lineHeight: 1.5 }}>{desc}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {checks.map(c => <div key={c} style={{ display: 'flex', gap: 8, fontSize: 12, color: T.text2 }}><span aria-hidden="true" style={{ color: T.success, flexShrink: 0 }}>✓</span><span>{c}</span></div>)}
        </div>
        <span aria-hidden="true" style={{ marginTop: 'auto', minHeight: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: T.rCtrl,
          fontFamily: T.font, fontSize: 13, fontWeight: 600, background: selected ? accent : 'transparent', color: selected ? '#fff' : accent, border: `1px solid ${accent}` }}>
          {selected ? `✓ ${cta}` : cta}
        </span>
      </div>
    </label>
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
  const [providerStatusError, setProviderStatusError] = useState('')
  const [testResults, setTestResults] = useState({})
  const [showAdv, setShowAdv] = useState(false)
  const [mode, setModeState] = useState(getAiMode())
  const setMode = m => { setAiMode(m); setModeState(m); onModeChange?.(m) }

  const refresh = async () => {
    const response = await apiFetch('/api/providers')
    if (!response.ok) throw new Error(`Provider status returned HTTP ${response.status}`)
    const data = await response.json()
    setConfigured(Array.isArray(data.providers) ? data.providers : [])
    setDg(!!data.deepgram)
    setProviderStatusError('')
    return data
  }
  useEffect(() => { refresh().catch(error => setProviderStatusError(error?.message || 'Could not refresh provider status.')) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = k => e => {
    const value = e.target.value
    setKeyVals(v => ({ ...v, [k]: value }))
    if (PROVIDERS.some(provider => provider.k === k)) {
      setTestResults(results => ({ ...results, [k]: undefined }))
    }
  }
  const isAdded = p => configured.some(provider => p.providerIds.includes(String(provider.id || '')))

  async function testProvider(provider) {
    setTestResults(results => ({ ...results, [provider.k]: { status: 'testing', message: `Testing ${provider.name}…` } }))
    try {
      const response = await apiFetch('/api/providers/test', {
        method: 'POST', timeoutMs: 12_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.testId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.ok) throw new Error(data.error || `Provider test returned HTTP ${response.status}`)
      setTestResults(results => ({ ...results, [provider.k]: { status: 'ok', message: `Connection verified · ${data.model || provider.name}` } }))
    } catch (error) {
      setTestResults(results => ({ ...results, [provider.k]: { status: 'error', message: error?.message || 'Connection test failed.' } }))
    }
  }

  async function removeProvider(provider, label) {
    if (!window.confirm(`Clear the saved ${label} configuration from this device?`)) return
    setMsg('')
    try {
      const result = await window.electronAPI?.removeProviderKey?.(provider)
      if (!result?.ok) throw new Error(result?.error || 'Could not remove key')
      const applied = await window.electronAPI?.applyKeys?.()
      if (!applied?.ok) throw new Error(`Key cleared, but the local service could not reload: ${applied?.error || 'restart request failed'}`)
      await new Promise(resolve => setTimeout(resolve, 1200))
      await refresh()
      const providerRow = PROVIDERS.find(row => row.providerIds.includes(provider))
      if (providerRow) setTestResults(results => ({ ...results, [providerRow.k]: undefined }))
      setMsg(`✓ ${label} key cleared; updated provider configuration loaded. Connection status is not a key-validity check.`)
      onSaved?.()
    } catch (error) {
      setMsg(`⚠ ${error?.message || `Could not remove ${label}.`}`)
      refresh().catch(refreshError => setProviderStatusError(refreshError?.message || 'Could not refresh provider status.'))
    }
  }

  async function save() {
    const lines = Object.entries(keyVals).filter(([, value]) => value.trim()).map(([key, value]) => `${key}=${value.trim()}`).join('\n')
    if (!lines) { setMsg('Enter at least one key'); return }
    setSaving(true); setMsg('')
    try {
      const written = await window.electronAPI?.writeEnv?.(lines + '\n')
      if (!written?.ok) throw new Error(written?.error || 'Could not save keys')
      const applied = await window.electronAPI?.applyKeys?.()
      if (!applied?.ok) throw new Error(`Keys were saved, but the local service could not reload: ${applied?.error || 'restart request failed'}`)
      await new Promise(resolve => setTimeout(resolve, 1200))
      try {
        await refresh()
        setMsg('✓ Keys saved; updated provider configuration loaded. Connection has not been tested.')
      } catch (error) {
        setProviderStatusError(error?.message || 'Could not refresh provider status.')
        setMsg('⚠ Keys were saved, but provider status could not be refreshed. Retry the status check before relying on the new key.')
      }
      setKeyVals(EMPTY)
      setTestResults({})
      onSaved?.()
    } catch (error) {
      setMsg(`⚠ ${error?.message || 'Key save or service reload failed.'}`)
    } finally {
      setSaving(false)
    }
  }

  const sectionLabel = { fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: T.text3, textTransform: 'uppercase', margin: '2px 0 -2px' }
  const card = { display: 'flex', flexDirection: 'column', gap: 12, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '13px 14px' }

  const byokRecommended = !MANAGED_AVAILABLE || mode === 'byok'
  const configuredNames = configuredProviderNames([], configured)
  const canTestProviders = typeof window !== 'undefined' && !!window.electronAPI?.isElectron

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: T.font }}>
      <style>{`.mm-ai-provider-card:focus-within .mm-ai-provider-content{outline:2px solid ${T.accentFrom};outline-offset:3px}`}</style>

      {/* Voice first — required for Live; prevents “AI ready but Live blocked” surprise */}
      <div style={sectionLabel}>Voice · required for Live · needed for Solo voice</div>
      <div style={card}>
        <KeyField name="Deepgram" hint="live transcription" added={dg}
          value={keyVals.DEEPGRAM_API_KEY} onChange={set('DEEPGRAM_API_KEY')}
          onRemove={() => removeProvider('deepgram', 'Deepgram')}
          note="Required for Live Interview and Solo voice. Prefer a Project/Owner key (Member keys may fail token grant). Free tier at" link={{ href: 'https://console.deepgram.com', label: 'console.deepgram.com' }} />
        {mode === 'managed' && !dg && (
          <div role="status" style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.4 }}>Managed voice is included on supported hosted plans. BYOK/private mode requires your own Deepgram key.</div>
        )}
      </div>

      {/* ── AI provider — two-card chooser ── */}
      <div style={sectionLabel}>AI · how MockMate gets models</div>
      <div role="radiogroup" aria-label="AI mode" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <ProviderCard value="managed" selected={mode === 'managed'} onSelect={() => setMode('managed')}
          icon="✨" accent={T.accentFrom} title="Managed AI" subtitle="Hosted proxy (when configured)"
          disabled={!MANAGED_AVAILABLE}
          recommended={MANAGED_AVAILABLE}
          desc="Routes through MockMate’s authenticated backend with platform keys. Requires sign-in and a configured hosted API. Until then, add BYOK keys so Live/Solo still work."
          checks={['No personal API keys (when hosted)', 'Automatic model routing', 'Built-in failover', 'Usage caps may apply', 'Needs account + hosted API']}
          cta={MANAGED_AVAILABLE ? 'Use Managed AI' : 'Coming after hosted launch'} />
        <ProviderCard value="byok" selected={mode === 'byok'} onSelect={() => setMode('byok')}
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
          <div>AI: {configuredNames.length ? configuredNames.join(', ') : (mode === 'managed' ? 'No hosted provider reported' : 'None yet')}</div>
          <div style={{ marginTop: 2 }}>Voice: {dg ? 'Deepgram key configured · connection not tested' : 'Off'}</div>
        </div>
      )}
      {providerStatusError && (
        <div role="alert" aria-live="assertive" style={{ display: 'flex', alignItems: 'center', gap: 10, color: T.danger, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: T.rCtrl, padding: '9px 11px', fontSize: 11 }}>
          <span style={{ flex: 1 }}>Could not refresh provider status: {providerStatusError}</span>
          <button type="button" onClick={() => refresh().catch(error => setProviderStatusError(error?.message || 'Could not refresh provider status.'))}
            style={{ background: 'transparent', border: `1px solid ${T.borderStrong}`, color: T.text1, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {mode === 'byok' && (<>
      {/* ── AI model ── */}
      <div style={sectionLabel}>AI model · add at least one</div>
      <div style={card}>
        {PROVIDERS.map(p => (
          <KeyField key={p.k} name={p.name} hint={p.hint} free={p.free} added={isAdded(p)}
            onRemove={() => removeProvider(p.k.replace('_API_KEY', '').toLowerCase(), p.name)}
            onTest={canTestProviders ? () => testProvider(p) : undefined} testState={testResults[p.k]}
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
        {msg && <span role={msg.startsWith('⚠') ? 'alert' : 'status'} aria-live={msg.startsWith('⚠') ? 'assertive' : 'polite'} style={{ fontSize: 11, fontWeight: 500, color: msg.startsWith('⚠') ? T.danger : T.success }}>{msg}</span>}
      </div>
      <div style={{ fontSize: 10, color: T.text3, textAlign: 'center' }}>Keys are encrypted at rest on this machine (OS keychain when available).</div>
    </div>
  )
}
