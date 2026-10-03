import React, { useEffect, useState, useRef } from 'react'
import {
  LiveKitRoom, RoomAudioRenderer, useParticipants, useDataChannel,
  useLocalParticipant, useTracks, VideoTrack,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import '@livekit/components-styles'
import { useDeepgram } from './useDeepgram'
import { apiFetch } from './lib/apiClient'
import { T } from './auth/tokens'
import { isManaged } from './lib/aiMode'
import { loadModelSelection } from './lib/modelPicker'
import { retrieveContext } from './lib/docs'

const btnGhost = { background: 'transparent', border: `1px solid ${T.borderStrong}`, color: T.text1, padding: '8px 14px', borderRadius: T.rCtrl, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }
const btnPrimary = { ...btnGhost, background: T.accent, border: 'none', color: '#fff' }
const btnDanger = { ...btnGhost, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#ff8b8b' }
const metaStyle = { color: T.text2, fontSize: 13 }
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: T.text2, marginBottom: 6 }
const smallGhost = { ...btnGhost, padding: '2px 8px', fontSize: 11 }

function randomId(prefix = 'seg') {
  try { return `${prefix}_${crypto.randomUUID()}` } catch { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` }
}
function decodePayload(msg) {
  try { return JSON.parse(new TextDecoder().decode(msg.payload)) } catch { return null }
}
function validRole(role) { return role === 'candidate' || role === 'interviewer' }
function participantRole(participant) {
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
}

export default function Room({ session, onEnd, onLeave }) {
  const [conn, setConn] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    apiFetch('/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: session.room, identity: session.identity, name: session.name, role: session.role }),
      signal: controller.signal,
    })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || `Room connection failed (${r.status})`)
        return d
      })
      .then(setConn)
      .catch(e => { if (e?.name !== 'AbortError') setErr(e.message) })
    return () => controller.abort()
  }, [session.room, session.identity, session.name, session.role])

  const narrow = { maxWidth: 720, margin: '0 auto', padding: '40px 24px', fontFamily: T.font, color: T.text1 }
  if (err) return <div style={narrow}><div style={{ display: 'flex', gap: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: '#f5c66b', padding: '12px 16px', borderRadius: 10, marginBottom: 18, fontSize: 13 }}><span>⚠</span><span>{err}</span></div><button style={btnGhost} onClick={onLeave}>← Back</button></div>
  if (!conn) return <div style={narrow}><p style={{ color: T.text2 }}>Connecting to room <strong style={{ color: T.text1 }}>{session.room}</strong>…</p></div>

  return (
    <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio video={false} onDisconnected={onLeave}>
      <RoomAudioRenderer />
      <RoomInner session={{ ...session, identity: conn.identity || session.identity, role: conn.role || session.role }} onEnd={onEnd} onLeave={onLeave} />
    </LiveKitRoom>
  )
}

function RoomInner({ session, onEnd }) {
  const participants = useParticipants()
  const { localParticipant } = useLocalParticipant()
  const [transcript, setTranscript] = useState([])
  const transcriptRef = useRef([])
  const seenSegments = useRef(new Set())
  const participantRoles = useRef(new Map([[session.identity, session.role]]))
  const [ending, setEnding] = useState(false)
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef(null)

  const [hint, setHint] = useState(null)
  const [hintLoading, setHintLoading] = useState(false)
  const [hintOpen, setHintOpen] = useState(true)
  const [showFullHint, setShowFullHint] = useState(false)
  const [manualPrompt, setManualPrompt] = useState('')
  const [helperQuestion, setHelperQuestion] = useState('')
  const [helperNote, setHelperNote] = useState('')
  const [receivedNote, setReceivedNote] = useState(null)
  const lastHintQuestion = useRef('')
  const hintRequest = useRef(null)
  const [provider] = useState(() => isManaged() ? '' : loadModelSelection())
  const [sttError, setSttError] = useState('')

  const inElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron
  const electronProtection = inElectron && window.electronAPI?.platform !== 'linux'
  const pipSupported = typeof window !== 'undefined' && !!window.documentPictureInPicture
  const [pipWindow, setPipWindow] = useState(null)
  const [meetingMode, setMeetingMode] = useState(false)
  const [pipPrompted, setPipPrompted] = useState(false)

  const appendSegments = rows => {
    const accepted = []
    for (const row of rows || []) {
      if (!row?.id || seenSegments.current.has(row.id)) continue
      const knownRole = participantRoles.current.get(row.identity)
      if (knownRole && knownRole !== row.role) continue
      participantRoles.current.set(row.identity, row.role)
      seenSegments.current.add(row.id)
      accepted.push(row)
    }
    if (!accepted.length) return
    setTranscript(current => {
      const next = [...current, ...accepted].sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-1000)
      transcriptRef.current = next
      return next
    })
  }

  const { send: sendTranscript } = useDataChannel('transcript', msg => {
    const raw = decodePayload(msg)
    const sender = msg.participant || msg.from || null
    const row = sanitizeSegment(raw, session.room, sender)
    if (row) appendSegments([row])
  })

  const { send: sendHelperNote } = useDataChannel('helper-note', msg => {
    const raw = decodePayload(msg)
    const sender = msg.participant || msg.from || null
    if (!raw || raw.room !== session.room || participantRole(sender) !== 'interviewer') return
    const text = String(raw.text || '').trim().slice(0, 1000)
    if (!text) return
    setReceivedNote({ text, from: String(raw.speaker || sender?.name || 'Helper').slice(0, 80), ts: Date.now() })
  })

  const { send: sendSync } = useDataChannel('transcript-sync', msg => {
    const raw = decodePayload(msg)
    if (!raw || raw.room !== session.room) return
    if (raw.kind === 'request') {
      const rows = transcriptRef.current.slice(-250)
      try { sendSync(new TextEncoder().encode(JSON.stringify({ kind: 'snapshot', room: session.room, rows })), { reliable: true }) } catch {}
      return
    }
    if (raw.kind === 'snapshot' && Array.isArray(raw.rows)) {
      const rows = raw.rows.slice(-250).map(row => {
        const participant = participants.find(p => p.identity === row?.identity) || null
        return sanitizeSegment(row, session.room, participant)
      }).filter(Boolean)
      appendSegments(rows)
    }
  })

  useEffect(() => {
    const timer = setTimeout(() => {
      try { sendSync(new TextEncoder().encode(JSON.stringify({ kind: 'request', room: session.room, identity: session.identity })), { reliable: true }) } catch {}
    }, 400)
    return () => clearTimeout(timer)
  }, [participants.length]) // eslint-disable-line react-hooks/exhaustive-deps

  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
  function renderHintToPip(pip, { hint: h, hintLoading: loading, question }) {
    pip.document.body.innerHTML = `<div style="font-family:${T.font};font-size:13px;color:${T.text1};padding:14px;height:100%;box-sizing:border-box;background:${T.bg};"><div style="font-weight:700;font-size:14px;margin-bottom:4px;color:#a78bfa;">🤖 AI Co-pilot</div><div style="font-size:10px;color:${T.text3};margin-bottom:10px;">floating hint window — always verify your meeting share preview</div>${question ? `<div style="color:${T.text2};font-size:11px;margin-bottom:10px;border-left:2px solid ${T.borderStrong};padding-left:8px;font-style:italic">${escapeHtml(question)}</div>` : ''}${loading ? `<p style="color:${T.text3};margin:0">Generating hints…</p>` : h ? `${h.resumeRelevant ? '<span style="background:#14532d;color:#4ade80;border-radius:4px;padding:2px 7px;font-size:11px;margin-bottom:8px;display:inline-block">✓ Resume-relevant</span>' : ''}<div style="font-weight:600;margin:8px 0 4px;color:${T.text1}">Key points:</div><ul style="margin:0 0 10px;padding-left:18px;color:${T.text1}">${(h.keyPoints || []).map(p => `<li style="margin-bottom:3px">${escapeHtml(p)}</li>`).join('')}</ul>${h.watchOut ? `<div style="color:#f59e0b;font-size:12px">⚠ ${escapeHtml(h.watchOut)}</div>` : ''}` : `<p style="color:${T.text3};margin:0">Waiting for next question…</p>`}</div>`
  }

  async function openPip() {
    if (!window.documentPictureInPicture) return
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 400, height: 320 })
      pip.document.body.style.cssText = `margin:0;padding:0;background:${T.bg};`
      pip.addEventListener('pagehide', () => { setPipWindow(null); setMeetingMode(false) })
      renderHintToPip(pip, { hint, hintLoading, question: lastHintQuestion.current })
      setPipWindow(pip); setPipPrompted(true)
    } catch {}
  }
  async function toggleMeetingMode() {
    if (meetingMode) { try { pipWindow?.close() } catch {}; setPipWindow(null); setMeetingMode(false) }
    else { setMeetingMode(true); if (pipSupported) await openPip() }
  }
  useEffect(() => { if (pipWindow && !pipWindow.closed) renderHintToPip(pipWindow, { hint, hintLoading, question: lastHintQuestion.current }) }, [hint, hintLoading, pipWindow]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { try { pipWindow?.close() } catch {}; hintRequest.current?.abort?.() }, [pipWindow])

  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false }).filter(t => t.publication?.track)
  const sharing = screenTracks.some(t => t.participant?.isLocal)
  async function toggleShare() {
    try { await localParticipant.setScreenShareEnabled(!sharing) } catch { /* user cancelled */ }
  }

  const speech = useDeepgram(text => {
    const seg = { id: randomId(), kind: 'segment', room: session.room, identity: session.identity, speaker: session.name, role: session.role, text, ts: Date.now() }
    appendSegments([seg])
    try { sendTranscript(new TextEncoder().encode(JSON.stringify(seg)), { reliable: true }) } catch {}
  }, reason => setSttError(reason || 'Voice transcription stopped'))

  useEffect(() => {
    if (session.role !== 'candidate' || !electronProtection) return
    window.electronAPI.setRoomActive?.(true)
    return () => window.electronAPI.setRoomActive?.(false)
  }, [session.role, electronProtection])

  async function requestHintForQuestion(questionText, questionId = randomId('q')) {
    const question = String(questionText || '').trim()
    if (!question) return
    lastHintQuestion.current = questionId
    setHintLoading(true); setHint(null); setHintOpen(true); setShowFullHint(false)
    if (electronProtection) window.electronAPI.sendHint?.({ hint: null, hintLoading: true, question })
    hintRequest.current?.abort?.()
    const controller = new AbortController(); hintRequest.current = controller
    const profile = {
      name: session.name,
      targetRole: session.targetRole,
      targetCompany: session.targetCompany || '',
      jobDescription: session.jobDescription || '',
      customPrompt: session.customInstructions || '',
      resume: session.resume,
    }
    let extraContext = ''
    try { extraContext = await retrieveContext(question) } catch {}
    apiFetch('/api/hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        profile,
        provider,
        conversationHistory: transcriptRef.current.slice(-8).map(t => ({ role: t.role, text: t.text })),
        ...(extraContext ? { extraContext } : {}),
      }),
      signal: controller.signal,
    })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error || `Hint failed (${r.status})`); return d })
      .then(d => {
        if (controller.signal.aborted || lastHintQuestion.current !== questionId) return
        setHint(d.hint || null); setHintLoading(false)
        if (electronProtection) window.electronAPI.sendHint?.({ hint: d.hint || null, hintLoading: false, question })
      })
      .catch(e => {
        if (e?.name === 'AbortError') return
        if (lastHintQuestion.current === questionId) { setHintLoading(false); setSttError(e?.message || 'Could not generate hint') }
      })
  }

  useEffect(() => {
    if (session.role !== 'candidate') return
    const last = [...transcript].reverse().find(s => s.role === 'interviewer')
    if (!last || last.id === lastHintQuestion.current) return
    requestHintForQuestion(last.text, last.id)
  }, [transcript]) // eslint-disable-line react-hooks/exhaustive-deps

  function sendInterviewerQuestion(text) {
    const clean = String(text || '').trim()
    if (!clean) return
    const seg = { id: randomId(), kind: 'segment', room: session.room, identity: session.identity, speaker: session.name, role: session.role, text: clean, ts: Date.now() }
    appendSegments([seg])
    try { sendTranscript(new TextEncoder().encode(JSON.stringify(seg)), { reliable: true }) } catch {}
    setHelperQuestion('')
  }

  function broadcastHelperNote() {
    const clean = String(helperNote || '').trim()
    if (!clean) return
    try {
      sendHelperNote(new TextEncoder().encode(JSON.stringify({
        room: session.room,
        speaker: session.name,
        text: clean,
      })), { reliable: true })
      setHelperNote('')
    } catch {}
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try { await speech.start(); if (!cancelled) setSttError('') }
      catch (e) { if (!cancelled) setSttError(e.message || 'Could not start Deepgram transcription') }
    })()
    return () => { cancelled = true; speech.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, speech.interim])

  function shareLink() {
    try { navigator.clipboard?.writeText?.(session.room)?.catch?.(() => {}) } catch {}
    setCopied(true); setTimeout(() => setCopied(false), 2500)
  }
  async function end() {
    setEnding(true); speech.stop(); hintRequest.current?.abort?.()
    try {
      const res = await apiFetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: transcriptRef.current, candidateName: session.role === 'candidate' ? session.name : undefined, role: session.role }) })
      const d = await res.json(); onEnd(d.report || { error: d.error || 'No report returned.' }, transcriptRef.current)
    } catch (e) { onEnd({ error: e.message }, transcriptRef.current) }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 24px', fontFamily: T.font, color: T.text1 }}>
      <style>{`@keyframes mm-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 650, color: T.text1 }}>Room {session.room}</h2><span style={metaStyle}>· you are <strong style={{ color: T.text1 }}>{session.role}</strong></span><span style={{ flex: 1 }} />
        {session.role === 'candidate' && pipSupported && <button style={meetingMode ? btnPrimary : btnGhost} title="Moves AI hints to a floating window; always verify the meeting share preview" onClick={toggleMeetingMode}>{meetingMode ? '🛡️ Meeting mode — on' : '🛡️ Meeting mode'}</button>}
        <button style={sharing ? btnPrimary : btnGhost} onClick={toggleShare}>{sharing ? '🟢 Sharing — stop' : '🖥️ Share screen'}</button>
        <button style={btnGhost} onClick={shareLink} title={`Room code ${session.room}`}>{copied ? `📋 Code: ${session.room}` : '🔗 Share room code'}</button>
        <button style={{ ...btnDanger, opacity: ending ? 0.5 : 1 }} onClick={end} disabled={ending}>{ending ? 'Scoring…' : 'End & get feedback'}</button>
      </div>

      {screenTracks.length > 0 && <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>{screenTracks.map(tr => <div style={{ position: 'relative', border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden', maxWidth: '100%' }} key={tr.publication.trackSid}><VideoTrack trackRef={tr} /><div style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 6px', borderRadius: 6 }}>🖥️ {tr.participant?.name || tr.participant?.identity}{tr.participant?.isLocal ? ' (you)' : ''}</div></div>)}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={labelStyle}>In the room ({participants.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{participants.map(p => <div key={p.identity} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: `1px solid ${p.isSpeaking ? T.success : T.border}`, borderRadius: 10, background: T.surface1 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: p.isSpeaking ? T.success : T.text3, boxShadow: p.isSpeaking ? '0 0 0 4px rgba(34,197,94,0.13)' : 'none' }} /><span style={{ fontWeight: 600 }}>{p.name || p.identity}{p.isLocal ? ' (you)' : ''}</span></div>)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            {sttError ? <span style={metaStyle}>⚠ {sttError}. Fix Voice settings, then retry.</span> : speech.active ? <><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff5b5b', animation: 'mm-pulse 1.2s infinite' }} /><span style={metaStyle}>Listening (Deepgram)</span><span style={{ flex: 1 }} /><button style={btnGhost} onClick={speech.stop}>Pause mic text</button></> : <><span style={metaStyle}>Mic transcription paused</span><span style={{ flex: 1 }} /><button style={btnGhost} onClick={() => { setSttError(''); speech.start() }}>Resume</button></>}
          </div>
        </div>

        <div>
          {session.role === 'candidate' && receivedNote && (
            <div style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: 10, padding: '10px 14px', marginBottom: 10, fontSize: 12.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span>💡 <strong>Coaching note from {receivedNote.from}:</strong> {receivedNote.text}</span>
              <button type="button" style={smallGhost} onClick={() => setReceivedNote(null)}>Dismiss</button>
            </div>
          )}

          {session.role === 'candidate' && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input
                value={manualPrompt}
                onChange={e => setManualPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && manualPrompt.trim()) { requestHintForQuestion(manualPrompt); setManualPrompt('') } }}
                placeholder="Ask private AI co-pilot a question or coding prompt…"
                style={{ flex: 1, height: 36, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, color: T.text1, fontSize: 12.5, padding: '0 10px', fontFamily: T.font }}
              />
              <button
                type="button"
                disabled={!manualPrompt.trim() || hintLoading}
                onClick={() => { requestHintForQuestion(manualPrompt); setManualPrompt('') }}
                style={{ ...btnPrimary, padding: '0 12px', height: 36, fontSize: 12, opacity: manualPrompt.trim() && !hintLoading ? 1 : 0.5 }}>
                ⚡ Ask AI
              </button>
            </div>
          )}

          {session.role === 'interviewer' && (
            <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>🧑‍🏫 Helper Question Bank &amp; Coaching</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {[
                  `Walk me through the most complex system you architected for ${session.targetRole || 'this role'} and its key trade-offs.`,
                  `Tell me about a time a production incident or tight deadline forced you to make a difficult engineering trade-off.`,
                  `How would you design a scalable, fault-tolerant service for ${session.targetCompany || 'high-throughput traffic'}?`,
                  `What metrics did you use to validate the impact of your most recent project?`,
                ].map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendInterviewerQuestion(q)}
                    style={{ ...smallGhost, textAlign: 'left', padding: '4px 8px', fontSize: 11 }}>
                    + Ask Q{idx + 1}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  value={helperQuestion}
                  onChange={e => setHelperQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && helperQuestion.trim()) sendInterviewerQuestion(helperQuestion) }}
                  placeholder="Type an interview question to send to the room…"
                  style={{ flex: 1, height: 34, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, color: T.text1, fontSize: 12, padding: '0 10px', fontFamily: T.font }}
                />
                <button type="button" onClick={() => sendInterviewerQuestion(helperQuestion)} disabled={!helperQuestion.trim()} style={{ ...btnPrimary, padding: '0 12px', height: 34, fontSize: 12, opacity: helperQuestion.trim() ? 1 : 0.5 }}>Ask</button>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={helperNote}
                  onChange={e => setHelperNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && helperNote.trim()) broadcastHelperNote() }}
                  placeholder="Send a private coaching nudge to the candidate…"
                  style={{ flex: 1, height: 34, background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, color: T.text1, fontSize: 12, padding: '0 10px', fontFamily: T.font }}
                />
                <button type="button" onClick={broadcastHelperNote} disabled={!helperNote.trim()} style={{ ...btnGhost, padding: '0 12px', height: 34, fontSize: 12, opacity: helperNote.trim() ? 1 : 0.5 }}>💡 Nudge</button>
              </div>
            </div>
          )}

          {session.role === 'candidate' && !inElectron && pipSupported && !pipPrompted && (hintLoading || hint) && !pipWindow && <div style={{ background: '#1e1b4b', border: '1px solid #4338ca', borderRadius: 10, padding: '10px 14px', marginBottom: 10, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: '#a5b4fc' }}>🛡️ <strong>Sharing your screen?</strong> Move hints to a floating window and verify your preview.</span><button style={{ ...smallGhost, marginLeft: 'auto', whiteSpace: 'nowrap' }} onClick={openPip}>🪟 Pop out</button><button style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 16 }} onClick={() => setPipPrompted(true)}>×</button></div>}

          {session.role === 'candidate' && (hintLoading || hint) && (
            electronProtection ? <div style={{ background: '#0d1117', border: '1px solid #4338ca', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#a5b4fc' }}>🛡️ Hints are in the OS-protected Electron window — still verify the meeting share preview.</div>
              : pipWindow ? <div style={{ background: T.surface1, border: `1px solid ${T.borderStrong}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: T.text3 }}>AI hints are in the floating window — verify your share preview. <button style={smallGhost} onClick={() => { pipWindow.close(); setPipWindow(null) }}>Close</button></div>
                : sharing ? <div style={{ background: '#1c1917', border: '1px solid #57534e', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#a8a29e' }}>🔒 AI hints hidden while screen sharing.{pipSupported ? ' Pop them out only after checking your share preview.' : ''}{pipSupported && <button style={{ ...smallGhost, marginLeft: 8 }} onClick={openPip}>🪟 Pop out</button>}</div>
                  : <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontWeight: 600, fontSize: 13 }}>🤖 AI Co-pilot <span style={{ color: T.text3, fontWeight: 400, fontSize: 12 }}>· private UI; verify share preview</span></span><div style={{ display: 'flex', gap: 6 }}>{pipSupported && <button style={smallGhost} onClick={openPip}>🪟 Pop out</button>}<button style={smallGhost} onClick={() => setHintOpen(v => !v)}>{hintOpen ? 'Hide' : 'Show'}</button></div></div>{hintOpen && (hintLoading ? <p style={{ color: T.text3, fontSize: 13, margin: 0 }}>Generating hints…</p> : hint && <div style={{ fontSize: 13 }}>{hint.resumeRelevant && <span style={{ display: 'inline-block', background: '#22c55e22', color: '#4ade80', borderRadius: 6, padding: '1px 8px', fontSize: 11, marginBottom: 8 }}>✓ Resume-relevant</span>}{hint.opener && <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 8, padding: '6px 9px', borderRadius: 6, background: 'rgba(20,184,166,0.10)', borderLeft: `3px solid ${T.accent}` }}>{hint.opener}</div>}<div style={{ fontWeight: 600, marginBottom: 4 }}>Key points to hit:</div><ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>{(hint.keyPoints || []).map((pt, i) => <li key={i}>{pt}</li>)}</ul>{(hint.fullAnswer || hint.sampleAnswer) && <div style={{ marginTop: 6 }}><button type="button" style={smallGhost} onClick={() => setShowFullHint(v => !v)}>{showFullHint ? 'Hide full answer' : 'Show full answer / code'}</button>{showFullHint && <div style={{ marginTop: 6, padding: 10, borderRadius: 8, background: T.surface2, fontSize: 12.5, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{hint.fullAnswer || hint.sampleAnswer}</div>}</div>}{hint.watchOut && <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 6 }}>⚠ {hint.watchOut}</div>}</div>)}</div>
          )}

          <div style={labelStyle}>Live transcript</div>
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, background: T.surface1, padding: 14, height: 420, overflowY: 'auto' }}>
            {transcript.length === 0 && !speech.interim && <p style={metaStyle}>Start talking — finalized turns are synchronized with your partner.</p>}
            {transcript.map(s => <div key={s.id} style={{ marginBottom: 12 }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: s.role === 'candidate' ? '#7fb0ff' : '#f5c66b' }}>{s.speaker} · {s.role}</span>{session.role === 'candidate' && s.role === 'interviewer' && <button type="button" style={smallGhost} onClick={() => requestHintForQuestion(s.text, s.id)}>⚡ Hint</button>}</div><div>{s.text}</div></div>)}
            {speech.interim && <div style={{ marginBottom: 12 }}><div style={{ color: T.text3, fontStyle: 'italic' }}>{speech.interim}…</div></div>}<div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
