import { useState } from 'react'
import { loadProfile, saveProfile } from './lib/profile'
import { scoreColor } from './lib/ui'
import { NoKeysBanner } from './Jobs'

// AI career toolkit (the "legit", sellable side): ATS resume score, per-role tailoring,
// and referral-message drafting — all from the resume the user already has + the LLM.
const TABS = [['ats', '📊 ATS Score'], ['tailor', '✏️ Tailor Resume'], ['referral', '🤝 Referral DM']]

function CopyBtn({ text }) {
  const [done, setDone] = useState(false)
  if (!text) return null
  return <button onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
    style={{ ...chip, cursor: 'pointer', border: 'none', color: done ? '#4ade80' : '#5eead4' }}>{done ? '✓ Copied' : '📋 Copy'}</button>
}

export default function Career({ onHome, noProviders, onSettings }) {
  const [profile, setProfile] = useState(() => loadProfile())
  const [tab, setTab] = useState('ats')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  // JD is kept in LOCAL state (not written to the shared profile): the Career JD is per-analysis
  // and must not clobber profile.jobDescription, which LiveCompanion uses for the live interview.
  // Seeded from any existing JD as a convenience.
  const [jd, setJd] = useState(() => loadProfile().jobDescription || '')
  // referral-only extra fields
  const [company, setCompany] = useState(profile.targetCompany || '')
  const [person, setPerson] = useState('')

  const hasResume = !!(profile.resume && profile.resume.trim())
  const patch = p => { const next = { ...profile, ...p }; setProfile(next); saveProfile(next) }
  const setTabReset = t => { setTab(t); setResult(null); setError('') }

  async function run(path, body) {
    setError(''); setLoading(true); setResult(null)
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const text = await res.text()
      let d = null; try { d = JSON.parse(text) } catch {}
      if (!res.ok || d?.error) setError(d?.error || `Request failed (${res.status})`)
      else if (!d || typeof d !== 'object') setError('Got an unexpected response from the server. Please try again.')
      else setResult(d)
    } catch (e) { setError(e.message || 'Could not reach the service.') } finally { setLoading(false) }
  }

  const base = { resume: profile.resume || '', targetRole: profile.targetRole || '', jobDescription: jd }

  return (
    <div style={{ padding: '12px 14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button onClick={onHome} style={btnGhost}>← Back</button>
        <div style={{ fontWeight: 700, fontSize: 13 }}>🎯 Resume &amp; Career Tools</div>
      </div>

      {/* Tabs */}
      <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTabReset(k)}
            style={{ flex: 1, fontSize: 11, fontWeight: 700, padding: '6px 4px', borderRadius: 7, cursor: 'pointer', border: '1px solid',
              borderColor: tab === k ? 'rgba(13,148,136,0.6)' : 'rgba(255,255,255,0.1)',
              background: tab === k ? 'rgba(13,148,136,0.22)' : 'transparent', color: tab === k ? '#5eead4' : '#94a3b8' }}>{label}</button>
        ))}
      </div>

      {noProviders && <NoKeysBanner onSettings={onSettings} what="Resume scoring & tailoring" />}

      {!hasResume && (
        <div style={{ ...note, borderColor: '#7f1d1d', background: '#450a0a', color: '#fca5a5' }}>
          No resume yet. Paste it in <strong>Solo Practice → setup</strong> (or upload a PDF in Live Companion) — it's reused here.
        </div>
      )}

      <label style={lbl}>Target role</label>
      <input style={input} value={profile.targetRole || ''} placeholder="e.g. Senior Backend Engineer"
        onChange={e => patch({ targetRole: e.target.value })} />

      {tab !== 'referral' && (
        <>
          <label style={lbl}>Job description (optional — sharpens it)</label>
          <textarea rows={3} style={{ ...input, resize: 'vertical' }} value={jd} placeholder="Paste the JD…"
            onChange={e => setJd(e.target.value)} />
        </>
      )}

      {tab === 'referral' && (
        <>
          <label style={lbl}>Company</label>
          <input style={input} value={company} placeholder="e.g. Stripe"
            onChange={e => { setCompany(e.target.value); patch({ targetCompany: e.target.value }) }} />
          <label style={lbl}>Person you're asking (optional)</label>
          <input style={input} value={person} placeholder="e.g. Priya, EM on the Payments team" onChange={e => setPerson(e.target.value)} />
        </>
      )}

      <button disabled={loading || !hasResume || noProviders} style={btnPrimary}
        onClick={() => tab === 'ats' ? run('/api/ats-score', base)
          : tab === 'tailor' ? run('/api/tailor-resume', base)
          : run('/api/referral', { resume: base.resume, targetRole: base.targetRole, company, person })}>
        {loading ? 'Working…' : tab === 'ats' ? '📊 Score my resume' : tab === 'tailor' ? '✏️ Tailor my resume' : '🤝 Draft referral message'}
      </button>

      {error && <div style={{ ...note, borderColor: '#7f1d1d', background: '#450a0a', color: '#fca5a5' }} role="alert">{error}</div>}

      {result && tab === 'ats' && <AtsResult r={result} />}
      {result && tab === 'tailor' && <TailorResult r={result} />}
      {result && tab === 'referral' && <ReferralResult r={result} />}
    </div>
  )
}

