import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from './lib/apiClient'
import { loadProfile, saveProfile } from './lib/profile'
import { scoreColor } from './lib/ui'
import { T } from './auth/tokens'
import { loadSavedJobs, saveJob, removeSavedJob, updateSavedJob, savedKeySet, savedKeyOf, SAVED_MAX, SAVED_STATUSES } from './savedJobs'
import { S, tabStyle, NoKeysBanner, YearsChips, ResumeMaterials } from './lib/secondaryUi'
import { jobAnalysisJd } from './lib/jobsHandoff'

// Session-level cache of the last search (survives the view being unmounted/remounted).
let jobsCache = null   // { key, result }

function ago(ts) {
  if (!ts) return ''
  const d = Date.now() - ts
  if (d < 0) return ''
  const day = 86400000
  if (d < day) return 'today'
  const n = Math.floor(d / day)
  return n >= 30 ? `${Math.floor(n / 30)}mo ago` : `${n}d ago`
}

export { jobAnalysisJd }

const SORTS = [['fit', 'Best fit'], ['recent', 'Newest'], ['salary', 'Salary']]
function sortJobs(jobs, sort) {
  const arr = [...jobs]
  if (sort === 'salary') return arr.sort((a, b) => (b.salaryNum || 0) - (a.salaryNum || 0) || b.score - a.score)
  if (sort === 'recent') return arr.sort((a, b) => (b.postedTs || 0) - (a.postedTs || 0) || b.score - a.score)
  return arr.sort((a, b) => b.score - a.score)
}

const STATUS_LABEL = {
  interested: 'Interested',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  passed: 'Passed',
}

function JobCard({ j, saved, onToggleSave, onOpenCareer, showTracking, onUpdateSaved }) {
  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          minWidth: 34, height: 34, borderRadius: 9, border: `1.5px solid ${scoreColor(j.score)}`,
          color: scoreColor(j.score), display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0,
        }}>{j.score}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.35, flex: 1, minWidth: 0, color: T.text1 }}>{j.title}</span>
            <span style={{
              flexShrink: 0, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
              color: j.source === 'local' ? T.success : '#7dd3fc',
              background: j.source === 'local' ? 'rgba(16,185,129,0.12)' : 'rgba(56,189,248,0.12)',
              border: `1px solid ${j.source === 'local' ? 'rgba(16,185,129,0.3)' : 'rgba(56,189,248,0.3)'}`,
            }}>
              {j.source === 'local' ? 'On-site' : 'Remote'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: T.text3, marginTop: 3 }}>
            {j.company}{j.location ? ` · ${j.location}` : ''}{j.jobType ? ` · ${j.jobType}` : ''}{j.salary ? ` · ${j.salary}` : ''}{j.postedTs ? ` · ${ago(j.postedTs)}` : ''}
          </div>
        </div>
      </div>
      {j.reason && <div style={{ fontSize: 12.5, color: T.text2, marginTop: 8, lineHeight: 1.5 }}>✓ {j.reason}</div>}
      {j.gaps && <div style={{ fontSize: 12, color: T.warning, marginTop: 4, lineHeight: 1.5 }}>Gap: {j.gaps}</div>}
      {j.tags?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
          {j.tags.slice(0, 5).map(t => <span key={t} style={S.chip}>{t}</span>)}
        </div>
      )}

      {showTracking && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SAVED_STATUSES.map(st => (
              <button key={st} type="button" onClick={() => onUpdateSaved?.(j, { status: st })}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', fontFamily: T.font,
                  border: `1px solid ${(j.status || 'interested') === st ? 'rgba(20,184,166,0.45)' : T.border}`,
                  background: (j.status || 'interested') === st ? 'rgba(20,184,166,0.16)' : 'transparent',
                  color: (j.status || 'interested') === st ? T.accentFrom : T.text3,
                }}>
                {STATUS_LABEL[st]}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={j.notes || ''}
            placeholder="Notes (local only)…"
            onChange={e => onUpdateSaved?.(j, { notes: e.target.value })}
            style={{ ...S.input, resize: 'vertical', marginBottom: 0, fontSize: 12 }}
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        {/^https?:\/\//.test(j.url || '')
          ? <a href={j.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: T.accentFrom, textDecoration: 'none' }}>Apply →</a>
          : <span style={{ fontSize: 12.5, color: T.text3 }}>No link</span>}
        {onOpenCareer && (
          <>
            <button type="button" onClick={() => onOpenCareer(j, 'ats')}
              style={{ fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: T.text2, cursor: 'pointer', padding: 0, fontFamily: T.font, textDecoration: 'underline' }}>
              Score in Resume Studio
            </button>
            <button type="button" onClick={() => onOpenCareer(j, 'tailor')}
              style={{ fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: T.text2, cursor: 'pointer', padding: 0, fontFamily: T.font, textDecoration: 'underline' }}>
              Tailor for this role
            </button>
          </>
        )}
        <button type="button" onClick={() => onToggleSave(j)} aria-pressed={saved} aria-label={saved ? 'Unsave job' : 'Save job'}
          style={{
            marginLeft: 'auto', fontSize: 12, fontWeight: 600, background: 'transparent', border: '1px solid',
            borderRadius: T.rCtrl, padding: '5px 12px', cursor: 'pointer', fontFamily: T.font,
            color: saved ? '#fbbf24' : T.text3, borderColor: saved ? 'rgba(251,191,36,0.4)' : T.border,
          }}>
          {saved ? '★ Saved' : '☆ Save'}
        </button>
      </div>
    </div>
  )
}

