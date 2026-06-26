import React, { useState, useEffect } from 'react'

// Reusable API-key entry. Used BOTH at the global level (Home → Settings) and inside
// Live Companion, so keys can be configured once without entering any specific mode.
// Keys are MERGED into userData/.env by the main process (adding one never wipes others)
// and applied live, so they immediately work for Solo, Companion, and Jobs alike.

const inp = {
  width: '100%', boxSizing: 'border-box', padding: '7px 9px',
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6, color: '#e2e8f0', fontSize: 11, outline: 'none'
}

const KEY_FIELDS = [
  { k: 'OPENAI_API_KEY', label: 'OpenAI  (GPT-4o / GPT-4o-mini)' },
  { k: 'ANTHROPIC_API_KEY', label: 'Anthropic / Claude  (Opus · Sonnet · Haiku)' },
  { k: 'GEMINI_API_KEY', label: 'Google Gemini' },
  { k: 'GROQ_API_KEY', label: 'Groq (free, fast)' },
  { k: 'DEEPGRAM_API_KEY', label: 'Deepgram API key' },
]
const EMPTY = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', GROQ_API_KEY: '', DEEPGRAM_API_KEY: '', OPENAI_MODEL: '', ADZUNA_APP_ID: '', ADZUNA_APP_KEY: '' }

// onSaved: called after a successful save so a parent can refresh its provider list.
// showStatus: when true, shows which providers are currently configured.
export default function ApiKeysPanel({ onSaved, showStatus = false }) {
  const [keyVals, setKeyVals] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [configured, setConfigured] = useState([])
  const [dg, setDg] = useState(false)

  const refresh = () => fetch('/api/providers').then(r => r.json()).then(d => {
    setConfigured(d.providers || []); setDg(!!d.deepgram)
  }).catch(() => {})
  useEffect(() => { if (showStatus) refresh() }, [showStatus]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>
        Paste a key to enable that provider. Leave others blank. Stored only on this machine.
      </div>
      <div style={{ fontSize: 10, color: '#86efac', lineHeight: 1.4, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, padding: '6px 8px' }}>
        💡 Add a <strong>second provider's key</strong> (e.g. OpenAI + a free Gemini) — if one is rate-limited or has an outage, MockMate auto-switches to the other mid-interview.
      </div>
      {showStatus && (
        <div style={{ fontSize: 10, color: configured.length ? '#86efac' : '#fca5a5', lineHeight: 1.5 }}>
          {configured.length
            ? `✓ Configured: ${configured.map(p => p.label).join(', ')}${dg ? ' · Deepgram' : ''}`
            : 'No keys configured yet — add at least one below.'}
        </div>
      )}
      {KEY_FIELDS.map(({ k, label }) => (
        <React.Fragment key={k}>
          <input type="password" placeholder={label} value={keyVals[k]} autoComplete="off"
            onChange={e => setKeyVals(v => ({ ...v, [k]: e.target.value }))} style={inp} />
          {k === 'DEEPGRAM_API_KEY' && (
            <div style={{ fontSize: 9, color: '#64748b', lineHeight: 1.4, marginTop: -2 }}>
              Required for voice in Solo and Live. Free tier available at <span style={{ color: '#5eead4' }}>deepgram.com</span>.
            </div>
          )}
        </React.Fragment>
      ))}
      {/* Custom model id — use ANY OpenAI model with your key (not a secret, so plain text). */}
      <input type="text" placeholder="Custom OpenAI model id (optional — e.g. gpt-4o, or a newer id)" value={keyVals.OPENAI_MODEL} autoComplete="off" spellCheck={false}
        onChange={e => setKeyVals(v => ({ ...v, OPENAI_MODEL: e.target.value }))} style={inp} />
      <div style={{ fontSize: 9, color: '#64748b', lineHeight: 1.4, marginTop: -2 }}>
        Leave the model blank for GPT-4o. Set it to run any other OpenAI model id on your key. For Claude/Gemini/Groq, add their key above and pick the model from the dropdown.
      </div>

      {/* Job search (optional) — enables LOCAL on-site jobs in Matching Jobs */}
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.04em', marginTop: 6 }}>JOB SEARCH (optional — for local on-site jobs)</div>
      <div style={{ fontSize: 9, color: '#64748b', lineHeight: 1.4, marginTop: -2 }}>
        Free keys from <span style={{ color: '#5eead4' }}>developer.adzuna.com</span> add real local/on-site postings (incl. India) to Matching Jobs. Without them, only remote roles show.
      </div>
      <input type="text" placeholder="Adzuna App ID" value={keyVals.ADZUNA_APP_ID} autoComplete="off" spellCheck={false}
        onChange={e => setKeyVals(v => ({ ...v, ADZUNA_APP_ID: e.target.value }))} style={inp} />
      <input type="password" placeholder="Adzuna App Key" value={keyVals.ADZUNA_APP_KEY} autoComplete="off"
        onChange={e => setKeyVals(v => ({ ...v, ADZUNA_APP_KEY: e.target.value }))} style={inp} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={save} disabled={saving}
          style={{ flex: 1, padding: '7px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save keys'}
        </button>
        {msg && <span style={{ fontSize: 10, color: msg.startsWith('⚠') ? '#fca5a5' : '#86efac' }}>{msg}</span>}
      </div>
    </div>
  )
}
