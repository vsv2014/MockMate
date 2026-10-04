import { useState, useEffect, useRef, useMemo } from 'react'
import { apiFetch } from './lib/apiClient'
import { loadProfile, saveProfile, applyTailorToResume, applyTailorWithBackup, restoreResumeBackup } from './lib/profile'
import { loadCareerDraft, saveCareerDraft } from './lib/careerDraft'
import { copyText, downloadTextFile } from './lib/clipboard'
import { downloadTailoredResumePdf } from './lib/resumePdf'
import { scoreColor } from './lib/ui'
import { analyzeSkillsGap } from '../shared/skillsMatrix.js'
import { T } from './auth/tokens'
import { S, tabStyle, NoKeysBanner, ResumeMaterials, CopyBtn } from './lib/secondaryUi'

// Resume Studio — Skills Matrix, ATS score, tailor, referral DM.

const TABS = [
  ['skills', 'Skills Matrix'],
  ['ats', 'AI Match Estimate'],
  ['tailor', 'Tailor Resume'],
  ['referral', 'Referral DM'],
]

export default function Career({
  onHome, noProviders, onSettings, embedded,
  initialJd, initialRole, initialCompany, initialTab, limitedJd, onSeedConsumed,
  onUseForInterview,
}) {
  const draft0 = loadCareerDraft()
  const [profile, setProfile] = useState(() => loadProfile())
  const [tab, setTab] = useState(() => (
    ['skills', 'ats', 'tailor', 'referral'].includes(initialTab) ? initialTab
      : (draft0.tab || 'ats')
  ))
  const [loading, setLoading] = useState(false)
  const [latexBusy, setLatexBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(() => (
    draft0.resultTab === (initialTab || draft0.tab || 'ats') ? draft0.result : null
  ))
  // Analysis JD is persisted in mm-career-draft — must not clobber profile.jobDescription (Live/Solo).
  const [jd, setJd] = useState(() => initialJd ?? draft0.jd ?? '')
  const [company, setCompany] = useState(() => initialCompany || draft0.company || profile.targetCompany || '')
  const [person, setPerson] = useState(() => draft0.person || '')
  const [seedNote, setSeedNote] = useState(() => !!(limitedJd || draft0.limitedJd))
  const [applyMsg, setApplyMsg] = useState('')
  const seedDone = useRef(false)

  // Persist analysis draft whenever JD / person / tab / result change (survives minimize).
  useEffect(() => {
    saveCareerDraft({
      jd,
      person,
      company,
      tab,
      limitedJd: seedNote,
      result,
      resultTab: result ? tab : null,
    })
  }, [jd, person, company, tab, result, seedNote])

  // One-shot seed from Jobs handoff
  useEffect(() => {
    if (seedDone.current) return
    if (initialJd == null && !initialRole && !initialCompany && !initialTab) return
    seedDone.current = true
    if (initialJd != null) {
      setJd(initialJd)
      saveCareerDraft({ jd: initialJd, limitedJd: !!limitedJd, tab: initialTab || 'ats' })
    }
    if (limitedJd) setSeedNote(true)
    if (['skills', 'ats', 'tailor', 'referral'].includes(initialTab)) {
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
    if (!window.confirm('Updates the resume shared with Solo, Live, and Jobs. MockMate will keep one undo copy. Continue?')) return
    const next = applyTailorWithBackup(profile, r)
    if (!saveProfile(next)) {
      setError('Could not save the tailored resume. Local storage may be full; your current resume was not replaced.')
      return
    }
    setProfile(next)
    setApplyMsg('Resume updated — shared with Solo, Live, and Job Matching. You can undo this change below.')
  }

  function undoTailor() {
    const next = restoreResumeBackup(profile)
    if (next === profile) return
    if (!saveProfile(next)) {
      setError('Could not restore the resume backup. Local storage may be full.')
      return
    }
    setProfile(next)
    setApplyMsg('Restored the resume used before the last tailoring update.')
  }

  function downloadPlainTailored(r) {
    const text = applyTailorToResume(profile.resume || '', r || {})
    const role = (profile.targetRole || 'resume').replace(/[^\w\-]+/g, '-').toLowerCase()
    downloadTextFile(`mockmate-${role}.txt`, text, 'text/plain;charset=utf-8')
  }

  function downloadPdf(r) {
    setError(''); setPdfBusy(true); setApplyMsg('')
    try {
      const { filename, pages } = downloadTailoredResumePdf({
        resume: profile.resume || '',
        tailor: r || null,
        targetRole: profile.targetRole || '',
      })
      setApplyMsg(`Downloaded ${filename} (${pages} page${pages === 1 ? '' : 's'}) — tailored text applied to your resume.`)
    } catch (e) {
      setError(e.message || 'Could not build PDF.')
    } finally {
      setPdfBusy(false)
    }
  }

  async function downloadLatex(r) {
    setError(''); setLatexBusy(true); setApplyMsg('')
    try {
      const res = await apiFetch('/api/resume-latex', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume: profile.resume || '',
          targetRole: profile.targetRole || '',
          jobDescription: jd,
          tailor: r || null,
        }),
      })
      const text = await res.text()
      let d = null; try { d = JSON.parse(text) } catch {}
      if (!res.ok || d?.error) throw new Error(d?.error || `LaTeX failed (${res.status})`)
      if (!d?.latex) throw new Error('No LaTeX returned')
      downloadTextFile(`${d.filenameHint || 'resume'}.tex`, d.latex, 'application/x-tex;charset=utf-8')
      setApplyMsg('Downloaded .tex — open in Overleaf / pdflatex for a FAANG-style one-pager PDF.')
    } catch (e) {
      setError(e.message || 'Could not generate LaTeX resume.')
    } finally {
      setLatexBusy(false)
    }
  }

  const base = { resume: profile.resume || '', targetRole: profile.targetRole || '', jobDescription: jd }
  const canRun = hasResume && !noProviders && !loading
  const skillsReport = useMemo(
    () => analyzeSkillsGap(profile.resume || '', jd, profile.targetRole || ''),
    [profile.resume, jd, profile.targetRole],
  )

  function injectSkillsIntoPlaybook() {
    if (!skillsReport.playbookPatch) return
    const currentPrompt = String(profile.customInstructions || '').trim()
    const cleaned = currentPrompt.replace(/\[Skills Focus & Gap Strategy\][\s\S]*?(?=\n\[|$)/g, '').trim()
    const nextInstructions = [cleaned, skillsReport.playbookPatch].filter(Boolean).join('\n\n')
    patch({ customInstructions: nextInstructions })
    setApplyMsg('Injected Skills Focus & Gap Strategy into your Interview Playbook (used in Solo, Live & Duo).')
  }

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
          The analysis JD below is saved on this device for Resume Studio only — it does not change your Live/Solo JD until you click “Use for Solo/Live”.
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
            <label style={S.lbl}>Job description for this analysis (saved in Resume Studio — not Live/Solo)</label>
            <textarea rows={3} style={{ ...S.input, resize: 'vertical' }} value={jd} placeholder="Paste a JD to score or tailor against…"
              onChange={e => { setJd(e.target.value); setSeedNote(false) }} />
          </>
        )}

        {tab === 'referral' && (
          <>
            <div style={{ ...S.note, marginBottom: 12 }}>
              This drafts a LinkedIn / email message for <strong style={{ color: T.text1 }}>you to send</strong>.
              MockMate does not email anyone or connect to LinkedIn — tap Copy, then paste where you message the person.
            </div>
            <label style={S.lbl}>Company</label>
            <input style={S.input} value={company} placeholder="e.g. Stripe"
              onChange={e => { setCompany(e.target.value); patch({ targetCompany: e.target.value }) }} />
            <label style={S.lbl}>Person you’re asking (optional)</label>
            <input style={{ ...S.input, marginBottom: 0 }} value={person} placeholder="e.g. Priya, EM on the Payments team"
              onChange={e => setPerson(e.target.value)} />
          </>
        )}
      </div>

      {tab !== 'skills' && (
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
      )}
      {onUseForInterview && tab !== 'referral' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            type="button"
            disabled={!String(jd || '').trim()}
            style={{
              ...S.btnSecondary,
              opacity: String(jd || '').trim() ? 1 : 0.55,
              cursor: String(jd || '').trim() ? 'pointer' : 'default',
            }}
            onClick={() => onUseForInterview({
              jd,
              role: profile.targetRole || '',
              company: company || profile.targetCompany || '',
              source: 'career',
            }, 'solo')}
          >
            Use JD for Solo
          </button>
          <button
            type="button"
            disabled={!String(jd || '').trim()}
            style={{
              ...S.btnSecondary,
              opacity: String(jd || '').trim() ? 1 : 0.55,
              cursor: String(jd || '').trim() ? 'pointer' : 'default',
            }}
            onClick={() => onUseForInterview({
              jd,
              role: profile.targetRole || '',
              company: company || profile.targetCompany || '',
              source: 'career',
            }, 'live')}
          >
            Use JD for Live
          </button>
        </div>
      )}
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
          {profile.resumeBackup?.text != null && (
            <button type="button" onClick={undoTailor}
              style={{ display: 'block', marginTop: 8, padding: 0, background: 'none', border: 'none', color: T.accentFrom, cursor: 'pointer', fontFamily: T.font, fontSize: 12.5, textDecoration: 'underline' }}>
              Undo last resume update
            </button>
          )}
        </div>
      )}

      {tab === 'skills' && hasResume && (
        <SkillsMatrixResult
          report={skillsReport}
          hasJd={Boolean(String(jd || '').trim())}
          targetRole={profile.targetRole || ''}
          onInjectPlaybook={injectSkillsIntoPlaybook}
          onSwitchTab={setTabReset}
          onDrillSkill={skill => onUseForInterview?.({
            jd: `${jd ? jd + '\n\n' : ''}Focus Interview Area: ${skill.skill} (${skill.category}). Sample question: ${skill.practiceQuestion}`,
            role: profile.targetRole || 'Software Engineer',
            company: company || profile.targetCompany || '',
            source: 'career',
          }, 'solo')}
        />
      )}

      {result && tab === 'ats' && <AtsResult r={result} onSwitchTab={setTabReset} />}
      {result && tab === 'tailor' && (
        <TailorResult
          r={result}
          onApply={() => applyTailor(result)}
          onDownloadPdf={() => downloadPdf(result)}
          onDownloadTxt={() => downloadPlainTailored(result)}
          onDownloadLatex={() => downloadLatex(result)}
          latexBusy={latexBusy || loading}
          pdfBusy={pdfBusy}
          canLatex={hasResume && !noProviders}
        />
      )}
      {result && tab === 'referral' && <ReferralResult r={result} company={company} role={profile.targetRole} />}
    </div>
  )
}

