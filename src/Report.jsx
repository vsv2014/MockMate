import React from 'react'

function scoreColor(p) { return p >= 75 ? 'var(--good)' : p >= 50 ? 'var(--warn)' : 'var(--bad)' }

export default function Report({ report, onAgain, solo = false }) {
  if (!report || report.error) {
    return (
      <div className="wrap">
        <h1>No report</h1>
        <div className="banner warn"><span>⚠</span><span>{report?.error || 'The session ended without enough transcript to score.'}</span></div>
        <button className="btn" onClick={onAgain}>← New session</button>
      </div>
    )
  }
  const pct = Math.max(0, Math.min(100, report.overallScore ?? 0))
  const d = report._delivery

  return (
    <div className="wrap">
      <h1>{solo ? 'Your feedback' : 'Shared feedback'}</h1>
      <p className="subtitle">{solo
        ? 'Honest, specific feedback on your interview — meant to help, not a verdict on you as a person.'
        : 'Both partners see this. Honest, specific, and meant to help — not a verdict on you as a person.'}</p>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div>
          <div className="score-num" style={{ color: scoreColor(pct) }}>{pct}</div>
          <div className="meta">/ 100</div>
        </div>
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

      <button className="btn" onClick={onAgain}>← New session</button>
    </div>
  )
}
