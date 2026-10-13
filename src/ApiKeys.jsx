import React, { useState, useEffect, useRef } from 'react'
import { apiFetch } from './lib/apiClient'
import { T } from './auth/tokens'
import { getAiMode, setAiMode, MANAGED_AVAILABLE } from './lib/aiMode'
import { keyFieldStatus, configuredKeyRows } from './lib/keyStatus.js'
import { KEY_PROVIDERS, detectKeyProvider, describeDetection } from './lib/keyDetect.js'
import { PROVIDER_KEY_LINKS } from '../shared/modelRegistry.js'

const GEMINI_PRIVACY_NOTE = 'Privacy: on Gemini’s free tier, Google may use your prompts — including résumé and interview text — to improve its products. Use a billing-enabled (paid) project for interviews. Paid-tier prompts are not used for training, but Google keeps them for a limited time for abuse monitoring.'

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
  { k: 'GROQ_API_KEY', name: 'Groq', hint: 'Optional text provider', providerIds: ['groq'], testId: 'groq',
    note: 'Free tier has rate and token limits. Create your key at', link: PROVIDER_KEY_LINKS.groq },
  { k: 'GEMINI_API_KEY', name: 'Google Gemini', hint: 'Suggested starting provider · answers + screenshots', providerIds: ['gemini', 'gemini_flash_lite', 'gemini_3_flash'], testId: 'gemini',
    note: 'Use an existing key or create one in Google AI Studio. Creating a key is free; usage and limits depend on project billing. Open', link: PROVIDER_KEY_LINKS.gemini },
  { k: 'OPENAI_API_KEY', name: 'OpenAI', hint: 'Paid API · automatically chooses the available model', providerIds: ['openai', 'openai_mini', 'gpt_6_astra'], testId: 'openai_mini',
    note: 'Needs billing credit (not ChatGPT Plus) at', link: PROVIDER_KEY_LINKS.openai },
  { k: 'ANTHROPIC_API_KEY', name: 'Anthropic', hint: 'Claude — paid API', providerIds: ['claude_fable', 'claude_opus', 'claude_sonnet', 'claude_haiku'], testId: 'claude_haiku',
    note: 'Create a key scoped to your workspace; API billing is separate from a Claude subscription. Open', link: PROVIDER_KEY_LINKS.anthropic },
  { k: 'CEREBRAS_API_KEY', name: 'Cerebras', hint: 'fast inference', providerIds: ['cerebras'], testId: 'cerebras',
    note: 'Create a key at', link: PROVIDER_KEY_LINKS.cerebras },
  { k: 'OPENROUTER_API_KEY', name: 'OpenRouter', hint: 'Multi-model gateway — one key, many providers', providerIds: ['openrouter'], testId: 'openrouter',
    link: PROVIDER_KEY_LINKS.openrouter },
  { k: 'DEEPGRAM_API_KEY', name: 'Deepgram', hint: 'Voice transcription (STT)', providerIds: ['deepgram'], testId: 'deepgram' },
]
const EMPTY = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', CEREBRAS_API_KEY: '', OPENROUTER_API_KEY: '', DEEPGRAM_API_KEY: '', OPENAI_MODEL: '', GROQ_VISION_MODEL: '', VISION_API_KEY: '', VISION_MODEL: '', VISION_BASE_URL: '', ADZUNA_APP_ID: '', ADZUNA_APP_KEY: '' }

