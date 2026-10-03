import React, { useState } from 'react'
import { T } from './auth/tokens'
import Room from './Room'
import SoloFeedback from './SoloFeedback'
import { loadProfile, saveProfile } from './lib/profile'
import { saveSession } from './history'
import { downloadTextFile } from './lib/clipboard'

// MockMate Duo — shared room (LiveKit) + private candidate co-pilot.
const RECENT_DUO_KEY = 'mm-duo-recent-v1'

function randomToken(bytes = 16) {
  try {
    const a = new Uint8Array(bytes)
    crypto.getRandomValues(a)
    return [...a].map(v => v.toString(16).padStart(2, '0')).join('')
  } catch {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0').slice(0, 32)
  }
}
function randomRoom() { return `mock-${randomToken(16)}` }
function randomIdentity(name) { return `${String(name || 'peer').replace(/[^a-z0-9_-]/gi, '_').slice(0, 32)}-${randomToken(8)}` }
function paramRoom() {
  try {
    const p = new URLSearchParams(location.search)
    return p.get('room') || p.get('duo') || ''
  } catch { return '' }
}

function loadRecentRooms() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_DUO_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(r => r && /^mock-[a-f0-9]{32,64}$/i.test(r.room)).slice(0, 3) : []
  } catch { return [] }
}

function saveRecentRoom(entry) {
  try {
    const prev = loadRecentRooms().filter(r => r.room !== entry.room)
    const next = [entry, ...prev].slice(0, 3)
    localStorage.setItem(RECENT_DUO_KEY, JSON.stringify(next))
    return next
  } catch { return [] }
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 12 }}><div style={{ fontSize: 11.5, color: T.text2, marginBottom: 6 }}>{label}</div>{children}</div>
}
function RoleBtn({ label, hint, active, onSelect }) {
  return (
    <button type="button" onClick={onSelect}
      style={{ flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font,
        background: active ? 'rgba(167,139,250,0.15)' : T.surface2,
        border: `1px solid ${active ? 'rgba(167,139,250,0.5)' : T.border}`, color: active ? '#c4b5fd' : T.text2 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 10.5, color: T.text3, marginTop: 2 }}>{hint}</div>
    </button>
  )
}