// Re-export for Career (and any other consumer).
export { NoKeysBanner }

export default function Jobs({ onHome, noProviders, onSettings, onOpenCareer, embedded }) {
  const [profile, setProfile] = useState(() => loadProfile())
  const inputsKey = `${profile.resume || ''}|${profile.targetRole || ''}|${profile.location || ''}|${profile.yearsExp || ''}`
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(() => (jobsCache && jobsCache.key === inputsKey) ? jobsCache.result : null)
  const [visible, setVisible] = useState(8)
  const [sort, setSort] = useState('fit')
  const [tab, setTab] = useState('matches')
  const [savedJobs, setSavedJobs] = useState(loadSavedJobs)
  const [savedSet, setSavedSet] = useState(savedKeySet)

  const hasResume = !!(profile.resume && profile.resume.trim())
  const canSearch = hasResume || !!(profile.targetRole && profile.targetRole.trim())
  const hasSalaryData = !!(result?.jobs?.some(j => (j.salaryNum || 0) > 0))

  const patch = p => { const next = { ...profile, ...p }; setProfile(next); saveProfile(next) }

  const toggleSave = useCallback(job => {
    const list = savedSet.has(savedKeyOf(job)) ? removeSavedJob(job) : saveJob(job)
    setSavedJobs(list)
    setSavedSet(new Set(list.map(savedKeyOf)))
  }, [savedSet])

  const patchSaved = useCallback((job, patchFields) => {
    const list = updateSavedJob(job, patchFields)
    setSavedJobs(list)
    setSavedSet(new Set(list.map(savedKeyOf)))
  }, [])

  const openCareer = useCallback((job, careerTab) => {
    if (!onOpenCareer) return
    const { jd, limited } = jobAnalysisJd(job)
    onOpenCareer({
      initialJd: jd,
      initialRole: job.title || profile.targetRole || '',
      initialCompany: job.company || '',
      initialTab: careerTab,
      limitedJd: limited,
    })
  }, [onOpenCareer, profile.targetRole])

  const find = useCallback(async () => {
    setError(''); setLoading(true)
    try {
      const res = await apiFetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume: profile.resume || '',
          targetRole: profile.targetRole || '',
          location: profile.location || '',
          yearsExp: profile.yearsExp || '',
        }),
      })
      const text = await res.text()
      let d = null; try { d = JSON.parse(text) } catch {}
      if (!res.ok || d?.error) setError(d?.error || `Could not load jobs (${res.status})`)
      else if (!d) setError('Got an unexpected response from the job service. Please try again.')
      else { setResult(d); setVisible(8); jobsCache = { key: inputsKey, result: d } }
    } catch (e) { setError(e.message || 'Could not reach the job service.') }
    finally { setLoading(false) }
  }, [inputsKey, profile.resume, profile.targetRole, profile.location, profile.yearsExp])

  useEffect(() => { if (hasResume && !result) find() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sort === 'salary' && result && !hasSalaryData) setSort('fit')
  }, [sort, result, hasSalaryData])

  return (
    <div style={{ padding: embedded ? 0 : '12px 14px 16px', fontFamily: T.font, color: T.text1 }}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button type="button" onClick={onHome} style={S.btnGhost}>← Back</button>
          <div style={{ fontWeight: 600, fontSize: 15, color: T.text1 }}>Job Matching</div>
        </div>
      )}

      <div role="tablist" aria-label="Job Matching sections" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[
          ['matches', 'Matches'],
          ['saved', `Saved${savedJobs.length ? ` (${savedJobs.length})` : ''}`],
        ].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={tabStyle(tab === k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'saved' ? (
        savedJobs.length === 0 ? (
          <div role="status" style={S.note}>
            No saved jobs yet. On Matches, tap <strong style={{ color: '#fbbf24' }}>Save</strong> to bookmark a role here.
          </div>
        ) : (
          <div>
            {savedJobs.length >= SAVED_MAX && (
              <div role="status" style={{ ...S.note, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)', color: '#fbbf24' }}>
                Saved list is full ({SAVED_MAX} max). Saving another drops the oldest.
              </div>
            )}
            <div style={{ fontSize: 12, color: T.text3, marginBottom: 10, lineHeight: 1.45 }}>
              Status and notes stay on this device. Open Resume Studio from a card to score or tailor against the listing.
            </div>
            {savedJobs.map(j => (
              <div key={savedKeyOf(j)}>
                <div style={{ fontSize: 11, color: T.text3, marginBottom: 4 }}>
                  Saved {ago(j.savedTs) || 'today'}
                  {j.status ? ` · ${STATUS_LABEL[j.status] || j.status}` : ''}
                </div>
                <JobCard j={j} saved showTracking onToggleSave={toggleSave} onUpdateSaved={patchSaved}
                  onOpenCareer={onOpenCareer ? openCareer : undefined} />
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <div style={S.panel}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text1, marginBottom: 4 }}>Your materials</div>
            <div style={{ fontSize: 12, color: T.text3, marginBottom: 12, lineHeight: 1.45 }}>
              Shared with Solo and Live. Paste or upload a PDF so matches reflect your background.
            </div>
            <ResumeMaterials resume={profile.resume} onPatch={patch} />
            {!hasResume && (
              <div role="status" style={{ ...S.note, borderColor: 'rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24', marginBottom: 0 }}>
                Add a resume for stronger matches — or enter a target role below to search anyway.
              </div>
            )}
          </div>

          <div style={S.panel}>
            <label style={S.lbl}>Target role</label>
            <input
              type="text" value={profile.targetRole || ''} placeholder="e.g. Senior Backend Engineer"
              onChange={e => patch({ targetRole: e.target.value })}
              style={S.input}
            />
            <label style={S.lbl}>Location</label>
            <input
              type="text" value={profile.location || ''} placeholder="e.g. Hyderabad, India"
              onChange={e => patch({ location: e.target.value })}
              style={S.input}
            />
            <label style={S.lbl}>Experience</label>
            <YearsChips value={profile.yearsExp || ''} onChange={v => patch({ yearsExp: v })} />
          </div>

          {noProviders && (
            <NoKeysBanner
              onSettings={onSettings}
              what="AI ranking (fit scores + reasons) needs an AI key."
              allowContinue
            />
          )}

          <button
            type="button"
            onClick={find}
            disabled={loading || !canSearch}
            style={{
              ...S.btnPrimary,
              opacity: loading || !canSearch ? 0.55 : 1,
              cursor: loading || !canSearch ? 'default' : 'pointer',
              marginBottom: 12,
            }}
          >
            {loading ? 'Finding roles…' : result ? 'Refresh matches' : 'Find matching jobs'}
          </button>
          {!canSearch && (
            <div role="status" style={{ fontSize: 12, color: T.text3, marginTop: -4, marginBottom: 12 }}>
              Add a resume or target role to search.
            </div>
          )}

          {error && (
            <div role="alert" style={{ ...S.note, borderColor: 'rgba(244,63,94,0.4)', background: 'rgba(244,63,94,0.08)', color: '#fca5a5' }}>
              {error}
            </div>
          )}

          {loading && !result && (
            <div role="status" style={S.note}>Searching roles…</div>
          )}

          {result && (
            <div>
              <div style={{ fontSize: 12, color: T.text3, marginBottom: 10, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>Searched: <strong style={{ color: T.text2 }}>{result.search}</strong></span>
                <span>{result.ranker === 'ai' ? 'AI-ranked' : 'Keyword-ranked'}</span>
              </div>

              {result.jobs.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, color: T.text3 }}>Sort:</span>
                  {SORTS.filter(([k]) => k !== 'salary' || hasSalaryData).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setSort(k)}
                      style={{
                        fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                        border: `1px solid ${sort === k ? 'rgba(20,184,166,0.45)' : T.border}`,
                        background: sort === k ? 'rgba(20,184,166,0.16)' : 'transparent',
                        color: sort === k ? T.accentFrom : T.text3, fontFamily: T.font,
                      }}>{label}</button>
                  ))}
                  {!hasSalaryData && (
                    <span title="No salary data in these results" style={{ fontSize: 11, color: T.text3 }}>
                      Salary sort unavailable
                    </span>
                  )}
                </div>
              )}

              {result.note && <div role="status" style={S.note}>{result.note}</div>}
              {result.localEnabled === false && (
                <div role="status" style={{ ...S.note, borderColor: 'rgba(20,184,166,0.3)', color: '#5eead4' }}>
                  Showing remote roles (Remotive). Add free <strong style={{ color: T.text1 }}>Adzuna</strong> keys in Settings for local on-site listings — without them we won’t invent local jobs.
                  {onSettings && (
                    <button type="button" onClick={onSettings}
                      style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', color: T.accentFrom, cursor: 'pointer', padding: 0, fontSize: 12.5, fontFamily: T.font, textDecoration: 'underline' }}>
                      Open Settings → Adzuna
                    </button>
                  )}
                </div>
              )}

              {sortJobs(result.jobs, sort).slice(0, visible).map(j => (
                <JobCard key={savedKeyOf(j) || j.id} j={j} saved={savedSet.has(savedKeyOf(j))} onToggleSave={toggleSave}
                  onOpenCareer={onOpenCareer ? openCareer : undefined} />
              ))}

              {visible < result.jobs.length && (
                <button type="button" onClick={() => setVisible(v => v + 8)} style={{ ...S.btnSecondary, width: '100%', marginTop: 4 }}>
                  Load more ({result.jobs.length - visible} more)
                </button>
              )}
              {result.jobs.length > 0 && visible >= result.jobs.length && result.jobs.length > 8 && (
                <div style={{ fontSize: 11.5, color: T.text3, textAlign: 'center', marginTop: 8 }}>That’s all {result.jobs.length} matches.</div>
              )}

              {result.jobs.length === 0 && !result.note && (
                <div role="status" style={S.note}>No strong matches found. Try a broader target role, or clear the location filter.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
