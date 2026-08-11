import { useState, useEffect, useRef } from 'react'
import { apiFetch } from './lib/apiClient'
import { loadProfile, saveProfile, applyTailorToResume } from './lib/profile'
import { scoreColor } from './lib/ui'
import { T } from './auth/tokens'
import { S, tabStyle, NoKeysBanner, ResumeMaterials } from './lib/secondaryUi'

// Resume Studio — ATS score, tailor, referral DM.

const TABS = [
  ['ats', 'ATS Score'],
  ['tailor', 'Tailor Resume'],
  ['referral', 'Referral DM'],
]

function CopyBtn({ text }) {
  const [done, setDone] = useState(false)
  if (!text) return null
  return (
    <button type="button"
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
      style={{ ...S.chip, cursor: 'pointer', border: 'none', color: done ? T.success : T.accentFrom, fontFamily: T.font }}>
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function Career({
  onHome, noProviders, onSettings, embedded,
  initialJd, initialRole, initialCompany, initialTab, limitedJd, onSeedConsumed,
}) {
  const [profile, setProfile] = useState(() => loadProfile())
  const [tab, setTab] = useState(() => (['ats', 'tailor', 'referral'].includes(initialTab) ? initialTab : 'ats'))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  // JD is local only — must not clobber profile.jobDescription used by Live.
  const [jd, setJd] = useState(() => initialJd ?? (loadProfile().jobDescription || ''))
  const [company, setCompany] = useState(() => initialCompany || profile.targetCompany || '')
  const [person, setPerson] = useState('')
  const [seedNote, setSeedNote] = useState(() => !!limitedJd)
  const [applyMsg, setApplyMsg] = useState('')
  const seedDone = useRef(false)

  // One-shot seed from Jobs handoff
  useEffect(() => {
    if (seedDone.current) return
    if (initialJd == null && !initialRole && !initialCompany && !initialTab) return
    seedDone.current = true
    if (initialJd != null) setJd(initialJd)
    if (limitedJd) setSeedNote(true)
    if (['ats', 'tailor', 'referral'].includes(initialTab)) {
      setTab(initialTab)
      setResult(null)
      setError('')
    }
    const patch = {}
    if (initialRole) patch.targetRole = initialRole
    if (initialCompany) patch.targetCompany = initialCompany
    if (Object.keys(patch).length) {
      setProfile(prev => {
        const next = { ...prev, ...patch }
        saveProfile(next)
        return next
      })
      if (initialCompany) setCompany(initialCompany)
    }
    onSeedConsumed?.()
  }, [initialJd, initialRole, initialCompany, initialTab, limitedJd, onSeedConsumed])

  const hasResume = !!(profile.resume && profile.resume.trim())
  const patch = p => { const next = { ...profile, ...p }; setProfile(next); saveProfile(next) }
  const setTabReset = t => { setTab(t); setResult(null); setError(''); setApplyMsg('') }

  async function run(path, body) {
    setError(''); setLoading(true); setResult(null); setApplyMsg('')
    try {
      const res = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const text = await res.text()
      let d = null; try { d = JSON.parse(text) } catch {}
      if (!res.ok || d?.error) setError(d?.error || `Request failed (${res.status})`)
      else if (!d || typeof d !== 'object') setError('Got an unexpected response from the server. Please try again.')
      else setResult(d)
    } catch (e) { setError(e.message || 'Could not reach the service.') } finally { setLoading(false) }
  }

  function applyTailor(r) {
    if (!window.confirm('Updates the resume shared with Solo, Live, and Jobs. Continue?')) return
    const nextResume = applyTailorToResume(profile.resume || '', r)
    patch({ resume: nextResume })
    setApplyMsg('Resume updated — shared with Solo, Live, and Job Matching.')
  }

  const base = { resume: profile.resume || '', targetRole: profile.targetRole || '', jobDescription: jd }
  const canRun = hasResume && !noProviders && !loading
  const primaryLabel = loading
    ? 'Working…'
    : tab === 'ats' ? 'Score my resume'
    : tab === 'tailor' ? 'Tailor my resume'
    : 'Draft referral message'

  return (
    <div style={{ padding: embedded ? 0 : '12px 14px 16px', fontFamily: T.font, color: T.text1 }}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button type="button" onClick={onHome} style={S.btnGhost}>← Back</button>
          <div style={{ fontWeight: 600, fontSize: 15, color: T.text1 }}>Resume Studio</div>
        </div>
      )}

      <div role="tablist" aria-label="Resume Studio tools" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTabReset(k)} style={tabStyle(tab === k)}>
            {label}
          </button>
        ))}
      </div>

      {noProviders && (
        <NoKeysBanner onSettings={onSettings} what="ATS scoring, tailoring, and referral drafts need an AI key." />
      )}

      {seedNote && (
        <div role="status" style={{ ...S.note, borderColor: 'rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24' }}>
          Limited JD from the job listing — paste a fuller description below for better ATS / tailor results.
        </div>
      )}

      <div style={S.panel}>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, marginBottom: 4 }}>Your materials</div>
        <div style={{ fontSize: 12, color: T.text3, marginBottom: 12, lineHeight: 1.45 }}>
          <strong style={{ color: T.text2 }}>Resume and target role</strong> are shared with Solo, Live, and Job Matching.
          The job description below is for <strong style={{ color: T.text2 }}>this analysis only</strong> — it does not change your Live/Solo JD.
        </div>
        <ResumeMaterials resume={profile.resume} onPatch={patch} />
        {!hasResume && (
          <div role="status" style={{ ...S.note, borderColor: 'rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.08)', color: '#fca5a5', marginBottom: 0 }}>
            Paste a resume or upload a PDF to use these tools.
          </div>
        )}
      </div>

      <div style={S.panel}>
        <label style={S.lbl}>Target role</label>
        <input style={S.input} value={profile.targetRole || ''} placeholder="e.g. Senior Backend Engineer"
          onChange={e => patch({ targetRole: e.target.value })} />

        {tab !== 'referral' && (
          <>
            <label style={S.lbl}>Job description for this analysis (optional — not saved to Live/Solo)</label>
            <textarea rows={3} style={{ ...S.input, resize: 'vertical' }} value={jd} placeholder="Paste a JD to score or tailor against…"
              onChange={e => { setJd(e.target.value); setSeedNote(false) }} />
          </>
        )}

        {tab === 'referral' && (
          <>
            <label style={S.lbl}>Company</label>
            <input style={S.input} value={company} placeholder="e.g. Stripe"
              onChange={e => { setCompany(e.target.value); patch({ targetCompany: e.target.value }) }} />
            <label style={S.lbl}>Person you’re asking (optional)</label>
            <input style={{ ...S.input, marginBottom: 0 }} value={person} placeholder="e.g. Priya, EM on the Payments team"
              onChange={e => setPerson(e.target.value)} />
          </>
        )}
      </div>

      <button
        type="button"
        disabled={!canRun}
        style={{
          ...S.btnPrimary,
          opacity: canRun ? 1 : 0.55,
          cursor: canRun ? 'pointer' : 'default',
          marginBottom: 12,
        }}
        onClick={() => tab === 'ats' ? run('/api/ats-score', base)
          : tab === 'tailor' ? run('/api/tailor-resume', base)
          : run('/api/referral', { resume: base.resume, targetRole: base.targetRole, company, person })}
      >
        {primaryLabel}
      </button>
      {!hasResume && !noProviders && (
        <div role="status" style={{ fontSize: 12, color: T.text3, marginTop: -4, marginBottom: 12 }}>
          Add a resume above to enable this action.
        </div>
      )}

      {loading && <div role="status" style={S.note}>Working…</div>}

      {error && (
        <div role="alert" style={{ ...S.note, borderColor: 'rgba(244,63,94,0.4)', background: 'rgba(244,63,94,0.08)', color: '#fca5a5' }}>
          {error}
        </div>
      )}
      {applyMsg && (
        <div role="status" style={{ ...S.note, borderColor: 'rgba(16,185,129,0.35)', background: 'rgba(16,185,129,0.08)', color: T.success }}>
          {applyMsg}
        </div>
      )}

      {result && tab === 'ats' && <AtsResult r={result} />}
      {result && tab === 'tailor' && <TailorResult r={result} onApply={() => applyTailor(result)} />}
      {result && tab === 'referral' && <ReferralResult r={result} />}
    </div>
  )
}