export default function Duo({ onHome }) {
  const invited = paramRoom()
  const prof = loadProfile()
  const [phase, setPhase] = useState('lobby')
  const [session, setSession] = useState(null)
  const [report, setReport] = useState(null)
  const [convo, setConvo] = useState([])
  const [name, setName] = useState(prof.name || '')
  const [role, setRole] = useState('candidate')
  const [room, setRoom] = useState(invited)
  const [targetRole, setTargetRole] = useState(prof.targetRole || '')
  const [targetCompany, setTargetCompany] = useState(prof.targetCompany || '')
  const [jobDescription, setJobDescription] = useState(prof.jobDescription || '')
  const [recentRooms, setRecentRooms] = useState(loadRecentRooms)
  const [err, setErr] = useState('')

  const effectivePlaybook = String(prof.customInstructions || '').trim()

  function start(create, overrideRoom = '') {
    if (!name.trim()) { setErr('Enter your name first.'); return }
    const r = (overrideRoom || (create ? randomRoom() : room)).trim()
    if (!/^mock-[a-f0-9]{32,64}$/i.test(r)) { setErr('Enter a valid MockMate room code (e.g. mock-7f3a...), or create a new room.'); return }
    setErr('')
    try {
      saveProfile({
        ...prof,
        name: name.trim(),
        targetRole: targetRole.trim(),
        targetCompany: targetCompany.trim(),
        jobDescription: jobDescription.trim(),
      })
    } catch {}
    try { history.replaceState(null, '', `?room=${encodeURIComponent(r)}`) } catch {}
    const nextRecents = saveRecentRoom({
      room: r,
      role,
      targetRole: targetRole.trim() || 'Duo Interview',
      targetCompany: targetCompany.trim(),
      ts: Date.now(),
    })
    setRecentRooms(nextRecents)
    setSession({
      room: r,
      name: name.trim(),
      role,
      identity: randomIdentity(name.trim()),
      targetRole: targetRole.trim(),
      targetCompany: targetCompany.trim(),
      jobDescription: jobDescription.trim(),
      customInstructions: effectivePlaybook,
      resume: prof.resume || '',
    })
    setPhase('room')
  }

  function exportReportMarkdown() {
    const lines = [
      `# MockMate Duo Session Report`,
      `- **Role**: ${session?.targetRole || 'Interview Practice'}`,
      session?.targetCompany ? `- **Company**: ${session.targetCompany}` : '',
      `- **Participant Role**: ${session?.role || role}`,
      report?.overallScore != null ? `- **Overall Score**: ${report.overallScore}/100` : '',
      '',
      report?.summary ? `## Executive Summary\n${report.summary}\n` : '',
      `## Transcript (${convo.length} turns)`,
      ...convo.map(t => `- **${t.speaker || t.role}** (${t.role}): ${t.text}`),
    ].filter(Boolean).join('\n')
    downloadTextFile(`mockmate-duo-${Date.now()}.md`, lines, 'text/markdown;charset=utf-8')
  }

  if (phase === 'room' && session) {
    return <Room session={session}
      onEnd={(rep, tr) => {
        setReport(rep)
        setConvo(tr || [])
        try {
          saveSession({
            report: rep || { overallScore: 0, summary: 'Duo session completed.' },
            transcript: (tr || []).map(row => ({
              role: row.role === 'candidate' ? 'candidate' : 'interviewer',
              text: row.text,
              ts: row.ts,
            })),
            config: {
              mode: 'duo',
              domainLabel: session.targetRole || 'Duo Interview',
              roundLabel: `Duo (${session.role})`,
              company: session.targetCompany || '',
            },
            profile: {
              name: session.name,
              targetRole: session.targetRole,
              targetCompany: session.targetCompany,
            },
          })
        } catch {}
        setPhase('report')
      }}
      onLeave={() => { setPhase('lobby'); try { history.replaceState(null, '', location.pathname) } catch {} }} />
  }

  if (phase === 'report') {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            type="button"
            onClick={exportReportMarkdown}
            style={{
              height: 34, padding: '0 14px', background: T.surface2, color: T.text1,
              border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 12,
              fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
            }}>
            ⬇ Export Session Markdown
          </button>
        </div>
        <SoloFeedback
          report={report || { error: 'No report.' }}
          transcript={convo}
          onAgain={() => { setReport(null); setRoom(''); try { history.replaceState(null, '', location.pathname) } catch {}; setPhase('lobby') }}
          onAgainLabel="← Back to Duo"
        />
      </div>
    )
  }

  const inp = { width: '100%', height: 40, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, color: T.text1, fontSize: 13, padding: '0 12px', fontFamily: T.font, boxSizing: 'border-box' }
  return (
    <div style={{ maxWidth: 660, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: T.text1 }}>Duo <span style={{ fontSize: 11, color: '#c4b5fd', background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 999, padding: '2px 8px', verticalAlign: 'middle' }}>Collaborative Room</span></div>
          <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>A friend or mentor joins your interview live — shared transcript, question bank &amp; screen share, plus a private AI co-pilot only the candidate sees.</div>
        </div>
        <button type="button" onClick={onHome} style={{ height: 38, padding: '0 16px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 13, cursor: 'pointer', fontFamily: T.font }}>← Back</button>
      </div>

      {invited && <div style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#c4b5fd', marginBottom: 12 }}>🎟️ You were invited to room <strong>{invited}</strong>. Enter your name and join.</div>}
      {err && <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#fca5a5', marginBottom: 12 }}>{err}</div>}

      <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: 18 }}>
        <Field label="Your name"><input style={inp} value={name} placeholder="e.g. Charan" onChange={e => setName(e.target.value)} /></Field>
        <Field label="Your role in the room"><div style={{ display: 'flex', gap: 8 }}>
          <RoleBtn label="🎤 Candidate" hint="You interview — get private AI hints & RAG grounding" active={role === 'candidate'} onSelect={() => setRole('candidate')} />
          <RoleBtn label="🧑‍🏫 Helper / Interviewer" hint="Ask questions from the bank & send live coaching nudges" active={role === 'interviewer'} onSelect={() => setRole('interviewer')} />
        </div></Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Target role"><input style={inp} value={targetRole} placeholder="e.g. Senior Backend Engineer" onChange={e => setTargetRole(e.target.value)} /></Field>
          <Field label="Target company (optional)"><input style={inp} value={targetCompany} placeholder="e.g. Stripe" onChange={e => setTargetCompany(e.target.value)} /></Field>
        </div>

        {role === 'candidate' && (
          <>
            <Field label="Job description / focus areas (grounds your private AI co-pilot)">
              <textarea
                rows={3}
                style={{ ...inp, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                value={jobDescription}
                placeholder="Paste key JD requirements or topics you want your private AI co-pilot to emphasize…"
                onChange={e => setJobDescription(e.target.value)}
              />
            </Field>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: T.text3, marginBottom: 12, padding: '8px 10px', borderRadius: T.rCtrl, background: T.surface2, border: `1px solid ${T.border}` }}>
              <span>
                Resume: <strong style={{ color: prof.resume ? T.success : T.warning }}>{prof.resume ? '✓ Loaded' : 'Not set'}</strong>
                {' · '}
                Playbook: <strong style={{ color: effectivePlaybook ? '#c4b5fd' : T.text2 }}>{effectivePlaybook ? '✓ Custom rules active' : 'Standard defaults'}</strong>
              </span>
            </div>
          </>
        )}

        {invited ? (
          <button type="button" onClick={() => start(false)} style={{ width: '100%', height: 46, marginTop: 6, background: '#a78bfa', color: '#1a1033', border: 'none', borderRadius: T.rCtrl, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: T.font }}>Join room {invited} →</button>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => start(true)} style={{ flex: 1, minWidth: 160, height: 46, background: '#a78bfa', color: '#1a1033', border: 'none', borderRadius: T.rCtrl, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: T.font }}>Create a room →</button>
            <div style={{ display: 'flex', gap: 6, flex: 1.3, minWidth: 240 }}>
              <input style={{ ...inp, height: 46 }} value={room} placeholder="join code e.g. mock-7f3a9c1d8b22e4aa10..." onChange={e => setRoom(e.target.value)} />
              <button type="button" onClick={() => start(false)} style={{ height: 46, padding: '0 16px', background: 'transparent', color: T.text1, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font, whiteSpace: 'nowrap' }}>Join</button>
            </div>
          </div>
        )}

        {recentRooms.length > 0 && !invited && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.text3, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px' }}>Recent Duo Rooms (Quick Rejoin)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {recentRooms.map(r => (
                <button
                  key={r.room}
                  type="button"
                  onClick={() => { setRoom(r.room); start(false, r.room) }}
                  style={{
                    fontSize: 11.5, padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: T.font,
                    background: T.surface2, border: `1px solid ${T.border}`, color: T.text2,
                  }}>
                  ↻ {r.room.slice(0, 13)}… ({r.targetRole || r.role})
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: 10.5, color: T.text3, marginTop: 10 }}>Share the generated room code with your partner. Completed Duo sessions are saved to your local History.</div>
      </div>
    </div>
  )
}
