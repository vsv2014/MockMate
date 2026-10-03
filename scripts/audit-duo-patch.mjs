import fs from 'node:fs'

function patch(file, before, after, expected = 1) {
  const text = fs.readFileSync(file, 'utf8')
  const count = text.split(before).length - 1
  if (count !== expected) throw new Error(`${file}: expected ${expected} match(es), found ${count}: ${before.slice(0, 140)}`)
  fs.writeFileSync(file, text.replaceAll(before, after))
}

patch('src/Duo.jsx',
  "function randomRoom() { return `mock-${randomToken(9)}` }",
  "function randomRoom() { return `mock-${randomToken(16)}` }",
)
patch('src/Duo.jsx',
  "if (!/^mock-[a-z0-9]{12,40}$/i.test(r)) { setErr('Enter a valid MockMate room code, or create a new room.'); return }",
  "if (!/^mock-[a-f0-9]{32,64}$/i.test(r)) { setErr('Enter a valid MockMate room code, or create a new room.'); return }",
)

patch('api/_lib/apiRoutes.js',
  "try { res.json(await mintToken(req.body || {})) }",
  "try { res.json(await mintToken({ ...(req.body || {}), requesterId: req.userId || null })) }",
)

patch('api/_lib/core.js',
`export async function mintToken({ room, identity, name } = {}) {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env
  if (!room || !identity) { const e = new Error('room and identity are required'); e.status = 400; throw e }
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {`,
`export async function mintToken({ room, identity, name, role = 'candidate', requesterId = null } = {}) {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env
  const roomId = String(room || '').trim()
  const requestedRole = role === 'interviewer' ? 'interviewer' : role === 'candidate' ? 'candidate' : null
  if (!/^mock-[a-f0-9]{32,64}$/i.test(roomId)) { const e = new Error('A valid high-entropy MockMate room code is required'); e.status = 400; throw e }
  if (!requestedRole) { const e = new Error('role must be candidate or interviewer'); e.status = 400; throw e }
  if (!identity && !requesterId) { const e = new Error('identity is required'); e.status = 400; throw e }
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {`)
patch('api/_lib/core.js',
`  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name: name || identity, ttl: '2h' })
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true })
  return { token: await at.toJwt(), url: LIVEKIT_URL }`,
`  const localIdentity = String(identity || 'peer').replace(/[^a-z0-9:_-]/gi, '_').slice(0, 96)
  const accountIdentity = requesterId ? `u_${String(requesterId).replace(/[^a-z0-9_-]/gi, '').slice(-40)}_${requestedRole}` : localIdentity
  const metadata = JSON.stringify({ mockmateRole: requestedRole, accountBound: !!requesterId })
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: accountIdentity, name: String(name || accountIdentity).slice(0, 120), metadata, ttl: '2h' })
  at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: true })
  return { token: await at.toJwt(), url: LIVEKIT_URL, identity: accountIdentity, role: requestedRole }`)

patch('src/Room.jsx',
`      <RoomAudioRenderer />
      <RoomInner session={session} onEnd={onEnd} onLeave={onLeave} />`,
`      <RoomAudioRenderer />
      <RoomInner session={{ ...session, identity: conn.identity || session.identity, role: conn.role || session.role }} onEnd={onEnd} onLeave={onLeave} />`)
patch('src/Room.jsx',
`function sanitizeSegment(raw, room, senderIdentity = '') {
  if (!raw || typeof raw !== 'object' || raw.kind && raw.kind !== 'segment') return null
  const id = String(raw.id || '').slice(0, 120)
  const text = String(raw.text || '').trim().slice(0, 8000)
  const identity = String(raw.identity || '').slice(0, 160)
  const role = String(raw.role || '')
  if (!id || !text || !identity || !validRole(role) || String(raw.room || '') !== String(room)) return null
  // A sender may label its own turn, but cannot impersonate another LiveKit participant.
  if (senderIdentity && identity !== senderIdentity) return null
  return { id, room: String(room), identity, speaker: String(raw.speaker || identity).slice(0, 120), role, text, ts: Number(raw.ts) || Date.now() }
}`,
`function participantRole(participant) {
  try {
    const meta = JSON.parse(participant?.metadata || '{}')
    return validRole(meta.mockmateRole) ? meta.mockmateRole : null
  } catch { return null }
}
function sanitizeSegment(raw, room, senderParticipant = null) {
  if (!raw || typeof raw !== 'object' || raw.kind && raw.kind !== 'segment') return null
  const id = String(raw.id || '').slice(0, 120)
  const text = String(raw.text || '').trim().slice(0, 8000)
  const identity = String(raw.identity || '').slice(0, 160)
  const tokenIdentity = String(senderParticipant?.identity || '').slice(0, 160)
  const tokenRole = participantRole(senderParticipant)
  if (!id || !text || !identity || !tokenIdentity || !tokenRole || String(raw.room || '') !== String(room)) return null
  // Identity + role come from the server-issued LiveKit token, never the data payload.
  if (identity !== tokenIdentity || raw.role !== tokenRole) return null
  return { id, room: String(room), identity, speaker: String(raw.speaker || identity).slice(0, 120), role: tokenRole, text, ts: Number(raw.ts) || Date.now() }
}`)
patch('src/Room.jsx',
`    const sender = msg.participant?.identity || msg.from?.identity || ''
    const row = sanitizeSegment(raw, session.room, sender)`,
`    const sender = msg.participant || msg.from || null
    const row = sanitizeSegment(raw, session.room, sender)`)
patch('src/Room.jsx',
`      const sender = msg.participant?.identity || msg.from?.identity || ''
      const rows = raw.rows.slice(-250).map(row => sanitizeSegment(row, session.room, row.identity === sender ? sender : '')).filter(Boolean)
      appendSegments(rows)`,
`      const rows = raw.rows.slice(-250).map(row => {
        const participant = participants.find(p => p.identity === row?.identity) || null
        return sanitizeSegment(row, session.room, participant)
      }).filter(Boolean)
      appendSegments(rows)`)

console.log('audit-duo-patch complete')
