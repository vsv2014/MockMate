import React, { useEffect, useState, useRef } from 'react'
import {
  LiveKitRoom, RoomAudioRenderer, useParticipants, useDataChannel,
  useLocalParticipant, useTracks, VideoTrack
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import '@livekit/components-styles'
import { useSpeech } from './useSpeech'
import { apiFetch } from './lib/apiClient'   // routes to managed (:4000 + JWT) or BYOK (:3002)
import { T } from './auth/tokens'

// ── Token-based styles (replaces the legacy styles.css classes this used to depend on) ──
const btnGhost = { background: 'transparent', border: `1px solid ${T.borderStrong}`, color: T.text1, padding: '8px 14px', borderRadius: T.rCtrl, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }
const btnPrimary = { ...btnGhost, background: T.accent, border: 'none', color: '#fff' }
const btnDanger = { ...btnGhost, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#ff8b8b' }
const metaStyle = { color: T.text2, fontSize: 13 }
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: T.text2, marginBottom: 6 }
const smallGhost = { ...btnGhost, padding: '2px 8px', fontSize: 11 }

export default function Room({ session, onEnd, onLeave }) {
  const [conn, setConn] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    apiFetch('/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: session.room, identity: session.identity, name: session.name })
    })
      .then(r => r.json())
      .then(d => d.error ? setErr(d.error) : setConn(d))
      .catch(e => setErr(e.message))
  }, [])

  const narrow = { maxWidth: 720, margin: '0 auto', padding: '40px 24px', fontFamily: T.font, color: T.text1 }
  if (err) return (
    <div style={narrow}>
      <div style={{ display: 'flex', gap: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: '#f5c66b', padding: '12px 16px', borderRadius: 10, marginBottom: 18, fontSize: 13 }}>
        <span>⚠</span><span>{err}</span>
      </div>
      <button style={btnGhost} onClick={onLeave}>← Back</button>
    </div>
  )
  if (!conn) return <div style={narrow}><p style={{ color: T.text2 }}>Connecting to room <strong style={{ color: T.text1 }}>{session.room}</strong>…</p></div>

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
    window.electronAPI.setRoomActive?.(true)
    return () => window.electronAPI.setRoomActive?.(false)
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
    if (inElectron) window.electronAPI.sendHint?.({ hint: null, hintLoading: true, question: last.text })
    const profile = { name: session.name, targetRole: session.targetRole, resume: session.resume }
    apiFetch('/api/hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: last.text, profile, provider })
    })
      .then(r => r.json())
      .then(d => {
        setHint(d.hint || null)
        setHintLoading(false)
        if (inElectron) window.electronAPI.sendHint?.({ hint: d.hint || null, hintLoading: false, question: last.text })
      })
      .catch(() => setHintLoading(false))
  }, [transcript]) // eslint-disable-line react-hooks/exhaustive-deps

  // Start capturing the local mic's speech on join.
  useEffect(() => { if (speech.supported) speech.start(); return () => speech.stop() /* eslint-disable-next-line */ }, [speech.supported])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript, speech.interim])

  // Share the ROOM CODE, not a URL: the app is served from localhost/file in the desktop build, so a
  // URL is useless to a remote partner. They open MockMate → Duo → enter this code to join. We REVEAL
  // the code in the button (so it's shareable even if the clipboard API is unavailable) and copy
  // best-effort on top — never claim a silent clipboard success that didn't happen.
  function shareLink() {
    try { navigator.clipboard?.writeText?.(session.room)?.catch?.(() => {}) } catch {}
    setCopied(true); setTimeout(() => setCopied(false), 2500)
  }

  async function end() {
    setEnding(true)
    speech.stop()
    try {
      const res = await apiFetch('/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          candidateName: session.role === 'candidate' ? session.name : undefined,
          role: session.role
        })
      })
      const d = await res.json()
      onEnd(d.report || { error: d.error || 'No report returned.' }, transcript)
    } catch (e) {
      onEnd({ error: e.message }, transcript)
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 24px', fontFamily: T.font, color: T.text1 }}>
      <style>{`@keyframes mm-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 650, color: T.text1 }}>Room {session.room}</h2>
        <span style={metaStyle}>· you are <strong style={{ color: T.text1 }}>{session.role}</strong></span>
        <span style={{ flex: 1 }} />
        {session.role === 'candidate' && pipSupported && (
          <button
            style={meetingMode ? btnPrimary : btnGhost}
            title="Moves AI hints to a floating window excluded from Zoom/Meet/Teams screen capture (WDA_EXCLUDEFROMCAPTURE)"
            onClick={toggleMeetingMode}
          >
            {meetingMode ? '🛡️ Meeting mode — on' : '🛡️ Meeting mode'}
          </button>
        )}
        <button style={sharing ? btnPrimary : btnGhost} onClick={toggleShare}>{sharing ? '🟢 Sharing — stop' : '🖥️ Share screen'}</button>
        <button style={btnGhost} onClick={shareLink} title={`Room code ${session.room} — your partner enters it in MockMate → Duo to join (copied to clipboard)`}>{copied ? `📋 Code: ${session.room}` : `🔗 Share room code`}</button>
        <button style={{ ...btnDanger, opacity: ending ? 0.5 : 1 }} onClick={end} disabled={ending}>{ending ? 'Scoring…' : 'End & get feedback'}</button>
      </div>

      {screenTracks.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          {screenTracks.map(tr => (
            <div style={{ position: 'relative', border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden', maxWidth: '100%' }} key={tr.publication.trackSid}>
              <VideoTrack trackRef={tr} />
              <div style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 6px', borderRadius: 6 }}>🖥️ {tr.participant?.name || tr.participant?.identity}{tr.participant?.isLocal ? ' (you)' : ''}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={labelStyle}>In the room ({participants.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {participants.map(p => (
              <div key={p.identity} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: `1px solid ${p.isSpeaking ? T.success : T.border}`, borderRadius: 10, background: T.surface1 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.isSpeaking ? T.success : T.text3, boxShadow: p.isSpeaking ? '0 0 0 4px rgba(34,197,94,0.13)' : 'none' }} />
                <span style={{ fontWeight: 600 }}>{p.name || p.identity}{p.isLocal ? ' (you)' : ''}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            {speech.supported ? (
              speech.active
                ? <><span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff5b5b', animation: 'mm-pulse 1.2s infinite' }} /><span style={metaStyle}>Listening — speak naturally</span>
                    <span style={{ flex: 1 }} /><button style={btnGhost} onClick={speech.stop}>Pause mic text</button></>
                : <><span style={metaStyle}>Mic transcription paused</span><span style={{ flex: 1 }} /><button style={btnGhost} onClick={speech.start}>Resume</button></>
            ) : (
              <span style={metaStyle}>⚠ This browser can’t transcribe speech — use Chrome/Edge for the report.</span>
            )}
          </div>
        </div>

        <div>
          {session.role === 'candidate' && !inElectron && pipSupported && !pipPrompted && (hintLoading || hint) && !pipWindow && (
            <div style={{ background: '#1e1b4b', border: '1px solid #4338ca', borderRadius: 10, padding: '10px 14px', marginBottom: 10, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: '#a5b4fc' }}>🛡️ <strong>In Zoom, Meet, or Teams?</strong> Pop hints to a protected window — invisible to all screen capture.</span>
              <button style={{ ...smallGhost, marginLeft: 'auto', whiteSpace: 'nowrap' }} onClick={openPip}>🪟 Pop out now</button>
              <button style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 16, lineHeight: 1 }} onClick={() => setPipPrompted(true)}>×</button>
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
                <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: T.text3, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🛡️ AI hints are in the <strong style={{ color: '#a78bfa' }}>protected floating window</strong> — excluded from screen capture.</span>
                  <button style={{ ...smallGhost, marginLeft: 'auto' }} onClick={() => { pipWindow.close(); setPipWindow(null) }}>Close</button>
                </div>
              )
              : sharing
                ? (
                  // Screen sharing active and no PiP — hide hints to protect from capture
                  <div style={{ background: '#1c1917', border: '1px solid #57534e', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#78716c', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🔒 AI hints hidden while screen sharing.{pipSupported ? ' Pop out to a protected window:' : ''}</span>
                    {pipSupported && <button style={smallGhost} onClick={openPip}>🪟 Pop out (protected)</button>}
                  </div>
                )
                : (
                  // Normal in-page panel (not sharing, no PiP)
                  <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>🤖 AI Co-pilot <span style={{ color: T.text3, fontWeight: 400, fontSize: 12 }}>· only you see this</span></span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {pipSupported && <button style={smallGhost} title="Move to a floating window excluded from screen capture" onClick={openPip}>🪟 Pop out</button>}
                        <button style={smallGhost} onClick={() => setHintOpen(v => !v)}>{hintOpen ? 'Hide' : 'Show'}</button>
                      </div>
                    </div>
                    {hintOpen && (
                      hintLoading
                        ? <p style={{ color: T.text3, fontSize: 13, margin: 0 }}>Generating hints…</p>
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

          <div style={labelStyle}>Live transcript</div>
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, background: T.surface1, padding: 14, height: 420, overflowY: 'auto' }}>
            {transcript.length === 0 && !speech.interim && (
              <p style={metaStyle}>Start talking — your words appear here, and your partner sees them too.</p>
            )}
            {transcript.map((s, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: s.role === 'candidate' ? '#7fb0ff' : s.role === 'interviewer' ? '#f5c66b' : T.text3 }}>{s.speaker} · {s.role}</div>
                <div>{s.text}</div>
              </div>
            ))}
            {speech.interim && <div style={{ marginBottom: 12 }}><div style={{ color: T.text3, fontStyle: 'italic' }}>{speech.interim}…</div></div>}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