function SkillsMatrixResult({ report, hasJd, targetRole, onInjectPlaybook, onSwitchTab, onDrillSkill }) {
  const pct = report.readinessScore || 0
  return (
    <div style={{ marginTop: 4 }} aria-live="polite">
      <div style={{ ...S.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: scoreColor(pct), lineHeight: 1 }}>{pct}</div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>Skill readiness /100</div>
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text1 }}>
              {report.matched.length} matched · {report.missing.length} gap{report.missing.length === 1 ? '' : 's'} · {report.bonus.length} differentiator{report.bonus.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: 12, color: T.text3, marginTop: 3, lineHeight: 1.45 }}>
              {hasJd
                ? 'Compared your resume directly against the pasted Job Description across 5 technical & leadership dimensions.'
                : `Compared your resume against baseline expectations for ${targetRole || 'your target role'}. Paste a specific JD above for exact role matching.`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {report.playbookPatch && (
            <button
              type="button"
              onClick={onInjectPlaybook}
              style={{
                fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font,
                background: 'rgba(20,184,166,0.15)', border: '1px solid rgba(20,184,166,0.4)', color: T.accentFrom,
              }}>
              ⚡ Inject Gap Strategy into Playbook
            </button>
          )}
          <button
            type="button"
            onClick={() => onSwitchTab('tailor')}
            style={{
              fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font,
              background: T.surface2, border: `1px solid ${T.border}`, color: T.text1,
            }}>
            ✎ Tailor Missing Skills
          </button>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.sectionLbl}>5-Dimension Skill Breakdown</div>
        {report.categories.map(cat => {
          const activeSkills = cat.matched.length + cat.missing.length + cat.bonus.length
          if (activeSkills === 0) return null
          return (
            <div key={cat.id} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, marginBottom: 5 }}>
                <span style={{ fontWeight: 600, color: T.text1 }}>{cat.label}</span>
                <span style={{ fontSize: 11.5, color: cat.totalTarget > 0 ? scoreColor(cat.coveragePct) : T.text3 }}>
                  {cat.totalTarget > 0 ? `${cat.matched.length}/${cat.totalTarget} target skills (${cat.coveragePct}%)` : `${cat.bonus.length} resume strength${cat.bonus.length === 1 ? '' : 's'}`}
                </span>
              </div>
              {cat.totalTarget > 0 && (
                <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${cat.coveragePct}%`, background: scoreColor(cat.coveragePct), borderRadius: 2 }} />
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cat.matched.map(s => (
                  <span key={s} style={{ ...S.chip, background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)', color: '#6ee7b7' }}>
                    ✓ {s}
                  </span>
                ))}
                {cat.missing.map(s => (
                  <span key={s} style={{ ...S.chip, background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.35)', color: '#fcd34d' }}>
                    ⚠ {s} (gap)
                  </span>
                ))}
                {cat.bonus.map(s => (
                  <span key={s} style={{ ...S.chip, background: 'rgba(56,189,248,0.10)', borderColor: 'rgba(56,189,248,0.28)', color: '#7dd3fc' }}>
                    ★ {s}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {report.gapBridges.length > 0 && (
        <div style={S.card}>
          <div style={S.sectionLbl}>How to Bridge Missing Skills in Interviews ({report.gapBridges.length})</div>
          <div style={{ fontSize: 12, color: T.text3, marginBottom: 10, lineHeight: 1.45 }}>
            Never fabricate direct ownership of a missing tool. Use these honest pivot strategies or drill them in Solo Practice:
          </div>
          {report.gapBridges.map((g, i) => (
            <div key={i} style={{ padding: '10px 12px', borderRadius: T.rCtrl, background: 'rgba(255,255,255,0.02)', border: `1px solid ${T.border}`, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#fcd34d' }}>⚠ {g.skill} <span style={{ fontSize: 11, fontWeight: 400, color: T.text3 }}>· {g.category}</span></span>
                {onDrillSkill && (
                  <button
                    type="button"
                    onClick={() => onDrillSkill(g)}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: T.font,
                      background: 'rgba(20,184,166,0.14)', border: '1px solid rgba(20,184,166,0.35)', color: T.accentFrom,
                    }}>
                    Drill in Solo →
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: T.text2, lineHeight: 1.5 }}>{g.bridgeTip}</div>
              <div style={{ fontSize: 11.5, color: T.text3, marginTop: 4, fontStyle: 'italic' }}> Likely question: “{g.practiceQuestion}”</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AtsResult({ r, onSwitchTab }) {
  const pct = Math.max(0, Math.min(100, r.overallScore ?? 0))
  return (
    <div style={{ marginTop: 4 }} aria-live="polite">
      <div style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: scoreColor(pct), lineHeight: 1 }}>{pct}</div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>AI match estimate /100</div>
        </div>
        <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.55 }}>{r.verdict}</div>
      </div>
      <div role="note" style={{ ...S.note, marginTop: 8 }}>
        Advisory estimate from the resume and pasted job description—not a score from an employer's ATS.
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

function TailorResult({ r, onApply, onDownloadPdf, onDownloadTxt, onDownloadLatex, latexBusy, pdfBusy, canLatex }) {
  const full = [r.summary && `SUMMARY:\n${r.summary}`, r.rewrittenBullets?.length && 'REWRITTEN BULLETS:\n' + r.rewrittenBullets.map(b => `• ${b.after}`).join('\n'), r.keywordsToAdd?.length && `KEYWORDS TO ADD: ${r.keywordsToAdd.join(', ')}`].filter(Boolean).join('\n\n')
  const dlBtn = {
    fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font,
    background: T.surface2, border: `1px solid ${T.border}`, color: T.text1,
  }
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
        <button type="button" onClick={onDownloadPdf} disabled={pdfBusy}
          style={{
            ...dlBtn,
            background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.35)', color: T.accentFrom,
            opacity: pdfBusy ? 0.55 : 1, cursor: pdfBusy ? 'default' : 'pointer',
          }}
          title="Download 1–2 page PDF with tailor edits applied">
          {pdfBusy ? 'Building PDF…' : 'Download PDF'}
        </button>
        <button type="button" onClick={onDownloadTxt} style={dlBtn} title="Plain text fallback">
          Download .txt
        </button>
        <button type="button" onClick={onDownloadLatex} disabled={!canLatex || latexBusy}
          style={{ ...dlBtn, opacity: (!canLatex || latexBusy) ? 0.55 : 1, cursor: (!canLatex || latexBusy) ? 'default' : 'pointer' }}
          title="Optional: FAANG-style LaTeX for Overleaf">
          {latexBusy ? 'Building LaTeX…' : 'Download .tex'}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: T.text3, marginBottom: 10, lineHeight: 1.45 }}>
        <strong style={{ color: T.text2 }}>Download PDF</strong> is the normal path — your resume text with tailor edits, single-column, usually 1–2 pages.
        .tex is optional (Overleaf). No invented experience.
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

function ReferralResult({ r, company, role }) {
  const followUpText = r.followUp || `Hi again — just floating this to the top of your inbox in case you had 2 minutes to glance at my note about the ${role || 'engineering'} role${company ? ` at ${company}` : ''}. Totally understand if your week is packed, and appreciate your time either way!`
  return (
    <div style={{ marginTop: 4 }} aria-live="polite">
      {r.short && <Block title="Connection note (≤300 chars)"><div style={para}>{r.short}</div><div style={{ marginTop: 8 }}><CopyBtn text={r.short} label="Copy note" /></div></Block>}
      {r.message && <Block title="Full referral message"><div style={{ ...para, whiteSpace: 'pre-wrap' }}>{r.message}</div><div style={{ marginTop: 8 }}><CopyBtn text={r.message} label="Copy to paste" /></div></Block>}
      <Block title="Day-4 gentle follow-up nudge">
        <div style={{ ...para, whiteSpace: 'pre-wrap' }}>{followUpText}</div>
        <div style={{ marginTop: 8 }}><CopyBtn text={followUpText} label="Copy follow-up" /></div>
      </Block>
      <div style={S.card}>
        <div style={S.sectionLbl}>Outreach & Referral Checklist</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li style={li}>Include the exact job requisition ID or link so your contact doesn't have to search for it.</li>
          <li style={li}>Attach your tailored 1–2 page PDF resume from the <strong>Tailor Resume</strong> tab.</li>
          <li style={li}>Save the role in <strong>Job Matching → Saved</strong> and set status to <em>Applied / Outreach</em>.</li>
          <li style={li}>Wait 4 business days before sending the single follow-up nudge above.</li>
        </ul>
      </div>
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
