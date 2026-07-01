import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from './lib/apiClient'
// Resume/profile is shared with Solo & LiveCompanion via the same store.
import { loadProfile, saveProfile } from './lib/profile'
import { scoreColor } from './lib/ui'
import { loadSavedJobs, saveJob, removeSavedJob, savedKeySet, savedKeyOf, SAVED_MAX } from './savedJobs'

// "today" / "3d ago" — relative posting age.
function ago(ts) {
  if (!ts) return ''
  const d = Date.now() - ts
  if (d < 0) return ''
  const day = 86400000
  if (d < day) return 'today'
  const n = Math.floor(d / day)
  return n >= 30 ? `${Math.floor(n / 30)}mo ago` : `${n}d ago`
}

const SORTS = [['fit', 'Best fit'], ['recent', 'Newest'], ['salary', 'Salary']]
function sortJobs(jobs, sort) {
  const arr = [...jobs]
  if (sort === 'salary') return arr.sort((a, b) => (b.salaryNum || 0) - (a.salaryNum || 0) || b.score - a.score)
  if (sort === 'recent') return arr.sort((a, b) => (b.postedTs || 0) - (a.postedTs || 0) || b.score - a.score)
  return arr.sort((a, b) => b.score - a.score)   // best fit
}

// One job row — reused by both the Matches results and the Saved dashboard.
function JobCard({ j, saved, onToggleSave }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ ...scorePill, color: scoreColor(j.score), borderColor: scoreColor(j.score) }}>{j.score}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 12.5, lineHeight: 1.3, flex: 1, minWidth: 0 }}>{j.title}</span>
            <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
              color: j.source === 'local' ? '#4ade80' : '#7dd3fc',
              background: j.source === 'local' ? 'rgba(34,197,94,0.12)' : 'rgba(56,189,248,0.12)' }}>
              {j.source === 'local' ? '🏢 On-site' : '🌐 Remote'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
            {j.company}{j.location ? ` · ${j.location}` : ''}{j.jobType ? ` · ${j.jobType}` : ''}{j.salary ? ` · 💰 ${j.salary}` : ''}{j.postedTs ? ` · ${ago(j.postedTs)}` : ''}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9 }}>
        <a href={j.url} target="_blank" rel="noreferrer" style={applyLink}>Apply →</a>
        <button onClick={() => onToggleSave(j)} aria-pressed={saved}
          style={{ ...saveBtn, color: saved ? '#fbbf24' : '#64748b', borderColor: saved ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)' }}>
          {saved ? '★ Saved' : '☆ Save'}
        </button>
      </div>
    </div>
  )
}

// Shown across Jobs & Career when no API key is configured — a real CTA into Settings instead of
// firing a request that fails with a raw provider error.
export function NoKeysBanner({ onSettings, what }) {
  return (
    <div style={{ ...note, borderColor: 'rgba(20,184,166,0.45)', background: 'rgba(20,184,166,0.1)', color: '#5eead4' }}>
      <div style={{ marginBottom: 8 }}>⚠ <strong>No API key yet.</strong> {what} needs an AI key — add one (OpenAI / Claude / Gemini / Groq; Gemini &amp; Groq have free tiers).</div>
      <button onClick={onSettings} style={{ ...btnPrimary, width: 'auto', padding: '6px 14px', fontSize: 11.5 }}>⚙ Open Settings</button>
    </div>
  )
}