function AtsResult({ r }) {
  const pct = Math.max(0, Math.min(100, r.overallScore ?? 0))
  return (
    <div style={{ marginTop: 4 }} aria-live="polite">
      <div style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: scoreColor(pct), lineHeight: 1 }}>{pct}</div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>ATS score /100</div>
        </div>
        <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.55 }}>{r.verdict}</div>
      </div>
      {r.dimensions?.length > 0 && (
        <div style={S.card}>
          <div style={S.sectionLbl}>Scorecard (each /5)</div>
          {r.dimensions.map((d, i) => {
            const ds = Math.max(0, Math.min(5, Number(d.score) || 0))
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span style={{ fontWeight: 600, color: T.text1 }}>{d.name}</span>
                  <span style={{ color: scoreColor((ds / 5) * 100) }}>{ds} / 5</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, margin: '5px 0' }}>
                  <div style={{ height: '100%', width: `${(ds / 5) * 100}%`, background: scoreColor((ds / 5) * 100), borderRadius: 2 }} />
                </div>
                {d.comment && <div style={{ fontSize: 12, color: T.text3 }}>{d.comment}</div>}
              </div>
            )
          })}
        </div>
      )}
      {r.missingKeywords?.length > 0 && <Block title="Missing keywords">{r.missingKeywords.map((k, i) => <span key={i} style={S.chip}>{k}</span>)}</Block>}
      {r.topFixes?.length > 0 && <Block title="Top fixes">{r.topFixes.map((f, i) => <li key={i} style={li}>{f}</li>)}</Block>}
      {r.redFlags?.length > 0 && <Block title="Auto-reject risks">{r.redFlags.map((f, i) => <li key={i} style={{ ...li, color: '#fca5a5' }}>{f}</li>)}</Block>}
    </div>
  )
}

