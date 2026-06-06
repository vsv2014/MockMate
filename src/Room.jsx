import React, { useEffect, useState, useRef } from 'react'
import {
  LiveKitRoom, RoomAudioRenderer, useParticipants, useDataChannel,
  useLocalParticipant, useTracks, VideoTrack
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { useSpeech } from './useSpeech'

export default function Room({ session, onEnd, onLeave }) {
  const [conn, setConn] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: session.room, identity: session.identity, name: session.name })
    })
      .then(r => r.json())
      .then(d => d.error ? setErr(d.error) : setConn(d))
      .catch(e => setErr(e.message))
  }, [])

  if (err) return (
    <div className="wrap">
      <div className="banner warn"><span>⚠</span><span>{err}</span></div>
      <button className="btn-ghost" onClick={onLeave}>← Back</button>
    </div>
  )
  if (!conn) return <div className="wrap"><p className="subtitle">Connecting to room <strong>{session.room}</strong>…</p></div>

  return (
    <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio video={false} onDisconnected={onLeave}>
      <RoomAudioRenderer />
      <RoomInner session={session} onEnd={onEnd} onLeave={onLeave} />
    </LiveKitRoom>
  )
}

function RoomInner({ session, onEnd, onLeave }) {
  const participants = useParticipants()
  const { localParticipant } = useLocalParticipant()
  const [transcript, setTranscript] = useState([])   // { speaker, role, text }
  const [ending, setEnding] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const bottomRef = useRef(null)

  // AI co-pilot state (candidate only)
  const [hint, setHint] = useState(null)
  const [hintLoading, setHintLoading] = useState(false)
  const [hintOpen, setHintOpen] = useState(true)
  const lastHintQuestion = useRef('')
  const [provider] = useState(() => { try { return localStorage.getItem('llmProvider') || '' } catch { return '' } })

  // Content protection: Document Picture-in-Picture (excluded from getDisplayMedia capture,
  // Zoom, Meet, Teams — Chrome marks PiP with WDA_EXCLUDEFROMCAPTURE / NSWindow.sharingType=none)
  const pipSupported = typeof window !== 'undefined' && !!window.documentPictureInPicture
  const [pipWindow, setPipWindow] = useState(null)
  const [meetingMode, setMeetingMode] = useState(false)   // "I'm in Zoom/Meet/Teams"
  const [pipPrompted, setPipPrompted] = useState(false)   // shown the PiP nudge once

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function renderHintToPip(pip, { hint: h, hintLoading: loading, question }) {
    pip.document.body.innerHTML = `
      <div style="font-family:system-ui,sans-serif;font-size:13px;color:#e2e8f0;padding:14px;height:100%;box-sizing:border-box;background:#0f0f1a;">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px;color:#a78bfa;">🤖 AI Co-pilot</div>
        <div style="font-size:10px;color:#475569;margin-bottom:10px;">excluded from screen capture</div>
        ${question ? `<div style="color:#94a3b8;font-size:11px;margin-bottom:10px;border-left:2px solid #334155;padding-left:8px;font-style:italic">${escapeHtml(question)}</div>` : ''}
        ${loading ? '<p style="color:#64748b;margin:0">Generating hints…</p>' : h ? `
          ${h.resumeRelevant ? '<span style="background:#14532d;color:#4ade80;border-radius:4px;padding:2px 7px;font-size:11px;margin-bottom:8px;display:inline-block">✓ Resume-relevant</span>' : ''}
          <div style="font-weight:600;margin:8px 0 4px;color:#cbd5e1">Key points:</div>
          <ul style="margin:0 0 10px;padding-left:18px;color:#e2e8f0">${(h.keyPoints || []).map(p => `<li style="margin-bottom:3px">${escapeHtml(p)}</li>`).join('')}</ul>
          ${h.watchOut ? `<div style="color:#f59e0b;font-size:12px">⚠ ${escapeHtml(h.watchOut)}</div>` : ''}
        ` : '<p style="color:#64748b;margin:0">Waiting for next question…</p>'}
      </div>`
  }

  async function openPip() {
    if (!window.documentPictureInPicture) return
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 400, height: 320 })
      pip.document.body.style.cssText = 'margin:0;padding:0;background:#0f0f1a;'
      pip.addEventListener('pagehide', () => { setPipWindow(null); setMeetingMode(false) })
      renderHintToPip(pip, { hint, hintLoading, question: lastHintQuestion.current })
      setPipWindow(pip)
      setPipPrompted(true)
    } catch {}
  }

  async function toggleMeetingMode() {
    if (meetingMode) {
      try { pipWindow?.close() } catch {}
      setPipWindow(null)
      setMeetingMode(false)
    } else {
      setMeetingMode(true)
      if (pipSupported) await openPip()
    }
  }

  // Sync hint content to the PiP window whenever hints update.
  useEffect(() => {
    if (!pipWindow || pipWindow.closed) return
    renderHintToPip(pipWindow, { hint, hintLoading, question: lastHintQuestion.current })
  }, [hint, hintLoading, pipWindow]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close PiP on unmount.
  useEffect(() => () => { try { pipWindow?.close() } catch {} }, [pipWindow])

  // Any screen share in the room (yours or your partner's), e.g. for live coding.
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false })
    .filter(t => t.publication?.track)

  async function toggleShare() {
    const next = !sharing
    try {
      await localParticipant.setScreenShareEnabled(next)   // prompts the OS picker
      setSharing(next)
    } catch {
      setSharing(false)   // user cancelled the share picker
    }
  }

  // Shared transcript over LiveKit's data channel: each client publishes its own
  // finalized speech segments; everyone appends what they receive.
  const { send } = useDataChannel('transcript', msg => {
    try { setTranscript(t => [...t, JSON.parse(new TextDecoder().decode(msg.payload))]) } catch {}
  })

  const speech = useSpeech(text => {
    const seg = { speaker: session.name, role: session.role, text }
    setTranscript(t => [...t, seg])
    try { send(new TextEncoder().encode(JSON.stringify(seg)), { reliable: true }) } catch {}
  })

  const inElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron

  // Notify Electron when candidate enters/leaves the room.
  useEffect(() => {
    if (session.role !== 'candidate' || !inElectron) return
    window.electronAPI.setRoomActive(true)
    return () => window.electronAPI.setRoomActive(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Generate AI hint when a new interviewer segment arrives (candidate only).
  useEffect(() => {
    if (session.role !== 'candidate') return
    const last = [...transcript].reverse().find(s => s.role === 'interviewer')
    if (!last || last.text === lastHintQuestion.current) return
    lastHintQuestion.current = last.text
    setHintLoading(true)
    setHint(null)
    setHintOpen(true)
    // In Electron, notify the protected co-pilot window that we're loading.
    if (inElectron) window.electronAPI.sendHint({ hint: null, hintLoading: true, question: last.text })
    const profile = { name: session.name, targetRole: session.targetRole, resume: session.resume }
    fetch('/api/hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: last.text, profile, provider })
    })
      .then(r => r.json())
      .then(d => {
        setHint(d.hint || null)
        setHintLoading(false)
        if (inElectron) window.electronAPI.sendHint({ hint: d.hint || null, hintLoading: false, question: last.text })
      })
      .catch(() => setHintLoading(false))
  }, [transcript]) // eslint-disable-line react-hooks/exhaustive-deps

  // Start capturing the local mic's speech on join.
  useEffect(() => { if (speech.supported) speech.start(); return () => speech.stop() /* eslint-disable-next-line */ }, [speech.supported])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, speech.interim])

  function shareLink() {
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(session.room)}`
    navigator.clipboard?.writeText(url)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  async function end() {
    setEnding(true)
    speech.stop()
    try {
      const res = await fetch('/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          candidateName: session.role === 'candidate' ? session.name : undefined,
          role: session.role
        })
      })
      const d = await res.json()
      onEnd(d.report || { error: d.error || 'No report returned.' })
    } catch (e) {
      onEnd({ error: e.message })
    }
  }

  return (
    <div className="room-wrap">
      <div className="room-top">
        <h2 style={{ margin: 0 }}>Room {session.room}</h2>
        <span className="meta">· you are <strong>{session.role}</strong></span>
        <span className="spacer" />
        {session.role === 'candidate' && pipSupported && (
          <button
            className={meetingMode ? 'btn' : 'btn-ghost'}
            title="Moves AI hints to a floating window excluded from Zoom/Meet/Teams screen capture (WDA_EXCLUDEFROMCAPTURE)"
            onClick={toggleMeetingMode}
          >
            {meetingMode ? '🛡️ Meeting mode — on' : '🛡️ Meeting mode'}
          </button>
        )}
        <button className={sharing ? 'btn' : 'btn-ghost'} onClick={toggleShare}>{sharing ? '🟢 Sharing — stop' : '🖥️ Share screen'}</button>
        <button className="btn-ghost" onClick={shareLink}>{copied ? '✓ Link copied' : '🔗 Invite link'}</button>
        <button className="btn-danger" onClick={end} disabled={ending}>{ending ? 'Scoring…' : 'End & get feedback'}</button>
      </div>

      {screenTracks.length > 0 && (
        <div className="screenshare">
          {screenTracks.map(tr => (
            <div className="screen-tile" key={tr.publication.trackSid}>
              <VideoTrack trackRef={tr} />
              <div className="screen-label">🖥️ {tr.participant?.name || tr.participant?.identity}{tr.participant?.isLocal ? ' (you)' : ''}</div>
            </div>
          ))}
        </div>
      )}

      <div className="room-grid">
        <div>
          <div className="label">In the room ({participants.length})</div>
          <div className="peers">
            {participants.map(p => (
              <div key={p.identity} className={`peer ${p.isSpeaking ? 'speaking' : ''}`}>
                <span className="dot" />
                <span className="who">{p.name || p.identity}{p.isLocal ? ' (you)' : ''}</span>
              </div>
            ))}
          </div>
          <div className="mic-bar">
            {speech.supported ? (
              speech.active
                ? <><span className="rec-dot" /><span className="meta">Listening — speak naturally</span>
                    <span className="spacer" /><button className="btn-ghost" onClick={speech.stop}>Pause mic text</button></>
                : <><span className="meta">Mic transcription paused</span><span className="spacer" /><button className="btn-ghost" onClick={speech.start}>Resume</button></>
            ) : (
              <span className="meta">⚠ This browser can’t transcribe speech — use Chrome/Edge for the report.</span>
            )}
          </div>
        </div>

        <div>
          {session.role === 'candidate' && !inElectron && pipSupported && !pipPrompted && (hintLoading || hint) && !pipWindow && (
            <div style={{ background: '#1e1b4b', border: '1px solid #4338ca', borderRadius: 10, padding: '10px 14px', marginBottom: 10, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: '#a5b4fc' }}>🛡️ <strong>In Zoom, Meet, or Teams?</strong> Pop hints to a protected window — invisible to all screen capture.</span>
              <button className="btn-ghost" style={{ padding: '3px 10px', fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }} onClick={openPip}>🪟 Pop out now</button>
              <button style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, lineHeight: 1 }} onClick={() => setPipPrompted(true)}>×</button>
            </div>
          )}

          {session.role === 'candidate' && (hintLoading || hint) && (
            inElectron
              ? (
                <div style={{ background: '#0d1117', border: '1px solid #4338ca', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                  🛡️ Hints in <strong>protected Electron window</strong> — invisible to Zoom, Teams, Meet, and all screen capture.
                </div>
              )
              : pipWindow
              ? (
                // PiP is open — hints are in the protected floating window
                <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🛡️ AI hints are in the <strong style={{ color: '#a78bfa' }}>protected floating window</strong> — excluded from screen capture.</span>
                  <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }} onClick={() => { pipWindow.close(); setPipWindow(null) }}>Close</button>
                </div>
              )
              : sharing
                ? (
                  // Screen sharing active and no PiP — hide hints to protect from capture
                  <div style={{ background: '#1c1917', border: '1px solid #57534e', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#78716c', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🔒 AI hints hidden while screen sharing.{pipSupported ? ' Pop out to a protected window:' : ''}</span>
                    {pipSupported && <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={openPip}>🪟 Pop out (protected)</button>}
                  </div>
                )
                : (
                  // Normal in-page panel (not sharing, no PiP)
                  <div style={{ background: 'var(--bg-2, #1e1e2e)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>🤖 AI Co-pilot <span style={{ color: 'var(--text-faint)', fontWeight: 400, fontSize: 12 }}>· only you see this</span></span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {pipSupported && <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} title="Move to a floating window excluded from screen capture" onClick={openPip}>🪟 Pop out</button>}
                        <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setHintOpen(v => !v)}>{hintOpen ? 'Hide' : 'Show'}</button>
                      </div>
                    </div>
                    {hintOpen && (
                      hintLoading
                        ? <p style={{ color: 'var(--text-faint)', fontSize: 13, margin: 0 }}>Generating hints…</p>
                        : hint && (
                          <div style={{ fontSize: 13 }}>
                            {hint.resumeRelevant && (
                              <span style={{ display: 'inline-block', background: '#22c55e22', color: '#4ade80', border: '1px solid #4ade8066', borderRadius: 6, padding: '1px 8px', fontSize: 11, marginBottom: 8 }}>✓ Resume-relevant</span>
                            )}
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>Key points to hit:</div>
                            <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                              {(hint.keyPoints || []).map((pt, i) => <li key={i} style={{ marginBottom: 2 }}>{pt}</li>)}
                            </ul>
                            {hint.watchOut && (
                              <div style={{ color: '#f59e0b', fontSize: 12 }}>⚠ {hint.watchOut}</div>
                            )}
                          </div>
                        )
                    )}
                  </div>
                )
          )}

          <div className="label">Live transcript</div>
          <div className="transcript">
            {transcript.length === 0 && !speech.interim && (
              <p className="meta">Start talking — your words appear here, and your partner sees them too.</p>
            )}
            {transcript.map((s, i) => (
              <div key={i} className={`t-seg ${s.role}`}>
                <div className="t-who">{s.speaker} · {s.role}</div>
                <div>{s.text}</div>
              </div>
            ))}
            {speech.interim && <div className="t-seg"><div className="t-interim">{speech.interim}…</div></div>}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
