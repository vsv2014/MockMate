import React, { useState } from 'react'
import { T } from './auth/tokens'
import { scoreColor } from './lib/ui'
import { feedbackToText, transcriptToText } from './history'

// Phase-2b Solo feedback — design-system results screen. Renders only real fields from
// the evaluator (score, dimensions, strengths, improvements, delivery) + a conversation
// timeline built from the transcript. Per-question "ideal answers" would need a backend
// change to the evaluate endpoint, so they're intentionally not faked here.

function Ring({ value, size = 128 }) {
  const pct = Math.max(0, Math.min(100, value))
  const r = (size - 14) / 2, c = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(pct)} strokeWidth="8"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: size * 0.28, fontWeight: 600, color: T.text1, lineHeight: 1 }}>{(pct / 10).toFixed(1)}</div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>/ 10</div>
        </div>
      </div>
    </div>
  )
}

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false)
  if (!text) return null
  return (
    <button onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 13px', background: done ? 'rgba(34,197,94,0.16)' : T.surface2, color: done ? T.success : T.text2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: T.font }}>
      {done ? '✓ Copied' : `📋 ${label}`}
    </button>
  )
}

const panel = { background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '18px 20px' }
const h2 = { fontSize: 13, fontWeight: 600, color: T.text2, letterSpacing: '0.03em', marginBottom: 12 }

// Pair the transcript into Question → Answer items for the timeline.
function pairs(transcript) {
  const out = []
  for (let i = 0; i < transcript.length; i++) {
    if (transcript[i].role === 'interviewer') {
      const ans = transcript[i + 1] && transcript[i + 1].role !== 'interviewer' ? transcript[i + 1].text : null
      out.push({ q: transcript[i].text, a: ans })
    }
  }
  return out
}

export default function SoloFeedback({ report, onAgain, transcript = [], onAgainLabel = 'Practice again' }) {
  const [openQ, setOpenQ] = useState(null)

  if (!report || report.error) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', fontFamily: T.font, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: T.text1 }}>No feedback yet</div>
        <div style={{ ...panel, borderColor: 'rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.08)', color: '#fca5a5', fontSize: 13 }}>
          {report?.error || 'The session ended without enough answers to score.'}
        </div>
        <button onClick={onAgain} style={{ alignSelf: 'flex-start', height: 44, padding: '0 22px', background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>← {onAgainLabel}</button>
      </div>
    )
  }

  const pct = report.overallScore == null ? null : Math.max(0, Math.min(100, report.overallScore))
  const d = report._delivery
  const qa = pairs(transcript)
  const recs = report.improvements || []
  const strengths = report.strengths || []

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', fontFamily: T.font, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 600, color: T.text1 }}>Your feedback</div>
        <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>Honest, specific notes to help you improve — not a verdict on you.</div>
      </div>

      {/* Overall + summary */}
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        {pct != null && <Ring value={pct} />}
        <div style={{ flex: 1, minWidth: 240 }}>
          {report.verdict && <div style={{ fontSize: 16, fontWeight: 600, color: T.text1, marginBottom: 6 }}>{report.verdict}</div>}
          {report.summary && <div style={{ fontSize: 13.5, color: T.text2, lineHeight: 1.6 }}>{report.summary}</div>}
        </div>
      </div>

      {/* Score breakdown */}
      {report.dimensions?.length > 0 && (
        <div style={panel}>
          <div style={h2}>SCORE BREAKDOWN</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {report.dimensions.map((dim, i) => {
              const s = Math.max(0, Math.min(5, Number(dim.score) || 0))
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                    <span style={{ color: T.text1, fontWeight: 500 }}>{dim.name}</span>
                    <span style={{ color: scoreColor((s / 5) * 100), fontWeight: 600 }}>{s}/5</span>
                  </div>
                  <div style={{ height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(s / 5) * 100}%`, background: scoreColor((s / 5) * 100), borderRadius: 3 }} />
                  </div>
                  {dim.comment && <div style={{ fontSize: 11.5, color: T.text3, marginTop: 5, lineHeight: 1.45 }}>{dim.comment}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Strengths + recommendations */}
      {(strengths.length || recs.length) ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {strengths.length > 0 && (
            <div style={panel}>
              <div style={{ ...h2, color: T.success }}>STRENGTHS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {strengths.map((s, i) => <Bullet key={i} color={T.success} mark="✓">{s}</Bullet>)}
              </div>
            </div>
          )}
          {recs.length > 0 && (
            <div style={panel}>
              <div style={{ ...h2, color: T.accentFrom }}>TOP RECOMMENDATIONS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {recs.slice(0, 5).map((s, i) => <Bullet key={i} color={T.accentFrom} mark={`${i + 1}`}>{s}</Bullet>)}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Delivery (measured locally) */}
      {d && (
        <div style={panel}>
          <div style={h2}>DELIVERY</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Stat>{d.words} words</Stat>
            {d.wpm != null && <Stat>{d.wpm} wpm</Stat>}
            <Stat>{d.fillers.count} fillers</Stat>
            {d.jargon?.count > 0 && <Stat>{d.jargon.count} buzzwords</Stat>}
            {d.hedges?.count > 0 && <Stat>{d.hedges.count} hedges</Stat>}
          </div>
          {report.delivery?.tip && <div style={{ fontSize: 12.5, color: '#fbbf24', marginTop: 12, lineHeight: 1.5 }}>🎯 Next time: {report.delivery.tip}</div>}
        </div>
      )}

      {/* Question timeline */}
      {qa.length > 0 && (
        <div style={panel}>
          <div style={h2}>QUESTION TIMELINE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {qa.map((item, i) => {
              const open = openQ === i
              return (
                <div key={i} style={{ border: `1px solid ${T.border}`, borderRadius: T.rCtrl, overflow: 'hidden' }}>
                  <button onClick={() => setOpenQ(open ? null : i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', background: open ? T.surface2 : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: T.font }}>
                    <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 6, background: 'rgba(20,184,166,0.16)', color: T.accentFrom, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>Q{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: T.text1, whiteSpace: open ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.q}</span>
                    <span style={{ color: T.text3, fontSize: 12 }}>{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div style={{ padding: '2px 14px 14px 46px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: T.text3, letterSpacing: '0.04em' }}>YOUR ANSWER</div>
                      <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.6 }}>{item.a || <span style={{ color: T.text3, fontStyle: 'italic' }}>No answer recorded.</span>}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={onAgain} style={{ height: 44, padding: '0 22px', background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>{onAgainLabel}</button>
        <CopyBtn text={feedbackToText(report)} label="Copy feedback" />
        {transcript.length > 0 && <CopyBtn text={transcriptToText(transcript)} label="Copy transcript" />}
      </div>
    </div>
  )
}

function Bullet({ children, color, mark }) {
  return (
    <div style={{ display: 'flex', gap: 9, fontSize: 13, color: T.text2, lineHeight: 1.5 }}>
      <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 5, background: `${color}22`, color, display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700, marginTop: 1 }}>{mark}</span>
      <span>{children}</span>
    </div>
  )
}
function Stat({ children }) {
  return <span style={{ fontSize: 11.5, color: T.text2, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 999, padding: '4px 11px' }}>{children}</span>
}
