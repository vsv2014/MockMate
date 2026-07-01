import React, { useState, useEffect } from 'react'
import { apiFetch } from './lib/apiClient'
import { T } from './auth/tokens'
import { isManaged } from './lib/aiMode'
import { scoreColor } from './lib/ui'

// ── Phase-1 windowed app shell (sidebar + top bar) and the Dashboard/Home screen.
// Matches the product mockup: a real desktop app for everything you do BEFORE/AFTER
// an interview. The Live companion stays a compact overlay (invisible via content
// protection on Win/macOS). Solo/Live launch from here into their existing flows.

const isLinuxUA = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)

const NAV = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'companion', icon: '🎯', label: 'Live Interview' },
  { id: 'solo', icon: '🤖', label: 'Solo Practice' },
  { id: 'jobs', icon: '💼', label: 'Jobs' },
  { id: 'career', icon: '📄', label: 'Resume Studio' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
  { id: 'history', icon: '🕘', label: 'Sessions' },
]

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

// ── Small circular score gauge ──
function ScoreRing({ value, size = 92, label }) {
  const pct = Math.max(0, Math.min(100, value))
  const r = (size - 12) / 2, c = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(pct)} strokeWidth="6"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: size * 0.26, fontWeight: 600, color: T.text1, lineHeight: 1 }}>{Math.round(value)}</div>
          {label && <div style={{ fontSize: 9, color: T.text3, marginTop: 2 }}>{label}</div>}
        </div>
      </div>
    </div>
  )
}

// ── Score-trend sparkline — recent session scores as a small line chart ──
function Sparkline({ sessions }) {
  const scored = sessions.filter(s => typeof s.score === 'number').slice().reverse().slice(-12)  // oldest → newest
  const n = scored.length
  const W = 280, H = 96, padX = 8, padTop = 12, padBot = 18
  const xAt = i => padX + (n === 1 ? (W - 2 * padX) / 2 : i * (W - 2 * padX) / (n - 1))
  const yAt = v => padTop + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - padTop - padBot)
  const pts = scored.map((s, i) => ({ x: xAt(i), y: yAt(s.score), s }))
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const latest = scored[n - 1].score
  const avg = Math.round(scored.reduce((a, s) => a + s.score, 0) / n)
  const delta = latest - scored[0].score
  const fmt = ts => { try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '' } }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 24, fontWeight: 600, color: scoreColor(latest) }}>{(latest / 10).toFixed(1)}</span>
        <span style={{ fontSize: 11, color: T.text3 }}>latest · avg {(avg / 10).toFixed(1)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: delta >= 0 ? T.success : '#f87171' }}>{delta >= 0 ? '▲' : '▼'} {(Math.abs(delta) / 10).toFixed(1)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[75, 50].map(g => <line key={g} x1={padX} x2={W - padX} y1={yAt(g)} y2={yAt(g)} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />)}
        <path d={line} fill="none" stroke={T.accentFrom} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill={scoreColor(p.s.score)} stroke={T.bg} strokeWidth="1.5">
            <title>{`${(p.s.score / 10).toFixed(1)}/10 · ${fmt(p.s.ts)}`}</title>
          </circle>
        ))}
        <text x={padX} y={H - 4} fontSize="8" fill={T.text3}>{fmt(scored[0].ts)}</text>
        <text x={W - padX} y={H - 4} fontSize="8" fill={T.text3} textAnchor="end">{fmt(scored[n - 1].ts)}</text>
      </svg>
    </div>
  )
}

