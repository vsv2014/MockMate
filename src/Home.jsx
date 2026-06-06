import React, { useState } from 'react'

const PROFILE_KEY = 'peerMockProfile'
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {} } catch { return {} }
}

function randomRoom() {
  // No Math.random restriction in the browser; short, link-friendly id.
  return 'mock-' + Math.random().toString(36).slice(2, 8)
}

export default function Home({ onJoin }) {
  const params = new URLSearchParams(location.search)
  const invitedRoom = params.get('room') || ''

  const [name, setName] = useState(() => loadProfile().name || '')
  const [role, setRole] = useState(invitedRoom ? 'candidate' : 'interviewer')
  const [room, setRoom] = useState(invitedRoom)
  const [targetRole, setTargetRole] = useState(() => loadProfile().targetRole || '')
  const [resume, setResume] = useState(() => loadProfile().resume || '')

  function saveProfile(patch) {
    try {
      const prev = loadProfile()
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...prev, ...patch }))
    } catch {}
  }

  const speechOK = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

  function go(create) {
    const r = create ? randomRoom() : room.trim()
    if (!name.trim() || !r) return
    const identity = `${name.trim()}-${Math.random().toString(36).slice(2, 6)}`
    saveProfile({ name: name.trim(), targetRole, resume })
    history.replaceState(null, '', `?room=${encodeURIComponent(r)}`)
    onJoin({ room: r, name: name.trim(), role, identity, targetRole, resume })
  }

  return (
    <div className="wrap">
      <h1>Peer Mock</h1>
      <p className="subtitle">Practice interviews with a real person over a shared link. You <strong>speak</strong>, it transcribes live, and at the end an AI writes one shared feedback report you both see.</p>

      {!speechOK && (
        <div className="banner warn"><span>⚠</span><span>Live transcription needs <strong>Chrome or Edge</strong>. You can still talk, but your speech won’t be captured for the report in this browser.</span></div>
      )}

      {invitedRoom && (
        <div className="banner"><span>🎟️</span><span>You’ve been invited to room <strong>{invitedRoom}</strong>. Enter your name and join as the candidate (or switch role).</span></div>
      )}

      <div className="card">
        <div className="field">
          <label className="label">Your name</label>
          <input type="text" value={name} placeholder="e.g. Vishal" onChange={e => setName(e.target.value)} />
        </div>

        <div className="field">
          <label className="label">Your role this session</label>
          <div className="seg">
            <button className={role === 'interviewer' ? 'on' : ''} onClick={() => setRole('interviewer')}>🧑‍💼 Interviewer</button>
            <button className={role === 'candidate' ? 'on' : ''} onClick={() => setRole('candidate')}>🎯 Candidate</button>
          </div>
        </div>

        {role === 'candidate' && (
          <>
            <div className="field">
              <label className="label">Target role <span style={{ color: 'var(--text-faint)' }}>(optional — sharpens AI hints)</span></label>
              <input type="text" value={targetRole} placeholder="e.g. Senior Backend Engineer" onChange={e => setTargetRole(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Resume <span style={{ color: 'var(--text-faint)' }}>(optional — AI co-pilot uses this to flag resume-relevant questions)</span></label>
              <textarea rows={4} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 12px', borderRadius: 8 }}
                value={resume} placeholder="Paste your resume text…" onChange={e => setResume(e.target.value)} />
            </div>
          </>
        )}

        {invitedRoom ? (
          <button className="btn" disabled={!name.trim()} onClick={() => go(false)}>Join room</button>
        ) : (
          <>
            <button className="btn" disabled={!name.trim()} onClick={() => go(true)}>Create a room & get a link →</button>
            <div className="field" style={{ marginTop: 18 }}>
              <label className="label">…or join an existing room by code</label>
              <div className="row">
                <input type="text" value={room} placeholder="mock-ab12cd" onChange={e => setRoom(e.target.value)} />
                <button className="btn-ghost" style={{ flex: '0 0 auto' }} disabled={!name.trim() || !room.trim()} onClick={() => go(false)}>Join</button>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="subtitle" style={{ fontSize: 12.5 }}>Everyone in the room can see the live transcript and the AI feedback — this is for consenting practice partners, not for live help during a real interview.</p>
    </div>
  )
}
