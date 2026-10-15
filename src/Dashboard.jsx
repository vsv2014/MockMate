import React, { useState, useEffect } from 'react'
import WindowResizeHandles from './WindowResizeHandles'
import { apiFetch } from './lib/apiClient'
import { T } from './auth/tokens'
import { isManaged } from './lib/aiMode'
import { scoreColor } from './lib/ui'
import { configuredProviderNames } from './lib/modelPicker'

// ── Phase-1 windowed app shell (sidebar + top bar) and the Dashboard/Home screen.
// Matches the product mockup: a real desktop app for everything you do BEFORE/AFTER
// an interview. The Live companion stays a compact overlay (invisible via content
// protection on Win/macOS). Solo/Live launch from here into their existing flows.

const isLinuxUA = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)

const NAV = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'kits', icon: '▤', label: 'Interview Kits' },
  { id: 'ready-room', icon: '🎯', label: 'Ready Room' },
  { id: 'solo', icon: '🤖', label: 'Solo Practice' },
  { id: 'duo', icon: '👥', label: 'Duo (Beta)' },
  { id: 'jobs', icon: '💼', label: 'Jobs' },
  { id: 'career', icon: '📄', label: 'Resume Studio' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
  { id: 'history', icon: '🕘', label: 'Sessions' },
]

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

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
export function AppShell({ active, onNav, auth, meetingActive, stealth, onStealth, onMinimize, onClose, children, minimized = false }) {
  const name = (auth?.user?.name || auth?.user?.email || '?')
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?'
  // After login: left nav can hide/show (persisted). Collapsed = icon rail; hidden = gone.
  const [sidebarMode, setSidebarMode] = useState(() => {
    try {
      const v = localStorage.getItem('mm-sidebar')
      if (v === 'hidden' || v === 'icons' || v === 'full') return v
    } catch {}
    return 'full'
  })
  function cycleSidebar() {
    setSidebarMode(m => {
      const next = m === 'full' ? 'icons' : m === 'icons' ? 'hidden' : 'full'
      try { localStorage.setItem('mm-sidebar', next) } catch {}
      return next
    })
  }
  const [compactViewport, setCompactViewport] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 700px)').matches)
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 700px)')
    if (!query) return
    const changed = () => setCompactViewport(query.matches)
    changed()
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  const sidebarHidden = sidebarMode === 'hidden'
  const sidebarIcons = compactViewport || sidebarMode === 'icons'
  const sidebarW = sidebarHidden ? 0 : sidebarIcons ? 64 : 216

  return (
    <div className="mm-shell" data-mm-surface="opaque" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', minHeight: 0, minWidth: 0, background: T.bg, color: T.text1, fontFamily: T.font, overflow: 'hidden' }}>
      <style>{`
        .mm-shell *{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.16) transparent}
        .mm-shell ::-webkit-scrollbar{width:8px;height:8px}
        .mm-shell ::-webkit-scrollbar-track{background:transparent}
        .mm-shell ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.14);border-radius:4px}
        .mm-shell ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.26)}
        .mm-shell ::-webkit-scrollbar-corner{background:transparent}
      `}</style>

      {/* Top bar */}
      <div className="mm-drag" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${T.border}`, flexShrink: 0, background: T.surface1 }}>
        <TopBtn
          title={sidebarMode === 'full' ? 'Collapse sidebar to icons' : sidebarMode === 'icons' ? 'Hide sidebar' : 'Show sidebar'}
          onClick={cycleSidebar}
        >{sidebarHidden ? '☰' : '◂'}</TopBtn>
        <img src="/icon.png" alt="" width={26} height={26} style={{ borderRadius: 7, display: 'block' }} />
        <span style={{ fontWeight: 600, fontSize: 14.5, letterSpacing: '0.2px', fontFamily: T.fontDisplay }}>MockMate</span>
        <button type="button" onClick={!isLinuxUA ? onStealth : undefined}
          title={isLinuxUA ? 'Overlay stealth is not supported on Linux' : `${stealth ? 'Stealth ON' : 'Stealth OFF'} — capture protection ${stealth ? 'enabled' : 'disabled'}. Always verify in your meeting share preview.`}
          style={{ marginLeft: 14, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: isLinuxUA ? 'default' : 'pointer', color: isLinuxUA ? '#fdba74' : stealth ? '#5eead4' : T.text3, background: isLinuxUA ? 'rgba(249,115,22,0.1)' : stealth ? 'rgba(13,148,136,0.16)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isLinuxUA ? 'rgba(249,115,22,0.3)' : stealth ? 'rgba(45,212,191,0.4)' : T.border}`, padding: '3px 9px', borderRadius: 999 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isLinuxUA ? '#fdba74' : stealth ? '#2dd4bf' : '#64748b' }} />
          {isLinuxUA ? 'Stealth unavailable (Linux)' : stealth ? 'Stealth ON · Verify preview' : 'Stealth OFF'}
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <TopBtn title="Collapse to pill — click pill to restore" onClick={onMinimize}>—</TopBtn>
          <TopBtn title="Close" onClick={onClose} danger>✕</TopBtn>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar — full labels → icon rail → hidden (cycle via top-bar ☰ / ◂) */}
        {!sidebarHidden && (
          <div style={{
            width: sidebarW, flexShrink: 0, borderRight: `1px solid ${T.border}`, background: T.surface1,
            display: 'flex', flexDirection: 'column', padding: sidebarIcons ? '12px 8px' : '12px 10px',
            transition: 'width 0.15s ease', minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {NAV.map(n => {
                const on = active === n.id
                return (
                  <button key={n.id} type="button" onClick={() => onNav(n.id)}
                    title={sidebarIcons ? n.label : undefined}
                    aria-label={n.label}
                    style={{
                      position: 'relative',
                      display: 'flex', alignItems: 'center', gap: sidebarIcons ? 0 : 11,
                      justifyContent: sidebarIcons ? 'center' : 'flex-start',
                      padding: sidebarIcons ? '10px 0' : '9px 11px', borderRadius: T.rCtrl,
                      background: on ? 'rgba(20,184,166,0.16)' : 'transparent',
                      border: `1px solid ${on ? 'rgba(20,184,166,0.4)' : 'transparent'}`,
                      color: on ? T.text1 : T.text2, cursor: 'pointer', fontFamily: T.font, fontSize: 13, fontWeight: on ? 600 : 400,
                      textAlign: 'left', width: '100%',
                    }}>
                    <span style={{ fontSize: 15, width: sidebarIcons ? 'auto' : 18, textAlign: 'center' }}>{n.icon}</span>
                    {!sidebarIcons && <span style={{ flex: 1 }}>{n.label}</span>}
                    {!sidebarIcons && n.id === 'ready-room' && meetingActive && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />}
                    {sidebarIcons && n.id === 'ready-room' && meetingActive && (
                      <span style={{ position: 'absolute', top: 8, right: 10, width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                    )}
                  </button>
                )
              })}
            </div>
            <div style={{ marginTop: 'auto' }}>
              <button type="button" onClick={() => onNav('account')} data-pi-target="nav_account"
                title={sidebarIcons ? (auth?.user?.name || auth?.user?.email || 'Account') : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: sidebarIcons ? 0 : 10,
                  justifyContent: sidebarIcons ? 'center' : 'flex-start',
                  padding: sidebarIcons ? '8px 0' : '9px 10px', width: '100%', background: 'transparent',
                  border: `1px solid ${T.border}`, borderRadius: T.rCtrl, cursor: 'pointer', fontFamily: T.font, textAlign: 'left',
                }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: T.accent, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initials}</span>
                {!sidebarIcons && (
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: T.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{auth?.user?.name || auth?.user?.email || 'Account'}</span>
                    <span style={{ display: 'block', fontSize: 10, color: T.text3 }}>{auth?.guest ? 'Guest' : auth?.plan === 'max' ? 'Max plan' : auth?.plan === 'pro' ? 'Pro plan' : 'Free plan'}</span>
                  </span>
                )}
              </button>
              {!sidebarIcons && (
                <div style={{ textAlign: 'center', fontSize: 10, color: T.text3, marginTop: 8 }}>
                  MockMate v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <main className="mm-shell-content mm-nodrag" tabIndex={0} aria-label="Page content" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', scrollbarGutter: 'stable', overscrollBehavior: 'contain', padding: 'clamp(12px, 3vw, 22px) clamp(12px, 3vw, 26px)', overflowWrap: 'anywhere' }}>{children}</main>
      </div>
      <WindowResizeHandles disabled={minimized} />
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
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    const off = window.electronAPI?.onUpdateStatus?.(d => { setU(d); setDismissed(false); setActionError(''); setInstalling(false) })
    return () => off?.()
  }, [])
  async function runUpdateAction(action, fallback) {
    setActionError('')
    try {
      const result = await action?.()
      if (result?.ok === false) throw new Error(result.error || fallback)
    } catch (error) {
      setActionError(error?.message || fallback)
      setInstalling(false)
    }
  }
  if (!u || dismissed) return null
  const ready = u.state === 'ready'
  const failed = u.state === 'error'
  const checking = u.state === 'checking'
  const current = u.state === 'current'
  const RELEASES = 'https://github.com/vsv2014/MockMate/releases/latest'
  const mb = b => (Number(b || 0) / 1e6).toFixed(1)
  const percent = u.percent != null && Number.isFinite(Number(u.percent)) ? Math.max(0, Math.min(100, Number(u.percent))) : null
  return (
    <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'} aria-atomic="true" aria-label="MockMate update status" style={{ position: 'fixed', right: 20, bottom: 20, width: 340, zIndex: 100000, background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, boxShadow: '0 16px 48px rgba(0,0,0,0.55)', padding: '14px 16px', fontFamily: T.font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 15 }}>⬇️</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text1 }}>
          {failed
            ? (u.scope === 'check' ? 'Couldn’t check for updates' : 'Couldn’t download update')
            : checking ? 'Checking for updates…'
            : current ? 'MockMate is up to date'
            : ready ? 'Update ready to install'
            : `Downloading update${u.version && u.version !== 'demo' ? ` v${u.version}` : ''}`}
        </span>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss update notification" style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>
      {actionError && <div role="alert" aria-live="assertive" style={{ fontSize: 11.5, color: '#fca5a5', marginTop: 8 }}>{actionError}</div>}
      {!ready && !failed && !checking && !current && (
        <>
          <div style={{ fontSize: 11.5, color: T.text2, margin: '8px 0 7px' }}>
            {percent != null ? `${percent}%` : 'Downloading…'}{u.total ? ` (${mb(u.transferred)}MB of ${mb(u.total)}MB)` : ''}
          </div>
          <div role="progressbar" aria-label="Update download progress" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={percent == null ? undefined : percent} aria-valuetext={percent == null ? 'Download in progress' : `${percent}% downloaded`}
            style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div aria-hidden="true" style={{ height: '100%', width: `${percent == null ? 4 : percent}%`, background: T.accent, borderRadius: 3, transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 10.5, color: T.text3, marginTop: 8 }}>Continues downloading in the background. MockMate installs only when you choose Restart & install.</div>
        </>
      )}
      {checking && <div style={{ fontSize: 11.5, color: T.text2, marginTop: 8 }}>Contacting GitHub Releases…</div>}
      {current && <div style={{ fontSize: 11.5, color: T.text2, marginTop: 8 }}>Installed version v{u.version || 'current'} is the latest published release.</div>}
      {failed && (
        <>
          <div style={{ fontSize: 11.5, color: T.text2, margin: '8px 0 10px' }}>
            {u.scope === 'check'
              ? 'MockMate could not contact GitHub Releases. Check your internet connection and try again.'
              : 'Auto-update didn’t complete. Retry, or download and reinstall the latest version manually.'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => runUpdateAction(
              () => u.scope === 'check' ? window.electronAPI?.checkForUpdates?.() : window.electronAPI?.downloadUpdate?.(),
              u.scope === 'check' ? 'Could not retry the update check.' : 'Could not retry the update download.',
            )}
              style={{ flex: 1, height: 36, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
              {u.scope === 'check' ? 'Retry check' : 'Retry download'}
            </button>
            <button type="button" onClick={() => runUpdateAction(() => window.electronAPI?.openExternal?.(RELEASES), 'Could not open the releases page.')}
              style={{ height: 36, padding: '0 14px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 12.5, cursor: 'pointer', fontFamily: T.font }}>Get it manually</button>
          </div>
        </>
      )}
      {ready && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => { setInstalling(true); runUpdateAction(() => window.electronAPI?.installUpdate?.(), 'Could not start the update installer.') }} disabled={installing}
            style={{ flex: 1, height: 36, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
            {installing ? 'Restarting…' : 'Restart & install'}
          </button>
          <button type="button" onClick={() => setDismissed(true)}
            style={{ height: 36, padding: '0 14px', background: 'transparent', color: T.text2, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, fontSize: 12.5, cursor: 'pointer', fontFamily: T.font }}>Later</button>
        </div>
      )}
    </div>
  )
}

function TopBtn({ children, onClick, title, danger }) {
  const [h, setH] = useState(false)
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 7, cursor: 'pointer',
        background: h ? (danger ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)') : 'transparent',
        color: danger && h ? '#f87171' : T.text2, fontSize: 13 }}>{children}</button>
  )
}

// ── Dashboard / Home content ──
function ActionCard({ icon, title, desc, cta, accent, onClick, primary }) {
  const [h, setH] = useState(false)
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      aria-label={`${title}. ${cta}`}
      style={{
        display: 'block', width: '100%', textAlign: 'left', fontFamily: T.font,
        background: h ? 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, #12151B 100%)' : T.surface1,
        border: `1px solid ${h ? accent : T.border}`, borderRadius: T.rCard,
        boxShadow: T.cardShadow,
        padding: primary ? '18px 18px 16px' : '12px 14px', cursor: 'pointer',
        transition: 'border-color .14s, transform .14s, background .14s', transform: h ? 'translateY(-2px)' : 'none',
      }}>
      <div style={{ width: primary ? 38 : 30, height: primary ? 38 : 30, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: primary ? 18 : 15, background: `${accent}22`, border: `1px solid ${accent}44`, marginBottom: primary ? 12 : 8 }}>{icon}</div>
      <div style={{ fontSize: primary ? 16 : 13.5, fontWeight: 600, color: T.text1, fontFamily: primary ? T.fontDisplay : T.font }}>{title}</div>
      <div style={{ fontSize: primary ? 12.5 : 11, color: T.text2, marginTop: 3, lineHeight: 1.4, minHeight: primary ? 36 : 28 }}>{desc}</div>
      <div style={{ marginTop: primary ? 12 : 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: primary ? 13 : 11.5, fontWeight: 600, color: accent }}>{cta} →</div>
    </button>
  )
}

function Panel({ title, action, children }) {
  return (
    <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, boxShadow: T.cardShadow, padding: '14px 16px' }}>
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

const bannerBtn = {
  width: '100%',
  borderRadius: T.rCard,
  padding: '10px 14px',
  fontSize: 12.5,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  textAlign: 'left',
  fontFamily: 'inherit',
}

// ── Sessions table (Workspace) ──
export function SessionsTable({ sessions = [], onOpen, onDelete }) {
  if (!sessions.length) {
    return (
      <div style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, padding: '40px 24px', textAlign: 'center', color: T.text3, fontSize: 13, lineHeight: 1.6 }}>
        No sessions yet. Finish a <span style={{ color: T.text2 }}>Solo Practice</span> and it'll be saved here — transcript + feedback, kept ~3 months on this machine.
      </div>
    )
  }
  const cols = '1.8fr 0.9fr 70px 70px 84px'
  const cell = { padding: '12px 14px', fontSize: 12.5, color: T.text2, display: 'flex', alignItems: 'center', minWidth: 0 }
  return (
    <div role="table" aria-label="Saved interview sessions" style={{ background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, overflow: 'hidden' }}>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: cols, background: T.surface2, borderBottom: `1px solid ${T.border}` }}>
        {['Session', 'Date', 'Score', 'Msgs', 'Actions'].map((h, i) => (
          <div key={i} role="columnheader" style={{ ...cell, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', color: T.text3, textTransform: 'uppercase' }}>{h}</div>
        ))}
      </div>
      {sessions.map((s, i) => {
        const label = s.label || 'Interview'
        const date = new Date(s.ts)
        const dateLabel = Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        return (
          <div key={s.id} role="row" style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: i < sessions.length - 1 ? `1px solid ${T.border}` : 'none' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div role="cell" style={{ ...cell, padding: 0 }}>
              <button type="button" onClick={() => onOpen?.(s)} data-pi-target="history_session_open" aria-label={`Open session ${label}`}
                style={{ ...cell, width: '100%', height: '100%', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 2, background: 'transparent', border: 0, textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
                <span style={{ color: T.text1, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{label}</span>
                {s.verdict && <span style={{ fontSize: 11, color: T.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{s.verdict}</span>}
              </button>
            </div>
            <div role="cell" style={cell}>{dateLabel}</div>
            <div role="cell" style={cell}>{typeof s.score === 'number' ? <span style={{ color: scoreColor(s.score), fontWeight: 600 }}>{(s.score / 10).toFixed(1)}</span> : <span style={{ color: s.report?.error || s.note === 'evaluate_error' ? '#fca5a5' : T.text3 }}>{s.report?.error || s.note === 'evaluate_error' ? 'Err' : '—'}</span>}</div>
            <div role="cell" style={cell}>{s.transcript?.length || 0}</div>
            <div role="cell" style={{ ...cell, gap: 4 }}>
              <button type="button" onClick={() => onOpen?.(s)} data-pi-target="history_session_view" title="View" aria-label={`View session ${label}`} style={iconBtn}>👁</button>
              <button type="button" onClick={() => onDelete?.(s.id)} data-pi-target="history_session_delete" title="Delete" aria-label={`Delete session ${label}`} style={iconBtn}>🗑</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, opacity: 0.8, padding: 4, color: T.text2, borderRadius: 4 }

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
  const [quality, setQuality] = useState(null)
  useEffect(() => { apiFetch('/api/providers').then(r => r.json()).then(setD).catch(() => setD({})) }, [])
  useEffect(() => { window.electronAPI?.readSessionMetricsSummary?.().then(setQuality).catch(() => {}) }, [])
  const managed = isManaged()
  const providers = d?.providers || []
  const providerNames = configuredProviderNames([], providers)
  const aiReady = providers.length > 0
  const dg = !!d?.deepgram
  const liveReady = aiReady && dg
  const linux = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)
  const failover = providerNames.length >= 2
  const footer = !aiReady
    ? 'Add an AI key or switch to MockMate AI in Settings.'
    : !dg
      ? 'AI ready · Voice off — Solo works with typing; Live needs Deepgram in Settings → Voice.'
      : 'AI + Voice ready — you can start Solo or Live.'
  return (
    <Panel title="System Status">
      <StatusRow label="AI service" ok={aiReady} warn={!aiReady} value={aiReady ? `${providerNames.join(', ')} ready` : (managed ? 'Managed unavailable / no provider' : 'No key')} />
      <StatusRow label="Voice" ok={dg} warn={!dg} value={dg ? 'Deepgram connected' : 'Off — add Deepgram in Settings → Voice'} />
      <StatusRow label="Stealth" ok={false} warn={true} value={linux ? 'NOT supported (Linux)' : 'Verify in share preview (browser matrix UNKNOWN)'} />
      <StatusRow label="Failover" ok={failover} warn={!failover} value={failover ? 'Ready' : 'Single provider'} />
      {!!quality?.sessions && <>
        <StatusRow label="Answer speed" ok={quality.avgTtftMs != null && quality.avgTtftMs <= 5000} warn={quality.avgTtftMs > 5000} value={quality.avgTtftMs == null ? 'No data' : `${quality.avgTtftMs} ms avg`} />
        <StatusRow label="Question capture" ok={quality.avgCommitMs != null && quality.avgCommitMs <= 2500} warn={quality.avgCommitMs > 2500} value={quality.avgCommitMs == null ? 'No data' : `${quality.avgCommitMs} ms avg`} />
        <StatusRow label="Transcript confidence" ok={quality.avgSttConfidence >= 0.8} warn={quality.avgSttConfidence < 0.8} value={quality.avgSttConfidence == null ? 'No data' : `${Math.round(quality.avgSttConfidence * 100)}% avg`} />
        <div style={{ fontSize: 10, color: T.text3, marginTop: 6 }}>Local quality summary · last {quality.sessions} sessions · no transcript text stored</div>
      </>}
      <div role="status" style={{ fontSize: 10.5, color: liveReady ? T.text3 : '#fbbf24', marginTop: 8 }}>{footer}</div>
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