// ── The app shell — top bar + left sidebar + content ──
export function AppShell({ active, onNav, auth, meetingActive, stealth, onStealth, onMinimize, onClose, children }) {
  const name = (auth?.user?.name || auth?.user?.email || '?')
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?'
  return (
    <div className="mm-shell" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: T.bg, color: T.text1, fontFamily: T.font, overflow: 'hidden' }}>
      <style>{`
        .mm-shell *{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.16) transparent}
        .mm-shell ::-webkit-scrollbar{width:8px;height:8px}
        .mm-shell ::-webkit-scrollbar-track{background:transparent}
        .mm-shell ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:4px}
        .mm-shell ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.26)}
        .mm-shell ::-webkit-scrollbar-corner{background:transparent}
      `}</style>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0, background: T.surface1 }}>
        <img src="/icon.png" alt="" width={26} height={26} style={{ borderRadius: 7, display: 'block' }} />
        <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '0.2px' }}>MockMate</span>
        <div style={{ marginLeft: 14, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: isLinuxUA ? '#fdba74' : T.success, background: isLinuxUA ? 'rgba(249,115,22,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${isLinuxUA ? 'rgba(249,115,22,0.3)' : 'rgba(34,197,94,0.3)'}`, padding: '3px 9px', borderRadius: 999 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isLinuxUA ? '#fdba74' : T.success }} />
          {isLinuxUA ? 'Stealth limited (Linux)' : 'Stealth Mode active'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <TopBtn title="Dim / hide (Alt+H)" onClick={onStealth}>◐</TopBtn>
          <TopBtn title="Minimize" onClick={onMinimize}>—</TopBtn>
          <TopBtn title="Close" onClick={onClose} danger>✕</TopBtn>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 216, flexShrink: 0, borderRight: `1px solid ${T.border}`, background: T.surface1, display: 'flex', flexDirection: 'column', padding: '12px 10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {NAV.map(n => {
              const on = active === n.id
              return (
                <button key={n.id} onClick={() => onNav(n.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: T.rCtrl,
                    background: on ? 'rgba(20,184,166,0.16)' : 'transparent',
                    border: `1px solid ${on ? 'rgba(20,184,166,0.4)' : 'transparent'}`,
                    color: on ? T.text1 : T.text2, cursor: 'pointer', fontFamily: T.font, fontSize: 13, fontWeight: on ? 600 : 400,
                    textAlign: 'left', width: '100%',
                  }}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{n.icon}</span>
                  <span style={{ flex: 1 }}>{n.label}</span>
                  {n.id === 'companion' && meetingActive && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />}
                </button>
              )
            })}
          </div>
          <div style={{ marginTop: 'auto' }}>
            <button onClick={() => onNav('account')}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', width: '100%', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font, textAlign: 'left' }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: T.accent, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initials}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: T.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{auth?.user?.name || auth?.user?.email || 'Account'}</span>
                <span style={{ display: 'block', fontSize: 10, color: T.text3 }}>{auth?.plan === 'pro' ? 'Pro plan' : 'Free plan'}</span>
              </span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '22px 26px' }}>{children}</div>
      </div>
      <UpdateToast />
    </div>
  )
}