function Pill({ color, bg, children }) {
  return <span style={{ fontSize: 9.5, fontWeight: 600, color, background: bg, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{children}</span>
}

// A labeled key field with explicit saved/test state and a single associated input label.
function KeyField({ name, hint, value, onChange, added, status = 'ready', secret = true, note, link, onRemove, onTest, testState }) {
  const id = `mm-key-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const noteId = `${id}-note`
  const testId = `${id}-test-status`
  const edited = !!value?.trim()
  const testing = testState?.status === 'testing'
  const badge = keyFieldStatus({ added, edited, status, testStatus: testState?.status })
  const statusColor = status === 'ready' && testState?.status === 'ok' && !edited ? T.success : '#fbbf24'
  const [revealed, setRevealed] = React.useState(false)
  const inputType = secret && !revealed ? 'password' : 'text'
  const hasValue = added || edited
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label htmlFor={id} style={{ fontSize: 12.5, fontWeight: 500, color: T.text1 }}>{name}</label>
        {hint && <span style={{ fontSize: 10.5, color: T.text3 }}>{hint}</span>}
        <span style={{ marginLeft: 'auto' }}>
          <Pill color={statusColor} bg={statusColor === T.success ? 'rgba(34,197,94,0.14)' : 'rgba(251,191,36,0.12)'}>{badge}</Pill>
        </span>
        {added && onTest && <button type="button" onClick={onTest} disabled={testing || edited || status !== 'ready'}
          title={edited ? 'Save the replacement key before testing it.' : 'Verifies the key with a small probe request; the provider may charge a small amount.'}
          aria-label={`Test ${name} connection`} aria-describedby={testState?.message ? testId : undefined}
          style={{ background: 'none', border: '1px solid rgba(94,234,212,0.3)', color: '#5eead4', fontSize: 10, cursor: testing || edited ? 'not-allowed' : 'pointer', opacity: testing || edited ? 0.55 : 1, padding: '3px 7px', borderRadius: 6 }}>
          {testing ? 'Testing…' : testState?.status === 'ok' || testState?.status === 'error' ? 'Test again' : 'Test connection'}
        </button>}
        {added && onRemove && <button type="button" onClick={onRemove} aria-label={`Remove saved ${name} key`}
          style={{ background: 'none', border: 'none', color: '#fca5a5', fontSize: 10, cursor: 'pointer', padding: '2px 0 2px 5px' }}>Remove</button>}
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input id={id} type={inputType} placeholder={status !== 'ready' ? 'Key status not confirmed' : added ? 'Key already detected — leave blank to keep it' : `Paste your ${name} key`}
          value={value} autoComplete="off" spellCheck={false} onChange={onChange}
          aria-describedby={note ? noteId : undefined}
          style={{ ...inp, paddingRight: secret && hasValue ? 32 : undefined, flex: 1 }}
          onFocus={e => e.target.style.borderColor = T.accentFrom}
          onBlur={e => e.target.style.borderColor = T.border} />
        {secret && hasValue && (
          <button type="button" onClick={() => setRevealed(r => !r)} aria-label={revealed ? `Hide ${name} key` : `Show ${name} key`}
            title={revealed ? 'Hide key' : 'Show key'}
            style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: revealed ? T.accentFrom : T.text3, fontSize: 13, lineHeight: 1 }}>
            {revealed ? '🙈' : '👁'}
          </button>
        )}
      </div>
      {!edited && status === 'ready' && testState?.message && <div id={testId} role={testState.status === 'error' ? 'alert' : 'status'} aria-live={testState.status === 'error' ? 'assertive' : 'polite'} style={{ fontSize: 10.5, color: testState.status === 'error' ? T.danger : T.success }}>{testState.message}</div>}
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
  const [statusLoading, setStatusLoading] = useState(true)
  const [dg, setDg] = useState(false)
  const [providerStatusError, setProviderStatusError] = useState('')
  const [testResults, setTestResults] = useState({})
  const [showAdv, setShowAdv] = useState(false)
  const [routing, setRouting] = useState(null)
  // Single "Add API key" box: detection is a local suggestion the user confirms.
  const [addKey, setAddKey] = useState('')
  const [addChoice, setAddChoice] = useState('')     // provider env key chosen by hand ('' = follow detection)
  const [replacing, setReplacing] = useState(null)   // env key of the saved provider being replaced
  const [addSaving, setAddSaving] = useState(false)
  const [addMsg, setAddMsg] = useState('')
  const addInputRef = useRef(null)
  const [mode, setModeState] = useState(getAiMode())
  const setMode = m => { setAiMode(m); setModeState(m); onModeChange?.(m) }

  // BYOK settings must inspect the local service, even when Managed mode is selected.
  const keyApiFetch = (path, options = {}) => apiFetch(path, { ...options, localOnly: true })
  const refresh = async () => {
    setStatusLoading(true)
    try {
      const response = await keyApiFetch('/api/providers', { timeoutMs: 8000 })
      if (!response.ok) throw new Error(`Provider status returned HTTP ${response.status}`)
      const data = await response.json()
      setConfigured(configuredKeyRows(data))
      setRouting(data.routing || null)
      setDg(!!data.deepgram)
      setProviderStatusError('')
      return data
    } catch (error) {
      setProviderStatusError(error?.message || 'Could not refresh provider status.')
      throw error
    } finally { setStatusLoading(false) }
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
      const response = await keyApiFetch('/api/providers/test', {
        method: 'POST', timeoutMs: 12_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.testId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.ok) throw new Error(data.error || `Provider test returned HTTP ${response.status}`)
      setTestResults(results => ({ ...results, [provider.k]: { status: 'ok', message: provider.testId === 'deepgram' ? 'Deepgram key verified — transcription connection is valid.' : 'Text connection passed just now. Screenshot and voice capture are separate checks.' } }))
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

  // Keys are merged into the encrypted local store, then the local service reloads.
  async function persistKeyLines(lines) {
    const written = await window.electronAPI?.writeEnv?.(lines)
    if (!written?.ok) throw new Error(written?.error || 'Could not save keys')
    const applied = await window.electronAPI?.applyKeys?.()
    if (!applied?.ok) throw new Error(`Keys were saved, but the local service could not reload: ${applied?.error || 'restart request failed'}`)
    await new Promise(resolve => setTimeout(resolve, 1200))
  }

  const detection = detectKeyProvider(addKey)
  const addTarget = replacing || addChoice || detection.provider?.envKey || ''
  const targetProvider = KEY_PROVIDERS.find(p => p.envKey === addTarget) || null
  const detectionMismatch = !!(detection.provider && targetProvider && detection.confidence === 'high'
    && detection.provider.envKey !== targetProvider.envKey)
  const providerHelp = targetProvider
    ? (PROVIDERS.find(p => p.k === targetProvider.envKey)
      || (targetProvider.envKey === 'DEEPGRAM_API_KEY'
        ? { note: 'Deepgram is required for Live and Solo voice. Create a project key with speech transcription access; usage consumes project credits. Open', link: PROVIDER_KEY_LINKS.deepgram }
        : null))
    : null

  function startReplace(provider) {
    setReplacing(provider.k); setAddChoice(''); setAddKey(''); setAddMsg('')
    setTimeout(() => addInputRef.current?.focus(), 0)
  }
  function cancelReplace() { setReplacing(null); setAddKey(''); setAddMsg('') }

  async function saveAddedKey() {
    if (!targetProvider || !detection.value || detection.problem) return
    setAddSaving(true); setAddMsg(''); setMsg('')
    try {
      await persistKeyLines(`${targetProvider.envKey}=${detection.value}\n`)
      setTestResults(results => ({ ...results, [targetProvider.envKey]: undefined }))
      setAddKey(''); setAddChoice(''); setReplacing(null)
      try {
        await refresh()
        setAddMsg(`✓ ${targetProvider.name} key saved on this device. Test the connection before an interview.`)
      } catch (error) {
        setProviderStatusError(error?.message || 'Could not refresh provider status.')
        setAddMsg('⚠ The key was saved, but provider status could not be refreshed. Retry the status check before relying on it.')
      }
      onSaved?.()
    } catch (error) {
      setAddMsg(`⚠ ${error?.message || 'Key save or service reload failed.'}`)
    } finally {
      setAddSaving(false)
    }
  }

  async function save() {
    const lines = Object.entries(keyVals).filter(([, value]) => value.trim()).map(([key, value]) => `${key}=${value.trim()}`).join('\n')
    if (!lines) { setMsg('Enter at least one key'); return }
    setSaving(true); setMsg('')
    try {
      await persistKeyLines(lines + '\n')
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
  const configuredNames = PROVIDERS.filter(isAdded).map(p => p.name)
  const keyStatus = statusLoading ? 'loading' : providerStatusError ? 'error' : 'ready'
  const hasEdits = Object.values(keyVals).some(value => value.trim())
  const canTestProviders = typeof window !== 'undefined' && !!window.electronAPI?.isElectron
  const savedProviders = PROVIDERS.filter(isAdded)
  const routeBase = id => String(id || '').split('::')[0]
  const rolesFor = p => [
    routing?.fast && p.providerIds.includes(routeBase(routing.fast.id)) ? 'Quick answers' : null,
    routing?.strong && p.providerIds.includes(routeBase(routing.strong.id)) ? 'Coding & design' : null,
  ].filter(Boolean)
  const muted = { fontSize: 10.5, color: T.text3, lineHeight: 1.45 }
  const smallBtn = (color, border) => ({ background: 'none', border: `1px solid ${border}`, color, fontSize: 10.5, cursor: 'pointer', padding: '3px 8px', borderRadius: 6, fontFamily: T.font })
  const replacingProvider = replacing ? PROVIDERS.find(p => p.k === replacing) : null
  const canSaveAdded = !!detection.value && !!targetProvider && !detection.problem && !addSaving && keyStatus !== 'loading'

  return (
    <div className="mm-content-medium" style={{ fontFamily: T.font }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{`.mm-ai-provider-card:focus-within .mm-ai-provider-content{outline:2px solid ${T.accentFrom};outline-offset:3px}`}</style>

      {/* Voice first — required for Live; prevents “AI ready but Live blocked” surprise */}
      <div style={sectionLabel}>Voice · required for Live · needed for Solo voice</div>
      <div style={card}>
        <KeyField name="Deepgram" hint="voice transcription · separate from AI answers" added={dg} status={keyStatus}
          value={keyVals.DEEPGRAM_API_KEY} onChange={set('DEEPGRAM_API_KEY')}
          onRemove={() => removeProvider('deepgram', 'Deepgram')}
          onTest={() => testProvider({ k: 'DEEPGRAM_API_KEY', testId: 'deepgram', name: 'Deepgram' })}
          testState={testResults.DEEPGRAM_API_KEY}
          note="Required for Live and Solo voice. Create a project key with speech transcription access; usage consumes project credits. Open" link={PROVIDER_KEY_LINKS.deepgram} />
        {mode === 'managed' && !dg && (
          <div role="status" style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.4 }}>Managed voice is included on supported hosted plans. BYOK/private mode requires your own Deepgram key.</div>
        )}
      </div>

      {/* ── AI provider — two-card chooser ── */}
      <div style={sectionLabel}>AI access</div>
      <div role="radiogroup" aria-label="AI mode" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12 }}>
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
          checks={['Automatic AI selection from your keys', 'Use your existing credits', 'Keys encrypted at rest on this device', 'Test connection before an interview']}
          cta="Use my own API key" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, padding: '9px 12px', fontSize: 11.5, color: T.text2 }}>
        <span aria-hidden="true">ⓘ</span><span>You can switch anytime. BYOK keys stay local; audio/resume/screenshots still go to the providers you call — not “never leave the device.”</span>
      </div>

      {/* BYOK shows saved keys and routing in its own section below. */}
      {showStatus && mode !== 'byok' && (
        <div role="status" style={{ ...card, fontSize: 12, color: T.text2 }}>
          <div style={{ fontWeight: 600, color: T.text1, marginBottom: 4 }}>Keys detected on this device</div>
          <div>AI: {keyStatus !== 'ready' ? (statusLoading ? 'Checking…' : 'Status unavailable — retry below') : configuredNames.length ? configuredNames.join(', ') : (mode === 'managed' ? 'No hosted provider reported' : 'None yet')}</div>
          <div style={{ marginTop: 2 }}>Voice: {keyStatus !== 'ready' ? 'Status not confirmed' : dg ? 'Deepgram key detected · test audio in Ready Room' : 'No Deepgram key detected'}</div>
          <div>Blank fields keep existing keys. A detected key is not proof that a connection works. Test results apply only to this Settings visit.</div>
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
      {/* ── AI providers: routing summary, saved keys, one add box ── */}
      <div style={sectionLabel}>AI providers · one key is enough</div>
      <div style={card}>
        <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text1 }}>Which model answers</div>
          {keyStatus !== 'ready'
            ? <div style={muted}>{statusLoading ? 'Checking saved keys…' : 'Status unavailable — retry above.'}</div>
            : routing?.fast || routing?.strong ? (<>
              <div style={{ fontSize: 12, color: T.text2 }}>Quick answers: <strong style={{ color: T.text1 }}>{routing.fast?.label || routing.strong?.label}</strong></div>
              <div style={{ fontSize: 12, color: T.text2 }}>Coding &amp; system design: <strong style={{ color: T.text1 }}>{routing.strong?.label || routing.fast?.label}</strong></div>
              <div style={muted}>Chosen automatically from the keys saved on this device.</div>
            </>)
              : <div style={muted}>Add an AI key below to see which model will answer.</div>}
        </div>

        <div style={{ height: 1, background: T.border }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text1 }}>Saved AI keys</div>
          {keyStatus === 'ready' && savedProviders.length === 0 && <div style={muted}>No AI key saved on this device yet.</div>}
          {savedProviders.map(p => {
            const test = testResults[p.k]
            const testing = test?.status === 'testing'
            const badge = keyFieldStatus({ added: true, edited: false, status: keyStatus, testStatus: test?.status })
            const ok = keyStatus === 'ready' && test?.status === 'ok'
            const roles = rolesFor(p)
            return (
              <div key={p.k} role="group" aria-label={`${p.name} saved key`}
                style={{ display: 'flex', flexDirection: 'column', gap: 6, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, padding: '9px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: T.text1 }}>{p.name}</span>
                  {roles.length > 0 && <span style={{ fontSize: 10.5, color: T.text3 }}>{roles.join(' · ')}</span>}
                  <span style={{ marginLeft: 'auto' }}>
                    <Pill color={ok ? T.success : '#fbbf24'} bg={ok ? 'rgba(34,197,94,0.14)' : 'rgba(251,191,36,0.12)'}>{badge}</Pill>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {canTestProviders && (
                    <button type="button" onClick={() => testProvider(p)} disabled={testing || keyStatus !== 'ready'}
                      title="Sends one short text request; the provider may charge a small amount."
                      aria-label={`Test ${p.name} connection`}
                      style={{ ...smallBtn('#5eead4', 'rgba(94,234,212,0.3)'), opacity: testing ? 0.55 : 1, cursor: testing ? 'not-allowed' : 'pointer' }}>
                      {testing ? 'Testing…' : test?.status ? 'Test again' : 'Test'}
                    </button>
                  )}
                  <button type="button" onClick={() => startReplace(p)} aria-label={`Replace saved ${p.name} key`}
                    style={smallBtn(T.text1, T.borderStrong)}>Replace</button>
                  <button type="button" onClick={() => removeProvider(p.k.replace('_API_KEY', '').toLowerCase(), p.name)}
                    aria-label={`Remove saved ${p.name} key`} style={smallBtn('#fca5a5', 'rgba(252,165,165,0.35)')}>Remove</button>
                </div>
                {test?.message && keyStatus === 'ready' && (
                  <div role={test.status === 'error' ? 'alert' : 'status'} style={{ fontSize: 10.5, color: test.status === 'error' ? T.danger : T.success }}>{test.message}</div>
                )}
                {p.k === 'GEMINI_API_KEY' && <div style={muted}>{GEMINI_PRIVACY_NOTE}</div>}
              </div>
            )
          })}
          {canTestProviders && savedProviders.length > 0 && <div style={muted}>Testing sends one short request and may incur a small usage charge. A detected key is not proof that it works.</div>}
        </div>

        <div style={{ height: 1, background: T.border }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="mm-add-api-key" style={{ fontSize: 12.5, fontWeight: 600, color: T.text1 }}>
            {replacingProvider ? `Replace the ${replacingProvider.name} key` : 'Add API key'}
          </label>
          <input id="mm-add-api-key" ref={addInputRef} type="password" value={addKey} autoComplete="off" spellCheck={false}
            placeholder={replacingProvider ? `Paste the new ${replacingProvider.name} key` : 'Paste a key — its format is checked on this computer'}
            aria-describedby="mm-add-api-key-detect"
            onChange={e => { setAddKey(e.target.value); setAddMsg('') }}
            style={inp}
            onFocus={e => e.target.style.borderColor = T.accentFrom}
            onBlur={e => e.target.style.borderColor = T.border} />
          <div id="mm-add-api-key-detect" role="status" aria-live="polite"
            style={{ fontSize: 11, lineHeight: 1.4, color: detection.problem ? T.danger : T.text2 }}>
            {addKey ? describeDetection(detection) : 'MockMate suggests the provider from the key format. The key is not sent anywhere to identify it.'}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="mm-add-api-key-provider" style={{ fontSize: 11.5, color: T.text2 }}>Provider</label>
            <select id="mm-add-api-key-provider" value={addTarget} disabled={!!replacing}
              onChange={e => setAddChoice(e.target.value)}
              style={{ ...inp, width: 'auto', minWidth: 200, flex: '1 1 200px' }}>
              <option value="">Choose the provider…</option>
              {KEY_PROVIDERS.map(p => <option key={p.envKey} value={p.envKey}>{p.name}</option>)}
            </select>
            <button type="button" onClick={saveAddedKey} disabled={!canSaveAdded}
              style={{ height: 36, padding: '0 14px', background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 12, fontWeight: 600, fontFamily: T.font, cursor: canSaveAdded ? 'pointer' : 'not-allowed', opacity: canSaveAdded ? 1 : 0.5 }}>
              {addSaving ? 'Saving…' : detectionMismatch ? `Save as ${targetProvider.name} anyway` : 'Save key'}
            </button>
            {replacing && <button type="button" onClick={cancelReplace} style={smallBtn(T.text2, T.border)}>Cancel</button>}
          </div>
          {detectionMismatch && (
            <div role="alert" style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.4 }}>
              This key looks like {detection.provider.name}, not {targetProvider.name}. A key only works with the provider that issued it.
            </div>
          )}
          {targetProvider?.envKey === 'GEMINI_API_KEY' && <div style={muted}>{GEMINI_PRIVACY_NOTE}</div>}
          {providerHelp?.note && (
            <div style={muted}>{providerHelp.note}{providerHelp.link && <> <a href={providerHelp.link.href} target="_blank" rel="noopener noreferrer" style={{ color: T.accentFrom }}>{providerHelp.link.label}</a></>}</div>
          )}
          {addMsg && <div role={addMsg.startsWith('⚠') ? 'alert' : 'status'} style={{ fontSize: 11, fontWeight: 500, color: addMsg.startsWith('⚠') ? T.danger : T.success }}>{addMsg}</div>}
          <div style={muted}>One AI key is enough. A key works only with the provider that issued it — a Claude key does not unlock Gemini — so add a second provider only if you want a backup. Deepgram (above) handles voice separately. Model choice is automatic; you do not need a key for each model.</div>
        </div>
      </div>
      </>)}

      {mode === 'byok' && (<>
      {/* ── Advanced (collapsed) ── */}
      <button onClick={() => setShowAdv(a => !a)}
        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: T.text2, fontSize: 11, fontWeight: 500, cursor: 'pointer', padding: 0, fontFamily: T.font }}>
        {showAdv ? '▾ Hide advanced' : '▸ Advanced · optional integrations'}
      </button>
      {showAdv && (
        <div style={card}>
          <KeyField name="Custom OpenAI model id" hint="optional" secret={false}
            value={keyVals.OPENAI_MODEL} onChange={set('OPENAI_MODEL')}
            note="Optional expert override. Leave blank for automatic model discovery and routing. If an override stops working, MockMate attempts another compatible model." />
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

      {/* Save stays reachable while scrolling the key form. */}
      <div role="toolbar" aria-label="API key actions" style={{ position: 'sticky', bottom: 0, zIndex: 5, padding: '10px 0', background: T.surface1, borderTop: `1px solid ${T.border}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <button onClick={save} disabled={saving || !hasEdits}
          style={{ minWidth: 160, maxWidth: 280, height: 40, background: hasEdits ? T.accent : T.surface2, color: hasEdits ? '#fff' : T.text3, border: 'none', borderRadius: T.rCtrl, fontSize: 13, fontWeight: 600, cursor: saving || !hasEdits ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: T.font }}>
          {saving ? 'Saving…' : hasEdits ? 'Save key changes' : 'No unsaved key changes'}
        </button>
        {msg && <span role={msg.startsWith('⚠') ? 'alert' : 'status'} aria-live={msg.startsWith('⚠') ? 'assertive' : 'polite'} style={{ fontSize: 11, fontWeight: 500, color: msg.startsWith('⚠') ? T.danger : T.success }}>{msg}</span>}
      </div>
      <div style={{ fontSize: 10, color: T.text3, textAlign: 'center' }}>Keys are encrypted at rest on this machine (OS keychain when available).</div>
      </div>
    </div>
  )
}
