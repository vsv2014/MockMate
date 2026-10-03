import React, { useState, useEffect } from 'react'
import { T } from '../auth/tokens'
import {
  getProductIntelligenceReport,
  subscribeProductIntelligence,
  clearProductIntelligenceEvents,
  getReplayOptIn,
  setReplayOptIn,
} from '../lib/productIntelligence'

export default function ProductIntelligencePanel() {
  const [report, setReport] = useState(() => getProductIntelligenceReport())
  const [optInReplay, setOptInReplayState] = useState(() => getReplayOptIn())
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const refresh = () => {
      setReport(getProductIntelligenceReport())
      setOptInReplayState(getReplayOptIn())
    }
    return subscribeProductIntelligence(refresh)
  }, [])

  const toggleReplayOptIn = () => {
    const next = setReplayOptIn(!optInReplay)
    setOptInReplayState(next)
    setReport(getProductIntelligenceReport())
  }

  const handleClear = () => {
    clearProductIntelligenceEvents()
    setReport(getProductIntelligenceReport())
  }

  const liveFunnel = report?.funnels?.live_interview
  const soloFunnel = report?.funnels?.solo_practice
  const adoption = report?.featureAdoption || {}

  return (
    <div style={{
      marginTop: 12,
      padding: '14px 16px',
      background: T.surface1,
      border: `1px solid ${T.border}`,
      borderRadius: T.rCard,
      fontFamily: T.font,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>
              ARCH · Product Intelligence
            </span>
            <span style={{
              fontSize: 9.5,
              fontWeight: 700,
              fontFamily: T.fontMono,
              padding: '2px 7px',
              borderRadius: 999,
              background: 'rgba(20,184,166,0.14)',
              border: '1px solid rgba(45,212,191,0.32)',
              color: '#5eead4',
              letterSpacing: '0.04em',
            }}>
              ZERO-PII · LOCAL
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: T.text2, marginTop: 2, lineHeight: 1.45 }}>
            Answers where flows stall, which features get used, and where repeated clicks/retries occur — <strong>never</strong> capturing resumes, interview transcripts, prompts, API keys, screenshots, or audio.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          style={{
            height: 32,
            padding: '0 12px',
            background: expanded ? 'rgba(20,184,166,0.16)' : T.surface2,
            color: expanded ? '#5eead4' : T.text1,
            border: `1px solid ${expanded ? 'rgba(45,212,191,0.4)' : T.borderStrong}`,
            borderRadius: T.rCtrl,
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: T.font,
          }}
        >
          {expanded ? '▾ Hide Insights' : `▸ View Insights (${report.totalSessions} session${report.totalSessions === 1 ? '' : 's'})`}
        </button>
        {report.totalEvents > 0 && (
          <button
            type="button"
            onClick={handleClear}
            style={{
              height: 32,
              padding: '0 11px',
              background: 'transparent',
              color: T.text3,
              border: `1px solid ${T.border}`,
              borderRadius: T.rCtrl,
              fontSize: 11.5,
              cursor: 'pointer',
              fontFamily: T.font,
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Headline Insights (always visible when present) */}
      {report.headlineInsights?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {report.headlineInsights.slice(0, expanded ? 6 : 2).map(item => {
            const isWarn = item.severity === 'warn'
            const isOk = item.severity === 'ok'
            const accent = isWarn ? '#fbbf24' : isOk ? '#34d399' : '#5eead4'
            const bg = isWarn
              ? 'rgba(245,158,11,0.08)'
              : isOk
                ? 'rgba(16,185,129,0.08)'
                : 'rgba(20,184,166,0.07)'
            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '7px 10px',
                  borderRadius: 8,
                  background: bg,
                  border: `1px solid ${accent}33`,
                  fontSize: 11.5,
                  color: T.text1,
                }}
              >
                <span style={{
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  fontWeight: 700,
                  color: accent,
                  minWidth: 38,
                }}>
                  {item.metric}
                </span>
                <span style={{ color: T.text2, lineHeight: 1.4 }}>{item.text}</span>
              </div>
            )
          })}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Feature Adoption Strip */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
              Feature Usage & Workflow Signals
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }}>
              {[
                { label: 'Live Sessions', val: adoption.liveSessions || 0 },
                { label: 'Solo Sessions', val: adoption.soloSessions || 0 },
                { label: 'Alt+T Teleprompter', val: adoption.teleprompterUses || 0 },
                { label: 'F7 Screen Captures', val: adoption.f7Captures || 0 },
                { label: 'Playbooks Applied', val: adoption.playbookTemplatesApplied || 0 },
                { label: 'Alt+R Answer Now', val: adoption.answerNowTriggers || 0 },
              ].map(m => (
                <div key={m.label} style={{
                  padding: '7px 9px',
                  background: T.surface2,
                  border: `1px solid ${T.border}`,
                  borderRadius: 7,
                }}>
                  <div style={{ fontFamily: T.fontMono, fontSize: 14, fontWeight: 700, color: T.text1 }}>{m.val}</div>
                  <div style={{ fontSize: 10.5, color: T.text3, marginTop: 1 }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Funnel Step Conversion */}
          {[liveFunnel, soloFunnel].filter(Boolean).map(funnel => (
            <div key={funnel.id}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
                {funnel.label} ({funnel.entryCount} session{funnel.entryCount === 1 ? '' : 's'})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {funnel.steps.map(step => (
                  <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                    <span style={{ width: 140, color: T.text2, flexShrink: 0 }}>{step.label}</span>
                    <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.max(step.count > 0 ? 6 : 0, Math.min(100, step.conversionPct))}%`,
                        height: '100%',
                        background: step.dropOffPct >= 35 ? '#fbbf24' : '#2dd4bf',
                        borderRadius: 999,
                      }} />
                    </div>
                    <span style={{ fontFamily: T.fontMono, fontSize: 10.5, color: T.text1, minWidth: 32, textAlign: 'right' }}>
                      {step.count}
                    </span>
                    <span style={{ fontFamily: T.fontMono, fontSize: 10, color: step.dropOffPct >= 35 ? '#fbbf24' : T.text3, minWidth: 64, textAlign: 'right' }}>
                      {step.dropOffPct > 0 ? `-${step.dropOffPct}% drop` : `${step.conversionPct}%`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Explicit Opt-In Session Breadcrumb Replay */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.025)',
            border: `1px solid ${T.border}`,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: T.text1 }}>
                Opt-in interaction breadcrumb replay (default OFF)
              </div>
              <div style={{ fontSize: 10.5, color: T.text3, marginTop: 1 }}>
                When enabled, includes redacted UI step timestamps in exported diagnostic bundles. Never captures screen video, audio, resumes, or transcripts.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={optInReplay}
              onClick={toggleReplayOptIn}
              style={{
                height: 28,
                padding: '0 11px',
                borderRadius: 999,
                border: `1px solid ${optInReplay ? 'rgba(45,212,191,0.5)' : T.borderStrong}`,
                background: optInReplay ? 'rgba(20,184,166,0.2)' : T.surface2,
                color: optInReplay ? '#5eead4' : T.text3,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: T.fontMono,
              }}
            >
              {optInReplay ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