// ── Auto-update toast — shows download progress + restart-to-install. Rendered inside
// the workspace shell only, so it never appears during a live interview (stealth). ──
export function UpdateToast() {
  const [u, setU] = useState(null)          // { state, version, percent, transferred, total }
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
  useEffect(() => {
    const off = window.electronAPI?.onUpdateStatus?.(d => { setU(d); setDismissed(false) })
    return () => off?.()
  }, [])
  if (!u || dismissed) return null
  const ready = u.state === 'ready'
  const mb = b => (Number(b || 0) / 1e6).toFixed(1)
  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, width: 340, zIndex: 100000, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, boxShadow: '0 16px 48px rgba(0,0,0,0.55)', padding: '14px 16px', fontFamily: T.font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 15 }}>⬇️</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text1 }}>
          {ready ? 'Update ready to install' : `Downloading update${u.version && u.version !== 'demo' ? ` v${u.version}` : ''}`}
        </span>
        <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>
      {!ready && (
        <>
          <div style={{ fontSize: 11.5, color: T.text2, margin: '8px 0 7px' }}>
            {u.percent != null ? `${u.percent}%` : '…'}{u.total ? ` (${mb(u.transferred)}MB of ${mb(u.total)}MB)` : ''}
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${u.percent || 4}%`, background: T.accent, borderRadius: 3, transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 10.5, color: T.text3, marginTop: 8 }}>Continues in the background — installs on next quit if you wait.</div>
        </>
      )}
      {ready && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => { setInstalling(true); window.electronAPI?.installUpdate?.() }} disabled={installing}
            style={{ flex: 1, height: 36, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
            {installing ? 'Restarting…' : 'Restart & install'}
          </button>
          <button onClick={() => setDismissed(true)}
            style={{ height: 36, padding: '0 14px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 12.5, cursor: 'pointer', fontFamily: T.font }}>Later</button>
        </div>
      )}
    </div>
  )
}

function TopBtn({ children, onClick, title, danger }) {
  const [h, setH] = useState(false)
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 7, cursor: 'pointer',
        background: h ? (danger ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)') : 'transparent',
        color: danger && h ? '#f87171' : T.text2, fontSize: 13 }}>{children}</button>
  )
}

// ── Dashboard / Home content ──
export function DashboardHome({ auth, sessions = [], noProviders, onNav, onCapture }) {
  const name = (auth?.user?.name || '').split(' ')[0] || ''
  const scored = sessions.filter(s => typeof s.score === 'number')
  const avg = scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : null

  const ACTIONS = [
    { id: 'companion', icon: '🎯', title: 'Live Interview', desc: 'Real-time AI help during interviews', cta: 'Start Live', accent: '#ef4444' },
    { id: 'solo', icon: '🤖', title: 'Solo Practice', desc: 'Practice with an AI interviewer', cta: 'Start Practice', accent: T.accentFrom },
    { id: 'jobs', icon: '💼', title: 'Job Matching', desc: 'Find roles that match your profile', cta: 'Find Jobs', accent: '#22c55e' },
    { id: 'career', icon: '📄', title: 'Resume Studio', desc: 'Improve resume & career tools', cta: 'Open Tools', accent: '#eab308' },
  ]

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Greeting */}
      <div>
        <div style={{ fontSize: 22, fontWeight: 600, color: T.text1 }}>{greeting()}{name ? `, ${name}` : ''}! 👋</div>
        <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>What would you like to do today?</div>
      </div>

      {isManaged() ? (
        <div style={{ background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)', borderRadius: T.rCard, padding: '10px 14px', fontSize: 12.5, color: T.success, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>✓</span><span><strong>MockMate AI ready</strong> — models are managed for you. Just start an interview.</span>
        </div>
      ) : noProviders && (
        <div onClick={() => onNav('settings')}
          style={{ background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.35)', borderRadius: T.rCard, padding: '11px 14px', fontSize: 12.5, color: '#5eead4', cursor: 'pointer' }}>
          ⚠ <strong>No AI key connected yet</strong> — click to add one, or switch to MockMate AI in Settings.
        </div>
      )}

      {/* Action cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        {ACTIONS.map(a => (
          <ActionCard key={a.id} {...a} onClick={() => onNav(a.id)} />
        ))}
      </div>

      {/* Two-column: recent + insights */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {/* Recent sessions */}
        <Panel title="Recent Sessions" action={sessions.length ? { label: 'View all', onClick: () => onNav('history') } : null}>
          {sessions.length === 0
            ? <Empty>No sessions yet. Finish a Solo practice and it'll show here.</Empty>
            : sessions.slice(0, 3).map(s => (
              <div key={s.id} onClick={() => onNav('history')} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 4px', cursor: 'pointer', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: T.surface2, display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0 }}>📄</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: T.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label || 'Practice session'}</div>
                  <div style={{ fontSize: 10.5, color: T.text3 }}>{new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{s.transcript ? ` · ${s.transcript.length} msgs` : ''}</div>
                </div>
                {typeof s.score === 'number' && <span style={{ fontSize: 12, fontWeight: 600, color: scoreColor(s.score) }}>{(s.score / 10).toFixed(1)}<span style={{ color: T.text3, fontWeight: 400 }}>/10</span></span>}
              </div>
            ))}
        </Panel>

        {/* Performance — score trend */}
        <Panel title="Performance Overview">
          {scored.length < 2
            ? <Empty>Complete a couple of practice interviews to see your score trend.</Empty>
            : <Sparkline sessions={sessions} />}
        </Panel>

        {/* System status — makes "managed AI" visible & reassuring */}
        <SystemStatus />
      </div>

      {/* Reassurance strip — reinforces the managed model (subtle, no clutter) */}
      {isManaged() && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '12px 16px' }}>
          <span style={{ fontSize: 16 }}>✨</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>You're using MockMate AI</div>
            <div style={{ fontSize: 11.5, color: T.text2, marginTop: 1 }}>We automatically pick the best model for each part of your interview — with instant failover. Nothing to set up.</div>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <QuickAction onClick={onCapture}>📸 Screenshot + solve</QuickAction>
        <QuickAction onClick={() => onNav('history')}>📚 Transcripts</QuickAction>
        <QuickAction onClick={() => onNav('settings')}>⚙️ Settings</QuickAction>
      </div>
    </div>
  )
}

function ActionCard({ icon, title, desc, cta, accent, onClick }) {
  const [h, setH] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: T.surface1, border: `1px solid ${h ? accent : T.border}`, borderRadius: T.rCard, padding: '16px', cursor: 'pointer', transition: 'border-color .14s, transform .14s', transform: h ? 'translateY(-2px)' : 'none' }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: 17, background: `${accent}22`, border: `1px solid ${accent}44`, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: T.text1 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: T.text2, marginTop: 3, lineHeight: 1.4, minHeight: 32 }}>{desc}</div>
      <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: accent }}>{cta} →</div>
    </div>
  )
}

function Panel({ title, action, children }) {
  return (
    <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text1 }}>{title}</span>
        {action && <button onClick={action.onClick} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: T.accentFrom, fontSize: 11.5, cursor: 'pointer', fontFamily: T.font }}>{action.label}</button>}
      </div>
      {children}
    </div>
  )
}

function Empty({ children }) {
  return <div style={{ fontSize: 12, color: T.text3, lineHeight: 1.6, padding: '10px 2px' }}>{children}</div>
}

// ── Past Sessions table (Workspace) ──
export function SessionsTable({ sessions = [], onOpen, onDelete }) {
  if (!sessions.length) {
    return (
      <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '40px 24px', textAlign: 'center', color: T.text3, fontSize: 13, lineHeight: 1.6 }}>
        No sessions yet. Finish a <span style={{ color: T.text2 }}>Solo Practice</span> and it'll be saved here — transcript + feedback, kept ~3 months on this machine.
      </div>
    )
  }
  const cols = '1.8fr 0.9fr 70px 70px 84px'
  const cell = { padding: '12px 14px', fontSize: 12.5, color: T.text2, display: 'flex', alignItems: 'center' }
  return (
    <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, background: T.surface2, borderBottom: `1px solid ${T.border}` }}>
        {['Session', 'Date', 'Score', 'Msgs', ''].map((h, i) => (
          <div key={i} style={{ ...cell, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', color: T.text3, textTransform: 'uppercase' }}>{h}</div>
        ))}
      </div>
      {sessions.map((s, i) => (
        <div key={s.id} style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: i < sessions.length - 1 ? `1px solid ${T.border}` : 'none', cursor: 'pointer' }}
          onClick={() => onOpen(s)}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <div style={{ ...cell, flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 0 }}>
            <span style={{ color: T.text1, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{s.label || 'Interview'}</span>
            {s.verdict && <span style={{ fontSize: 11, color: T.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{s.verdict}</span>}
          </div>
          <div style={cell}>{new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div style={cell}>{typeof s.score === 'number' ? <span style={{ color: scoreColor(s.score), fontWeight: 600 }}>{(s.score / 10).toFixed(1)}</span> : <span style={{ color: T.text3 }}>—</span>}</div>
          <div style={cell}>{s.transcript?.length || 0}</div>
          <div style={{ ...cell, gap: 4 }}>
            <button onClick={e => { e.stopPropagation(); onOpen(s) }} title="View" style={iconBtn}>👁</button>
            <button onClick={e => { e.stopPropagation(); onDelete(s.id) }} title="Delete" style={iconBtn}>🗑</button>
          </div>
        </div>
      ))}
    </div>
  )
}
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, opacity: 0.6, padding: 2 }

// ── System status — turns the abstract "managed AI" into visible confidence ──
function StatusRow({ label, value, ok, warn }) {
  const color = warn ? '#fbbf24' : ok ? T.success : T.text3
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: ok && !warn ? `0 0 6px ${color}` : 'none' }} />
      <span style={{ color: T.text2, flex: 1 }}>{label}</span>
      <span style={{ color, fontWeight: 500, fontSize: 11.5 }}>{value}</span>
    </div>
  )
}
function SystemStatus() {
  const [d, setD] = useState(null)
  useEffect(() => { apiFetch('/api/providers').then(r => r.json()).then(setD).catch(() => setD({})) }, [])
  const managed = isManaged()
  const providers = d?.providers || []
  const ready = managed || providers.length > 0
  const dg = !!d?.deepgram
  const linux = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)
  const failover = managed || providers.length >= 2
  return (
    <Panel title="System Status">
      <StatusRow label="AI service" ok={ready} warn={!ready} value={ready ? 'Operational' : 'No key'} />
      <StatusRow label="Voice" ok={dg || managed} warn={!dg && !managed} value={dg ? 'Connected' : managed ? 'Managed' : 'Off'} />
      <StatusRow label="Stealth" ok={!linux} warn={linux} value={linux ? 'Limited (Linux)' : 'Active'} />
      <StatusRow label="Failover" ok={failover} warn={!failover} value={failover ? 'Ready' : 'Single provider'} />
      <div style={{ fontSize: 10.5, color: T.text3, marginTop: 8 }}>{ready ? 'All systems go — just start an interview.' : 'Add a key or switch to MockMate AI in Settings.'}</div>
    </Panel>
  )
}

function QuickAction({ children, onClick }) {
  const [h, setH] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 13px', background: h ? T.surface2 : T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, color: T.text2, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: T.font }}>{children}</button>
  )
}