function TailorResult({ r, onApply }) {
  const full = [r.summary && `SUMMARY:\n${r.summary}`, r.rewrittenBullets?.length && 'REWRITTEN BULLETS:\n' + r.rewrittenBullets.map(b => `• ${b.after}`).join('\n'), r.keywordsToAdd?.length && `KEYWORDS TO ADD: ${r.keywordsToAdd.join(', ')}`].filter(Boolean).join('\n\n')
  return (
    <div style={{ marginTop: 4 }} aria-live="polite">
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <CopyBtn text={full} />
        <button type="button" onClick={onApply}
          style={{
            fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font,
            background: 'rgba(20,184,166,0.15)', border: '1px solid rgba(20,184,166,0.4)', color: T.accentFrom,
          }}>
          Apply summary + bullets to my resume
        </button>
      </div>
      {r.summary && <Block title="Tailored summary"><div style={para}>{r.summary}</div></Block>}
      {r.rewrittenBullets?.length > 0 && (
        <div style={S.card}>
          <div style={S.sectionLbl}>Stronger bullets</div>
          {r.rewrittenBullets.map((b, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: T.text3, textDecoration: 'line-through' }}>{b.before}</div>
              <div style={{ fontSize: 13, color: '#dcfce7', marginTop: 3 }}>→ {b.after}</div>
            </div>
          ))}
        </div>
      )}
      {r.keywordsToAdd?.length > 0 && <Block title="Keywords to add">{r.keywordsToAdd.map((k, i) => <span key={i} style={S.chip}>{k}</span>)}</Block>}
      {r.sectionOrder?.length > 0 && <Block title="Section order"><div style={para}>{r.sectionOrder.join(' → ')}</div></Block>}
      {r.notes?.length > 0 && <Block title="Notes">{r.notes.map((n, i) => <li key={i} style={li}>{n}</li>)}</Block>}
    </div>
  )
}

function ReferralResult({ r }) {
  return (
    <div style={{ marginTop: 4 }} aria-live="polite">
      {r.short && <Block title="Connection note (short)"><div style={para}>{r.short}</div><div style={{ marginTop: 8 }}><CopyBtn text={r.short} /></div></Block>}
      {r.message && <Block title="Full referral message"><div style={{ ...para, whiteSpace: 'pre-wrap' }}>{r.message}</div><div style={{ marginTop: 8 }}><CopyBtn text={r.message} /></div></Block>}
      {r.why && <div style={{ fontSize: 12, color: T.accentFrom, marginTop: 4 }}>✓ {r.why}</div>}
    </div>
  )
}

function Block({ title, children }) {
  return (
    <div style={S.card}>
      <div style={S.sectionLbl}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{children}</div>
    </div>
  )
}

const li = { fontSize: 12.5, color: T.text2, lineHeight: 1.5, marginBottom: 4, listStylePosition: 'inside', width: '100%' }
const para = { fontSize: 13, color: T.text2, lineHeight: 1.6 }
