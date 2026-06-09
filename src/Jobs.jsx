import { useState, useEffect, useCallback } from 'react'

// Same key Solo/LiveCompanion use, so the resume the user already pasted is reused.
const PROFILE_KEY = 'peerMockProfile'
function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {} } catch { return {} } }
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)) } catch {} }

function scoreColor(s) {
  if (s >= 80) return '#22c55e'
  if (s >= 60) return '#a3e635'
  if (s >= 45) return '#f59e0b'
  return '#64748b'
}

export default function Jobs({ onHome }) {
  const [profile, setProfile] = useState(loadProfile())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)   // { search, jobs, ranker, note }

  const hasResume = !!(profile.resume && profile.resume.trim())

  const find = useCallback(async () => {
    setError(''); setLoading(true); setResult(null)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: profile.resume || '', targetRole: profile.targetRole || '' })
      }).then(r => r.json())
      if (res.error) setError(res.error)
      else setResult(res)
    } catch (e) { setError(e.message || 'Could not reach the job service.') }
    finally { setLoading(false) }
  }, [profile.resume, profile.targetRole])

  // Auto-run once on open if a resume is already saved.
  useEffect(() => { if (hasResume) find() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: '12px 14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button onClick={onHome} style={btnGhost}>← Back</button>
        <div style={{ fontWeight: 700, fontSize: 13 }}>💼 Matching Jobs</div>
      </div>

      {/* Target role — refines the search; resume comes from your profile */}
      <label style={lbl}>Target role (optional — sharpens the match)</label>
      <input
        type="text" value={profile.targetRole || ''} placeholder="e.g. Senior Backend Engineer"
        onChange={e => { const p = { ...profile, targetRole: e.target.value }; setProfile(p); saveProfile(p) }}
        style={input} />

      {!hasResume && (
        <div style={{ ...note, borderColor: '#7f1d1d', background: '#450a0a', color: '#fca5a5' }}>
          No resume saved yet. Open <strong>Solo Practice</strong> and paste your resume in setup — it's reused here automatically.
        </div>
      )}

      <button onClick={find} disabled={loading || (!hasResume && !profile.targetRole)} style={btnPrimary}>
        {loading ? 'Finding roles…' : result ? '↻ Refresh matches' : '🔍 Find matching jobs'}
      </button>

      {error && <div style={{ ...note, borderColor: '#7f1d1d', background: '#450a0a', color: '#fca5a5' }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>Searched: <strong style={{ color: '#94a3b8' }}>{result.search}</strong></span>
            <span>{result.ranker === 'ai' ? '✨ AI-ranked' : 'keyword-ranked'}</span>
          </div>

          {result.note && <div style={note}>{result.note}</div>}

          {result.jobs.map(j => (
            <div key={j.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ ...scorePill, color: scoreColor(j.score), borderColor: scoreColor(j.score) }}>{j.score}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, lineHeight: 1.3 }}>{j.title}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                    {j.company}{j.location ? ` · ${j.location}` : ''}{j.jobType ? ` · ${j.jobType}` : ''}
                  </div>
                </div>
              </div>
              {j.reason && <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 7, lineHeight: 1.5 }}>✓ {j.reason}</div>}
              {j.gaps && <div style={{ fontSize: 10.5, color: '#f59e0b', marginTop: 3, lineHeight: 1.5 }}>△ Gap: {j.gaps}</div>}
              {j.tags?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
                  {j.tags.slice(0, 5).map(t => <span key={t} style={tag}>{t}</span>)}
                </div>
              )}
              <a href={j.url} target="_blank" rel="noreferrer" style={applyLink}>Apply →</a>
            </div>
          ))}

          {result.jobs.length === 0 && !result.note && (
            <div style={note}>No strong matches found. Try a broader target role.</div>
          )}
        </div>
      )}
    </div>
  )
}

const lbl = { display: 'block', fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }
const input = { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '8px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 10, boxSizing: 'border-box' }
const btnPrimary = { width: '100%', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer' }
const note = { fontSize: 11, color: '#94a3b8', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '8px 10px', margin: '10px 0', lineHeight: 1.5 }
const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, padding: '11px 12px', marginBottom: 8, position: 'relative' }
const scorePill = { minWidth: 30, height: 30, borderRadius: 7, border: '1.5px solid', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }
const tag = { fontSize: 9, color: '#a5b4fc', background: 'rgba(109,40,217,0.15)', padding: '2px 7px', borderRadius: 10 }
const applyLink = { display: 'inline-block', marginTop: 9, fontSize: 11, fontWeight: 700, color: '#a78bfa', textDecoration: 'none' }
