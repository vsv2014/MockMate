import React, { useState } from 'react'
import { feedbackToText, transcriptToText } from './history'
import { scoreColor } from './lib/ui'

// Small inline copy button — copies `text`, shows a ✓ for a moment.
function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false)
  if (!text) return null
  return (
    <button className="chip" style={{ cursor: 'pointer', border: 'none', background: done ? 'rgba(34,197,94,0.18)' : undefined, color: done ? 'var(--good)' : undefined }}
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? '✓ Copied' : `📋 ${label}`}
    </button>
  )
}

export default function Report({ report, onAgain, solo = false, transcript = [], onAgainLabel }) {
  const [showConvo, setShowConvo] = useState(false)
  if (!report || report.error) {
    return (
      <div className="wrap">
        <h1>No report</h1>
        <div className="banner warn"><span>⚠</span><span>{report?.error || 'The session ended without enough transcript to score.'}</span></div>
        <button className="btn" onClick={onAgain}>← {onAgainLabel || 'New session'}</button>
      </div>
    )
  }
  const pct = report.overallScore == null ? null : Math.max(0, Math.min(100, report.overallScore))
  const d = report._delivery
  const hasConvo = Array.isArray(transcript) && transcript.length > 0

  return (
    <div className="wrap">
      <h1>{solo ? 'Your feedback' : 'Shared feedback'}</h1>
      <p className="subtitle">{solo
        ? 'Honest, specific feedback on your interview — meant to help, not a verdict on you as a person.'
        : 'Both partners see this. Honest, specific, and meant to help — not a verdict on you as a person.'}</p>

      {/* Copy actions — feedback and/or the full conversation */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <CopyBtn text={feedbackToText(report)} label="Copy feedback" />
        {hasConvo && <CopyBtn text={transcriptToText(transcript)} label="Copy transcript" />}
        {hasConvo && (
          <button className="chip" style={{ cursor: 'pointer', border: 'none' }} onClick={() => setShowConvo(s => !s)}>
            {showConvo ? '▾ Hide conversation' : '▸ Full conversation'}
          </button>
        )}
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        {pct != null && (
          <div>
            <div className="score-num" style={{ color: scoreColor(pct) }}>{pct}</div>
            <div className="meta">/ 100</div>
          </div>
        )}
        <div>
          {report.verdict && <div style={{ fontWeight: 700, marginBottom: 4 }}>{report.verdict}</div>}
          <p style={{ color: 'var(--text-dim)' }}>{report.summary}</p>
        </div>
      </div>

      {report.dimensions?.length > 0 && (
        <div className="card">
          <h2>Scorecard</h2>
          {report.dimensions.map((dim, i) => (
            <div className="dim" key={i}>
              <div className="dim-head"><span style={{ fontWeight: 600 }}>{dim.name}</span><span className="meta">{dim.score} / 5</span></div>
              <div className="dim-bar"><i style={{ width: `${(dim.score / 5) * 100}%`, background: scoreColor((dim.score / 5) * 100) }} /></div>
              <div className="meta">{dim.comment}</div>
            </div>
          ))}
        </div>
      )}

      {d && (
        <div className="card">
          <h2>Delivery (measured locally)</h2>
          <div>
            <span className="chip">🗣 {d.words} words</span>
            {d.wpm != null && <span className="chip">{d.wpm} wpm</span>}
            <span className="chip">{d.fillers.count} fillers</span>
            {d.jargon.count > 0 && <span className="chip">{d.jargon.count} buzzwords</span>}
            {d.hedges.count > 0 && <span className="chip">{d.hedges.count} hedges</span>}
          </div>
        </div>
      )}

      {(report.strengths?.length || report.improvements?.length) ? (
        <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div><h2>Strengths</h2><ul className="bullets">{(report.strengths || []).map((s, i) => <li key={i}>{s}</li>)}</ul></div>
          <div><h2>Work on next</h2><ul className="bullets">{(report.improvements || []).map((s, i) => <li key={i}>{s}</li>)}</ul></div>
        </div>
      ) : null}

      {report.delivery?.tip && (
        <div className="banner"><span>🎯</span><span><strong>Next time:</strong> {report.delivery.tip}</span></div>
      )}

      {hasConvo && showConvo && (
        <div className="card">
          <h2>Full conversation</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '46vh', overflowY: 'auto' }}>
            {transcript.map((t, i) => {
              const me = t.role !== 'interviewer'
              return (
                <div key={i} style={{ alignSelf: me ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: me ? 'var(--accent, #2dd4bf)' : 'var(--text-dim, #94a3b8)', marginBottom: 2 }}>{me ? 'YOU' : 'INTERVIEWER'}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, padding: '8px 11px', borderRadius: 9, background: me ? 'rgba(13,148,136,0.14)' : 'rgba(255,255,255,0.05)', color: 'var(--text, #e2e8f0)' }}>{t.text}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <button className="btn" onClick={onAgain}>← {onAgainLabel || 'New session'}</button>
    </div>
  )
}