function AtsResult({ r }) {
  const pct = Math.max(0, Math.min(100, r.overallScore ?? 0))
  return (
    <div style={{ marginTop: 12 }} aria-live="polite">
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ fontSize: 30, fontWeight: 800, color: scoreColor(pct) }}>{pct}<span style={{ fontSize: 13, color: '#475569' }}>/100</span></div>
        <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>{r.verdict}</div>
      </div>
      {r.dimensions?.length > 0 && (
        <div style={card}>
          <div style={sectionLbl}>SCORECARD</div>
          {r.dimensions.map((d, i) => {
            const ds = Math.max(0, Math.min(5, Number(d.score) || 0))   // LLM scores aren't enforced 0-5
            return (
              <div key={i} style={{ marginBottom: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}><span style={{ fontWeight: 600 }}>{d.name}</span><span style={{ color: scoreColor((ds / 5) * 100) }}>{ds}/5</span></div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, margin: '3px 0' }}><div style={{ height: '100%', width: `${(ds / 5) * 100}%`, background: scoreColor((ds / 5) * 100), borderRadius: 2 }} /></div>
                <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{d.comment}</div>
              </div>
            )
          })}
        </div>
      )}
      {r.missingKeywords?.length > 0 && <Block title="MISSING KEYWORDS">{r.missingKeywords.map((k, i) => <span key={i} style={chip}>{k}</span>)}</Block>}
      {r.topFixes?.length > 0 && <Block title="TOP FIXES">{r.topFixes.map((f, i) => <li key={i} style={li}>{f}</li>)}</Block>}
      {r.redFlags?.length > 0 && <Block title="⚠ AUTO-REJECT RISKS">{r.redFlags.map((f, i) => <li key={i} style={{ ...li, color: '#fca5a5' }}>{f}</li>)}</Block>}
    </div>
  )
}

function TailorResult({ r }) {
  const full = [r.summary && `SUMMARY:\n${r.summary}`, r.rewrittenBullets?.length && 'REWRITTEN BULLETS:\n' + r.rewrittenBullets.map(b => `• ${b.after}`).join('\n'), r.keywordsToAdd?.length && `KEYWORDS TO ADD: ${r.keywordsToAdd.join(', ')}`].filter(Boolean).join('\n\n')
  return (
    <div style={{ marginTop: 12 }} aria-live="polite">
      <div style={{ marginBottom: 8 }}><CopyBtn text={full} /></div>
      {r.summary && <Block title="TAILORED SUMMARY"><div style={para}>{r.summary}</div></Block>}
      {r.rewrittenBullets?.length > 0 && (
        <div style={card}><div style={sectionLbl}>STRONGER BULLETS</div>
          {r.rewrittenBullets.map((b, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, color: '#64748b', textDecoration: 'line-through' }}>{b.before}</div>
              <div style={{ fontSize: 12, color: '#dcfce7', marginTop: 2 }}>→ {b.after}</div>
            </div>
          ))}
        </div>
      )}
      {r.keywordsToAdd?.length > 0 && <Block title="KEYWORDS TO ADD">{r.keywordsToAdd.map((k, i) => <span key={i} style={chip}>{k}</span>)}</Block>}
      {r.sectionOrder?.length > 0 && <Block title="SECTION ORDER"><div style={para}>{r.sectionOrder.join(' → ')}</div></Block>}
      {r.notes?.length > 0 && <Block title="NOTES">{r.notes.map((n, i) => <li key={i} style={li}>{n}</li>)}</Block>}
    </div>
  )
}

function ReferralResult({ r }) {
  return (
    <div style={{ marginTop: 12 }} aria-live="polite">
      {r.short && <Block title="CONNECTION NOTE (short)"><div style={para}>{r.short}</div><div style={{ marginTop: 6 }}><CopyBtn text={r.short} /></div></Block>}
      {r.message && <Block title="FULL REFERRAL MESSAGE"><div style={{ ...para, whiteSpace: 'pre-wrap' }}>{r.message}</div><div style={{ marginTop: 6 }}><CopyBtn text={r.message} /></div></Block>}
      {r.why && <div style={{ fontSize: 10.5, color: '#5eead4', marginTop: 4 }}>✓ {r.why}</div>}
    </div>
  )
}

function Block({ title, children }) {
  return <div style={card}><div style={sectionLbl}>{title}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{children}</div></div>
}

const lbl = { display: 'block', fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }
const input = { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '8px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 10, boxSizing: 'border-box' }
const btnPrimary = { width: '100%', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', marginTop: 2 }
const btnGhost = { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer' }
const note = { fontSize: 11, color: '#94a3b8', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '8px 10px', margin: '10px 0', lineHeight: 1.5 }
const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, padding: '11px 12px', marginBottom: 8 }
const sectionLbl = { fontSize: 9, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 6 }
const chip = { fontSize: 10, color: '#5eead4', background: 'rgba(13,148,136,0.15)', padding: '2px 8px', borderRadius: 10, display: 'inline-block' }
const li = { fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 4, listStylePosition: 'inside' }
const para = { fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }
