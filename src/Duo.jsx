import React, { useState } from 'react'
import { T } from './auth/tokens'
import Room from './Room'
import SoloFeedback from './SoloFeedback'
import { loadProfile } from './lib/profile'

// MockMate Duo — a live room where a friend/mentor joins your interview: shared transcript +
// screen, and a PRIVATE AI co-pilot only the candidate sees. Self-contained flow:
//   lobby → room (LiveKit) → report.  Backend: /api/token (LiveKit), /api/hint, /api/report.
// Replaces the legacy Home.jsx room entry; styled to the dashboard.

function randomRoom() {
  return 'mock-' + Math.random().toString(36).slice(2, 8)
}
function paramRoom() {
  try { return new URLSearchParams(location.search).get('room') || '' } catch { return '' }
}

// Module-level so they keep a stable identity across renders (defining them inside Duo would
// remount the inputs and drop focus on every keystroke).
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, color: T.text2, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}
function RoleBtn({ label, hint, active, onSelect }) {
  return (
    <button onClick={onSelect}
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
  const [phase, setPhase] = useState('lobby')          // lobby | room | report
  const [session, setSession] = useState(null)
  const [report, setReport] = useState(null)
  const [convo, setConvo] = useState([])               // room transcript, for the feedback screen

  const [name, setName] = useState(prof.name || '')
  // Default to candidate — the person opening/creating a room almost always wants the AI co-pilot.
  const [role, setRole] = useState('candidate')
  const [room, setRoom] = useState(invited)
  const [targetRole, setTargetRole] = useState(prof.targetRole || '')
  const [err, setErr] = useState('')

  function start(create) {
    if (!name.trim()) { setErr('Enter your name first.'); return }
    const r = create ? randomRoom() : room.trim()
    if (!r) { setErr('Enter a room code, or create a new room.'); return }
    setErr('')
    try { history.replaceState(null, '', `?room=${encodeURIComponent(r)}`) } catch {}
    setSession({
      room: r, name: name.trim(), role,
      identity: `${name.trim()}-${Math.random().toString(36).slice(2, 6)}`,
      targetRole, resume: prof.resume || '',
    })
    setPhase('room')
  }

  if (phase === 'room' && session) {
    return (
      <Room
        session={session}
        onEnd={(rep, tr) => { setReport(rep); setConvo(tr || []); setPhase('report') }}
        onLeave={() => { setPhase('lobby'); try { history.replaceState(null, '', location.pathname) } catch {} }}
      />
    )
  }

  if (phase === 'report') {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <SoloFeedback report={report || { error: 'No report.' }} transcript={convo}
          onAgain={() => { setReport(null); setRoom(''); try { history.replaceState(null, '', location.pathname) } catch {} ; setPhase('lobby') }} onAgainLabel="← Back to Duo" />
      </div>
    )
  }

  // ── Lobby ── (Field/RoleBtn are module-level — defining them here would give them a new identity
  // each render, remounting the inputs and dropping focus on every keystroke.)
  const inp = { width: '100%', height: 40, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, color: T.text1, fontSize: 13, padding: '0 12px', fontFamily: T.font, boxSizing: 'border-box' }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: T.text1 }}>Duo <span style={{ fontSize: 11, color: '#c4b5fd', background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 999, padding: '2px 8px', verticalAlign: 'middle' }}>Beta</span></div>
          <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>A friend joins your interview live — shared transcript &amp; screen, plus a private AI co-pilot only the candidate sees.</div>
        </div>
        <button onClick={onHome} style={{ height: 38, padding: '0 16px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 13, cursor: 'pointer', fontFamily: T.font }}>← Back</button>
      </div>

      {invited && (
        <div style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#c4b5fd', marginBottom: 12 }}>
          🎟️ You were invited to room <strong>{invited}</strong>. Enter your name and join.
        </div>
      )}
      {err && <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.35)', borderRadius: T.rCtrl, padding: '10px 12px', fontSize: 12, color: '#fca5a5', marginBottom: 12 }}>{err}</div>}

      <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: 18 }}>
        <Field label="Your name"><input style={inp} value={name} placeholder="e.g. Charan" onChange={e => setName(e.target.value)} /></Field>

        <Field label="Your role in the room">
          <div style={{ display: 'flex', gap: 8 }}>
            <RoleBtn label="🎤 Candidate" hint="You interview — get private AI hints" active={role === 'candidate'} onSelect={() => setRole('candidate')} />
            <RoleBtn label="🧑‍🏫 Helper" hint="You ask questions / assist" active={role === 'interviewer'} onSelect={() => setRole('interviewer')} />
          </div>
        </Field>

        {role === 'candidate' && (
          <Field label="Target role (sharpens your AI hints)"><input style={inp} value={targetRole} placeholder="e.g. Senior Backend Engineer" onChange={e => setTargetRole(e.target.value)} /></Field>
        )}

        {invited ? (
          <button onClick={() => start(false)} style={{ width: '100%', height: 46, marginTop: 6, background: '#a78bfa', color: '#1a1033', border: 'none', borderRadius: T.rCtrl, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: T.font }}>Join room {invited} →</button>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={() => start(true)} style={{ flex: 1, height: 46, background: '#a78bfa', color: '#1a1033', border: 'none', borderRadius: T.rCtrl, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: T.font }}>Create a room →</button>
            <div style={{ display: 'flex', gap: 6, flex: 1 }}>
              <input style={{ ...inp, height: 46 }} value={room} placeholder="join code e.g. mock-ab12cd" onChange={e => setRoom(e.target.value)} />
              <button onClick={() => start(false)} style={{ height: 46, padding: '0 16px', background: 'transparent', color: T.text1, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font, whiteSpace: 'nowrap' }}>Join</button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 10.5, color: T.text3, marginTop: 10 }}>After you create a room, use “🔗 Invite link” inside to bring in your partner. Needs LiveKit configured (LIVEKIT_URL / KEY / SECRET).</div>
      </div>
    </div>
  )
}