export default function Jobs({ onHome, noProviders, embedded }) {
  const [profile, setProfile] = useState(() => loadProfile())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)   // { search, jobs, ranker, note }
  const [visible, setVisible] = useState(8)     // how many results to show (Load more reveals more)
  const [sort, setSort] = useState('fit')       // fit | recent | salary
  const [tab, setTab] = useState('matches')     // matches | saved
  const [savedJobs, setSavedJobs] = useState(loadSavedJobs)
  const [savedSet, setSavedSet] = useState(savedKeySet)

  const hasResume = !!(profile.resume && profile.resume.trim())

  const toggleSave = useCallback(job => {
    const list = savedSet.has(savedKeyOf(job)) ? removeSavedJob(job) : saveJob(job)
    setSavedJobs(list)
    setSavedSet(new Set(list.map(savedKeyOf)))
  }, [savedSet])

  const find = useCallback(async () => {
    setError(''); setLoading(true); setResult(null); setVisible(8)
    try {
      const res = await apiFetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: profile.resume || '', targetRole: profile.targetRole || '', location: profile.location || '' })
      })
      // The server can answer with a non-JSON body (e.g. the rate-limiter's plain-text 429),
      // so parse defensively and surface the real status instead of a misleading "can't reach".
      const text = await res.text()
      let d = null; try { d = JSON.parse(text) } catch {}
      if (!res.ok || d?.error) setError(d?.error || `Could not load jobs (${res.status})`)
      else if (!d) setError('Got an unexpected response from the job service. Please try again.')
      else setResult(d)
    } catch (e) { setError(e.message || 'Could not reach the job service.') }
    finally { setLoading(false) }
  }, [profile.resume, profile.targetRole, profile.location])

  // Auto-run once on open if a resume is already saved. Jobs works WITHOUT an API key (keyless
  // Remotive + keyword ranking); a key only upgrades ranking to AI — so this never needs a key gate.
  useEffect(() => { if (hasResume) find() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: embedded ? 0 : '12px 14px 16px' }}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button onClick={onHome} style={btnGhost}>← Back</button>
          <div style={{ fontWeight: 700, fontSize: 13 }}>💼 Matching Jobs</div>
        </div>
      )}

      {/* Matches / Saved tabs */}
      <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['matches', '🔍 Matches'], ['saved', `★ Saved${savedJobs.length ? ` (${savedJobs.length})` : ''}`]].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            style={{ flex: 1, fontSize: 11, fontWeight: 700, padding: '6px 4px', borderRadius: 7, cursor: 'pointer', border: '1px solid',
              borderColor: tab === k ? 'rgba(20,184,166,0.6)' : 'rgba(255,255,255,0.1)',
              background: tab === k ? 'rgba(20,184,166,0.22)' : 'transparent', color: tab === k ? '#5eead4' : '#94a3b8' }}>{label}</button>
        ))}
      </div>

      {tab === 'saved' ? (
        savedJobs.length === 0 ? (
          <div style={note}>No saved jobs yet. Tap <strong style={{ color: '#fbbf24' }}>☆ Save</strong> on any match to bookmark it here for later.</div>
        ) : (
          <div style={{ marginTop: 2 }}>
            {savedJobs.length >= SAVED_MAX && (
              <div style={{ ...note, borderColor: '#4a3a18', background: '#2a1f12', color: '#f5c66b' }}>
                Saved list is full ({SAVED_MAX} max). Saving another will drop the oldest — remove some to keep them.
              </div>
            )}
            {savedJobs.map(j => (
              <div key={savedKeyOf(j)}>
                <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>Saved {ago(j.savedTs) || 'today'}</div>
                <JobCard j={j} saved onToggleSave={toggleSave} />
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          {/* Target role — refines the search; resume comes from your profile */}
          <label style={lbl}>Target role (sharpens the match — overrides the resume's field)</label>
          <input
            type="text" value={profile.targetRole || ''} placeholder="e.g. Senior Test Engineer"
            onChange={e => { const p = { ...profile, targetRole: e.target.value }; setProfile(p); saveProfile(p) }}
            style={input} />

          {/* Location — filters remote roles to those open to your region */}
          <label style={lbl}>Location (filters roles open to your region)</label>
          <input
            type="text" value={profile.location || ''} placeholder="e.g. Hyderabad, India"
            onChange={e => { const p = { ...profile, location: e.target.value }; setProfile(p); saveProfile(p) }}
            style={input} />

          {noProviders && (
            <div style={{ ...note, borderColor: 'rgba(20,184,166,0.3)', color: '#5eead4' }}>
              💡 Add an API key in ⚙ Settings to upgrade from keyword matching to <strong>AI ranking</strong> (smarter fit + reasons). Jobs still work without one.
            </div>
          )}

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

              {result.jobs.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: '#475569' }}>Sort:</span>
                  {SORTS.map(([k, label]) => (
                    <button key={k} onClick={() => setSort(k)}
                      style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 6, cursor: 'pointer', border: '1px solid',
                        borderColor: sort === k ? 'rgba(20,184,166,0.6)' : 'rgba(255,255,255,0.1)',
                        background: sort === k ? 'rgba(20,184,166,0.25)' : 'transparent',
                        color: sort === k ? '#5eead4' : '#64748b' }}>{label}</button>
                  ))}
                </div>
              )}

              {result.note && <div style={note}>{result.note}</div>}
              {result.localEnabled === false && !result.note && (
                <div style={{ ...note, borderColor: 'rgba(20,184,166,0.3)', color: '#5eead4' }}>
                  💡 Showing remote roles. Add free <strong>Adzuna keys</strong> in ⚙ Settings to also include <strong>local on-site jobs</strong> for your city.
                </div>
              )}

              {sortJobs(result.jobs, sort).slice(0, visible).map(j => (
                <JobCard key={savedKeyOf(j) || j.id} j={j} saved={savedSet.has(savedKeyOf(j))} onToggleSave={toggleSave} />
              ))}

              {visible < result.jobs.length && (
                <button onClick={() => setVisible(v => v + 8)} style={btnLoadMore}>
                  ↓ Load more ({result.jobs.length - visible} more)
                </button>
              )}
              {result.jobs.length > 0 && visible >= result.jobs.length && result.jobs.length > 8 && (
                <div style={{ fontSize: 10, color: '#475569', textAlign: 'center', marginTop: 6 }}>That's all {result.jobs.length} matches.</div>
              )}

              {result.jobs.length === 0 && !result.note && (
                <div style={note}>No strong matches found. Try a broader target role, or clear the location filter.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const lbl = { display: 'block', fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }
const input = { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '8px 10px', color: '#e2e8f0', fontSize: 12, marginBottom: 10, boxSizing: 'border-box' }
const btnPrimary = { width: '100%', background: '#14B8A6', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }
const btnGhost = { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer' }
const note = { fontSize: 11, color: '#94a3b8', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '8px 10px', margin: '10px 0', lineHeight: 1.5 }
const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, padding: '11px 12px', marginBottom: 8, position: 'relative' }
const scorePill = { minWidth: 30, height: 30, borderRadius: 7, border: '1.5px solid', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }
const tag = { fontSize: 9, color: '#5eead4', background: 'rgba(20,184,166,0.15)', padding: '2px 7px', borderRadius: 10 }
const applyLink = { display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#5eead4', textDecoration: 'none' }
const saveBtn = { fontSize: 11, fontWeight: 700, background: 'transparent', border: '1px solid', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }
const btnLoadMore = { width: '100%', background: 'rgba(20,184,166,0.15)', color: '#5eead4', border: '1px solid rgba(20,184,166,0.4)', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 4 }
