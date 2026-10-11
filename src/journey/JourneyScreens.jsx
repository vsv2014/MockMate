import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { T } from '../auth/tokens'
import { apiFetch } from '../lib/apiClient'
import { isManaged } from '../lib/aiMode'
import { LANGUAGES, STT_LANG } from '../lib/languages'
import { trackProductEvent } from '../lib/productIntelligence'
import { useDeepgram } from '../useDeepgram'

const panelStyle = {
  background: T.surface1,
  border: `1px solid ${T.border}`,
  borderRadius: T.rCard,
  boxShadow: T.cardShadow,
}
const controlStyle = {
  width: '100%', boxSizing: 'border-box', background: T.surface2,
  border: `1px solid ${T.borderStrong}`, color: T.text1, borderRadius: T.rCtrl,
  padding: '10px 12px', font: `13px ${T.font}`, outlineColor: T.accentFrom,
}

function Button({ children, onClick, variant = 'secondary', disabled = false, title, type = 'button', style = {}, ...props }) {
  const variants = {
    primary: { background: T.accent, color: '#fff', border: '1px solid rgba(45,212,191,0.48)' },
    secondary: { background: T.surface2, color: T.text1, border: `1px solid ${T.borderStrong}` },
    quiet: { background: 'transparent', color: T.text2, border: `1px solid ${T.border}` },
    danger: { background: 'rgba(244,63,94,0.12)', color: '#fda4af', border: '1px solid rgba(244,63,94,0.28)' },
  }
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} {...props}
      style={{
        minHeight: 38, padding: '0 14px', borderRadius: T.rCtrl, font: `600 12.5px ${T.font}`,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.58 : 1,
        transition: 'transform .12s ease, border-color .12s ease, opacity .12s ease',
        whiteSpace: 'nowrap', ...variants[variant], ...style,
      }}>
      {children}
    </button>
  )
}

function Eyebrow({ children, color = T.accentFrom }) {
  return <div style={{ color, fontSize: 10, fontWeight: 750, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{children}</div>
}

function PageHeading({ eyebrow, title, detail, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 style={{ margin: '6px 0 0', color: T.text1, font: `600 27px ${T.fontDisplay}`, letterSpacing: '-0.025em' }}>{title}</h1>
        {detail && <div style={{ maxWidth: 720, color: T.text2, fontSize: 13, lineHeight: 1.55, marginTop: 5 }}>{detail}</div>}
      </div>
      {action}
    </div>
  )
}

function Pill({ children, tone = 'neutral' }) {
  const colors = {
    neutral: { color: T.text2, bg: 'rgba(255,255,255,0.05)', border: T.border },
    teal: { color: '#5eead4', bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.26)' },
    amber: { color: '#fcd34d', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
    red: { color: '#fda4af', bg: 'rgba(244,63,94,0.1)', border: 'rgba(244,63,94,0.24)' },
  }
  const c = colors[tone] || colors.neutral
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, color: c.color, background: c.bg, border: `1px solid ${c.border}`, fontSize: 10.5, fontWeight: 650, lineHeight: 1.1 }}>{children}</span>
}

function statusTone(status) {
  if (status === 'passed' || status === 'ready' || status === 'done') return 'teal'
  if (status === 'blocked' || status === 'failed' || status === 'missing') return 'red'
  if (status === 'testing' || status === 'checking' || status === 'listening' || status === 'finishing') return 'amber'
  return 'neutral'
}

function formatTime(value) {
  if (!value) return ''
  try { return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) } catch { return '' }
}

function formatDate(value) {
  if (!value) return ''
  try { return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '' }
}

function kitContextCount(kit) {
  if (!kit) return 0
  return [kit.targetRole, kit.targetCompany, kit.resume, kit.jobDescription, kit.customPrompt]
    .filter(value => String(value || '').trim()).length
}

function kitContextReady(kit) {
  return !!kit && kitContextCount(kit) > 0
}

function KitMiniCard({ kit, active = false, onSelect, onEdit }) {
  const contextCount = kitContextCount(kit)
  return (
    <div style={{ ...panelStyle, padding: 15, borderColor: active ? 'rgba(20,184,166,0.44)' : T.border, background: active ? 'linear-gradient(150deg, rgba(20,184,166,0.11), rgba(18,21,27,0.98) 62%)' : T.surface1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', flexShrink: 0, background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.24)', fontSize: 18 }}>▤</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <div style={{ color: T.text1, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kit?.title || 'Untitled interview kit'}</div>
            {active && <Pill tone="teal">ACTIVE</Pill>}
          </div>
          <div style={{ color: T.text2, fontSize: 11.5, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[kit?.targetRole, kit?.targetCompany].filter(Boolean).join(' · ') || 'Add a target role or company'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
            <Pill>{kit?.interviewType || 'Technical'}</Pill>
            <span style={{ color: contextCount ? '#5eead4' : T.text3, fontSize: 10.5 }}>{contextCount} context item{contextCount === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {onSelect && <Button variant={active ? 'quiet' : 'secondary'} onClick={onSelect} style={{ flex: 1 }}>{active ? 'Selected' : 'Use this Kit'}</Button>}
        {onEdit && <Button variant="quiet" onClick={onEdit} aria-label={`Edit ${kit?.title || 'interview kit'}`}>Edit</Button>}
      </div>
    </div>
  )
}

export function JourneyHome({
  auth, sessions = [], kits = [], activeKit, onSelectKit, onOpenKits,
  onOpenReadyRoom, onStartPractice, onOpenHistory, onSettings,
}) {
  const firstName = String(auth?.user?.name || '').trim().split(/\s+/)[0]
  const displayName = firstName ? `, ${firstName}` : ''
  const recent = sessions.slice(0, 3)
  const hasKit = !!activeKit

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {auth?.guest && (
        <div style={{ ...panelStyle, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderColor: 'rgba(20,184,166,0.25)', background: 'rgba(20,184,166,0.07)' }}>
          <span style={{ color: '#5eead4', fontSize: 15 }}>◈</span>
          <div style={{ flex: 1, color: T.text2, fontSize: 11.5, lineHeight: 1.5 }}>Guest mode is active. Kits, session history, and BYOK settings stay in this account’s local device scope.</div>
          <Button variant="quiet" onClick={() => auth.signIn?.()}>Sign in</Button>
        </div>
      )}

      <section style={{ ...panelStyle, position: 'relative', overflow: 'hidden', padding: 'clamp(20px, 4vw, 34px)', background: 'radial-gradient(ellipse at 85% 8%, rgba(20,184,166,0.16), transparent 37%), linear-gradient(140deg, #151a20, #101319 68%)', borderColor: 'rgba(255,255,255,0.09)' }}>
        <div aria-hidden="true" style={{ position: 'absolute', right: -64, bottom: -135, width: 310, height: 310, borderRadius: '50%', border: '1px solid rgba(45,212,191,0.12)', boxShadow: '0 0 0 32px rgba(45,212,191,0.025), 0 0 0 64px rgba(45,212,191,0.018)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', maxWidth: 720 }}>
          <Eyebrow>MOCKMATE · YOUR INTERVIEW WORKSPACE</Eyebrow>
          <h1 style={{ margin: '12px 0 8px', maxWidth: 690, color: T.text1, font: `600 clamp(28px, 4vw, 40px)/1.12 ${T.fontDisplay}`, letterSpacing: '-0.035em' }}>Make your next interview feel familiar{displayName}.</h1>
          <p style={{ margin: 0, maxWidth: 610, color: T.text2, fontSize: 13.5, lineHeight: 1.65 }}>Keep each opportunity’s context in its own Interview Kit. Rehearse with it, then check your setup in the Ready Room before a live call.</p>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 20 }}>
            <Button variant="primary" onClick={onOpenReadyRoom} style={{ height: 43, padding: '0 17px', fontSize: 13.5 }}>Open Ready Room <span aria-hidden="true">→</span></Button>
            <Button variant="secondary" onClick={onOpenKits} style={{ height: 43, padding: '0 16px' }}>Manage Interview Kits</Button>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(260px, .75fr)', gap: 14 }} className="mm-journey-home-grid">
        <div style={{ ...panelStyle, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
            <Eyebrow>ACTIVE INTERVIEW KIT</Eyebrow>
            {activeKit && <Pill tone="teal">LOCAL · ACCOUNT-SCOPED</Pill>}
          </div>
          {hasKit ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 190 }}>
                  <div style={{ color: T.text1, font: `600 20px ${T.fontDisplay}`, letterSpacing: '-0.015em' }}>{activeKit.title}</div>
                  <div style={{ color: T.text2, fontSize: 12.5, marginTop: 5 }}>{[activeKit.targetRole, activeKit.targetCompany].filter(Boolean).join(' · ') || 'Add a role or company to make this Kit yours'}</div>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 180, color: T.text3, fontSize: 10.5, fontWeight: 650 }}>
                  SWITCH ACTIVE KIT
                  <select aria-label="Active Interview Kit" value={activeKit.id} onChange={event => onSelectKit?.(event.target.value)} style={{ ...controlStyle, minWidth: 180, padding: '8px 10px', fontSize: 12 }}>
                    {kits.map(kit => <option key={kit.id} value={kit.id}>{kit.title}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 15 }}>
                <Pill>{activeKit.interviewType || 'Technical'}</Pill>
                {activeKit.yearsExp && <Pill>{activeKit.yearsExp}</Pill>}
                <span style={{ color: T.text3, fontSize: 11 }}>{kitContextCount(activeKit)} context item{kitContextCount(activeKit) === 1 ? '' : 's'} saved</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <Button variant="quiet" onClick={onOpenKits}>Edit Kit</Button>
                  <Button variant="secondary" onClick={onStartPractice}>Practice</Button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ color: T.text1, fontSize: 15, fontWeight: 650 }}>Create your first Interview Kit</div>
                <div style={{ color: T.text2, fontSize: 12, lineHeight: 1.55, marginTop: 4 }}>Add a role, company, or interview materials. Kits stay separate from your shared profile.</div>
              </div>
              <Button variant="primary" onClick={onOpenKits}>Create a Kit →</Button>
            </div>
          )}
        </div>

        <div style={{ ...panelStyle, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'linear-gradient(145deg, rgba(20,184,166,0.1), rgba(18,21,27,0.98) 58%)' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Eyebrow color="#5eead4">BEFORE THE CALL</Eyebrow>
              <span aria-hidden="true" style={{ color: '#5eead4', fontSize: 18 }}>↗</span>
            </div>
            <div style={{ color: T.text1, font: `600 18px ${T.fontDisplay}`, marginTop: 11 }}>One calm preflight.</div>
            <div style={{ color: T.text2, fontSize: 12, lineHeight: 1.55, marginTop: 5 }}>Check the real AI round trip, microphone transcription, and screen-share privacy—without guessing from a configured key.</div>
          </div>
          <Button variant="primary" onClick={onOpenReadyRoom} style={{ alignSelf: 'flex-start', marginTop: 17 }}>Review readiness →</Button>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 11 }}>
        <button type="button" onClick={onOpenKits} style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 12, padding: 14, cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: '#5eead4', background: 'rgba(20,184,166,0.12)', fontSize: 17 }}>▤</span>
          <span style={{ flex: 1 }}><strong style={{ display: 'block', color: T.text1, fontSize: 12.5 }}>Interview Kits</strong><span style={{ color: T.text3, fontSize: 10.5 }}>{kits.length} saved</span></span>
          <span style={{ color: T.text3 }}>→</span>
        </button>
        <button type="button" onClick={onStartPractice} style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 12, padding: 14, cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: '#c4b5fd', background: 'rgba(139,92,246,0.12)', fontSize: 17 }}>◉</span>
          <span style={{ flex: 1 }}><strong style={{ display: 'block', color: T.text1, fontSize: 12.5 }}>Solo Practice</strong><span style={{ color: T.text3, fontSize: 10.5 }}>Use the active Kit’s snapshot</span></span>
          <span style={{ color: T.text3 }}>→</span>
        </button>
        <button type="button" onClick={onSettings} style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 12, padding: 14, cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: '#fbbf24', background: 'rgba(245,158,11,0.1)', fontSize: 17 }}>⚙</span>
          <span style={{ flex: 1 }}><strong style={{ display: 'block', color: T.text1, fontSize: 12.5 }}>AI & Voice settings</strong><span style={{ color: T.text3, fontSize: 10.5 }}>Manage local keys and providers</span></span>
          <span style={{ color: T.text3 }}>→</span>
        </button>
      </section>

      <section style={{ ...panelStyle, padding: 17 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: recent.length ? 8 : 0 }}>
          <div style={{ flex: 1 }}>
            <Eyebrow>RECENT SESSIONS</Eyebrow>
            <div style={{ color: T.text2, fontSize: 11, marginTop: 4 }}>Your past practice stays below the next-step actions.</div>
          </div>
          {sessions.length > 0 && <Button variant="quiet" onClick={onOpenHistory}>View history →</Button>}
        </div>
        {recent.length === 0 ? (
          <div style={{ color: T.text3, fontSize: 12, padding: '11px 0 2px' }}>No completed sessions yet. Start with a Kit or run a Solo practice.</div>
        ) : recent.map(session => (
          <button key={session.id} type="button" onClick={onOpenHistory} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 2px', border: 0, borderTop: `1px solid ${T.border}`, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.05)', display: 'grid', placeItems: 'center', fontSize: 13 }}>◷</span>
            <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: 'block', color: T.text1, fontSize: 12, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{session.kitSnapshot?.name || session.label || 'Interview session'}</strong><span style={{ display: 'block', color: T.text3, fontSize: 10.5, marginTop: 2 }}>{formatDate(session.ts)}{session.mode ? ` · ${session.mode === 'live' ? 'Live' : 'Solo'}` : ''}</span></span>
            {typeof session.score === 'number' && <Pill tone={session.score >= 75 ? 'teal' : 'amber'}>{(session.score / 10).toFixed(1)}/10</Pill>}
            <span style={{ color: T.text3 }}>›</span>
          </button>
        ))}
      </section>

      <style>{`@media(max-width:760px){.mm-journey-home-grid{grid-template-columns:1fr!important}}`}</style>
    </div>
  )
}

function TextField({ label, value, onChange, placeholder = '', maxLength, help, type = 'text' }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, color: T.text2, fontSize: 11.5, fontWeight: 600 }}>
      {label}
      <input type={type} value={value || ''} maxLength={maxLength} placeholder={placeholder} onChange={event => onChange(event.target.value)} style={controlStyle} />
      {help && <span style={{ color: T.text3, fontSize: 10.5, fontWeight: 400, lineHeight: 1.45 }}>{help}</span>}
    </label>
  )
}

function TextAreaField({ label, value, onChange, placeholder = '', maxLength, rows = 6, help }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, color: T.text2, fontSize: 11.5, fontWeight: 600 }}>
      {label}
      <textarea value={value || ''} maxLength={maxLength} rows={rows} placeholder={placeholder} onChange={event => onChange(event.target.value)} style={{ ...controlStyle, resize: 'vertical', lineHeight: 1.55 }} />
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: T.text3, fontSize: 10.5, fontWeight: 400, lineHeight: 1.45 }}>
        <span>{help || 'Stored locally with this Kit.'}</span><span>{String(value || '').length.toLocaleString()} / {maxLength.toLocaleString()}</span>
      </span>
    </label>
  )
}

export function InterviewKitsScreen({
  kits = [], activeKitId, onCreate, onSave, onDelete, onActivate, onOpenReadyRoom,
}) {
  const [selectedId, setSelectedId] = useState(activeKitId || kits[0]?.id || '')
  const [draft, setDraft] = useState(null)
  const [saveMessage, setSaveMessage] = useState('')
  const selectedKit = kits.find(kit => kit.id === selectedId) || null
  const dirty = !!draft && !!selectedKit && JSON.stringify(draft) !== JSON.stringify(selectedKit)

  useEffect(() => {
    if (!selectedId || !kits.some(kit => kit.id === selectedId)) setSelectedId(activeKitId || kits[0]?.id || '')
  }, [kits, activeKitId, selectedId])

  useEffect(() => {
    setDraft(selectedKit ? { ...selectedKit } : null)
    setSaveMessage('')
  }, [selectedId, selectedKit?.updatedAt, selectedKit?.id])

  const patch = (key, value) => setDraft(current => current ? { ...current, [key]: value } : current)
  const save = () => {
    if (!draft) return false
    const next = { ...draft, updatedAt: new Date().toISOString() }
    const ok = onSave?.(next)
    setSaveMessage(ok === false ? 'Could not save. Check available device storage and try again.' : 'Saved on this device.')
    if (ok !== false) setDraft(next)
    return ok !== false
  }
  const openInReadyRoom = () => {
    if (dirty && !save()) return
    onActivate?.(draft.id)
    onOpenReadyRoom?.(draft)
  }
  const create = () => {
    setSaveMessage('')
    const id = onCreate?.()
    if (id) setSelectedId(id)
  }
  const remove = () => {
    if (!selectedKit) return
    const ok = window.confirm(`Delete “${selectedKit.title}”? Completed session snapshots remain in history.`)
    if (!ok) return
    onDelete?.(selectedKit.id)
    setSelectedId('')
    setDraft(null)
    setSaveMessage('Kit deleted. Existing session snapshots were not changed.')
  }
  const selectKit = id => {
    setSelectedId(id)
    setSaveMessage('')
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <PageHeading eyebrow="YOUR OPPORTUNITIES" title="Interview Kits" detail="Keep each role’s materials and interview preferences together. Kits are account-scoped on this device; changing one never rewrites your shared profile." action={<Button variant="primary" onClick={create}>＋ New Kit</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, .72fr) minmax(420px, 1.28fr)', gap: 15, alignItems: 'start' }} className="mm-kit-layout">
        <section style={{ ...panelStyle, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 2px 12px' }}>
            <div><Eyebrow>YOUR KIT LIBRARY</Eyebrow><div style={{ color: T.text3, fontSize: 10.5, marginTop: 4 }}>{kits.length} of 30 saved</div></div>
            {kits.length > 0 && <Pill tone="teal">{kits.length} ACTIVE OPTION{kits.length === 1 ? '' : 'S'}</Pill>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {kits.map(kit => <KitMiniCard key={kit.id} kit={kit} active={kit.id === activeKitId} onSelect={() => { onActivate?.(kit.id); selectKit(kit.id) }} onEdit={() => selectKit(kit.id)} />)}
            {kits.length === 0 && <div style={{ padding: '22px 13px', textAlign: 'center', color: T.text3, fontSize: 12, lineHeight: 1.55 }}>No Kits yet. Create one for an upcoming role; your shared profile stays untouched.</div>}
          </div>
          <div style={{ color: T.text3, fontSize: 10.5, lineHeight: 1.5, borderTop: `1px solid ${T.border}`, padding: '12px 2px 2px', marginTop: 12 }}>Completed sessions store a local snapshot of this Kit’s role, resume, job description, notes, and selected document IDs alongside the transcript. Deleting the Kit won’t rewrite past sessions.</div>
        </section>

        <section style={{ ...panelStyle, padding: '18px clamp(14px, 3vw, 22px)' }}>
          {draft ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 17 }}>
                <div style={{ flex: 1, minWidth: 200 }}><Eyebrow>EDITING KIT</Eyebrow><div style={{ color: T.text1, font: `600 18px ${T.fontDisplay}`, marginTop: 5 }}>{draft.title || 'Untitled interview kit'}</div><div style={{ color: T.text3, fontSize: 10.5, marginTop: 3 }}>Updated {formatDate(draft.updatedAt || draft.createdAt)}</div></div>
                <Button variant="quiet" onClick={openInReadyRoom}>Open in Ready Room →</Button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 11 }}>
                <TextField label="Kit name" value={draft.title} maxLength={100} placeholder="e.g. Senior Backend · Acme" onChange={value => patch('title', value)} />
                <TextField label="Candidate name" value={draft.candidateName} maxLength={120} placeholder="Name used in this interview" onChange={value => patch('candidateName', value)} />
                <TextField label="Target role" value={draft.targetRole} maxLength={120} placeholder="e.g. Senior Backend Engineer" onChange={value => patch('targetRole', value)} />
                <TextField label="Company" value={draft.targetCompany} maxLength={120} placeholder="e.g. Acme" onChange={value => patch('targetCompany', value)} />
                <TextField label="Experience / level" value={draft.yearsExp} maxLength={80} placeholder="e.g. 6 years · Senior" onChange={value => patch('yearsExp', value)} />
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, color: T.text2, fontSize: 11.5, fontWeight: 600 }}>Interview type<select value={draft.interviewType} onChange={event => patch('interviewType', event.target.value)} style={controlStyle}>{['Technical', 'Behavioral', 'System Design', 'Mixed'].map(value => <option key={value}>{value}</option>)}</select></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, color: T.text2, fontSize: 11.5, fontWeight: 600 }}>Interview language<select value={draft.language} onChange={event => patch('language', event.target.value)} style={controlStyle}>{LANGUAGES.map(value => <option key={value}>{value}</option>)}</select></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, color: T.text2, fontSize: 11.5, fontWeight: 600 }}>Interviewer tone<select value={draft.voiceStyle} onChange={event => patch('voiceStyle', event.target.value)} style={controlStyle}>{['Professional', 'Friendly', 'Concise', 'Detailed'].map(value => <option key={value}>{value}</option>)}</select></label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                <TextAreaField label="Resume / candidate background" value={draft.resume} maxLength={40_000} rows={7} placeholder="Paste the version of your resume you want this Kit to use…" onChange={value => patch('resume', value)} help="Used as Kit context for this interview. Stored locally on this device." />
                <TextAreaField label="Job description" value={draft.jobDescription} maxLength={40_000} rows={6} placeholder="Paste the job description for this opportunity…" onChange={value => patch('jobDescription', value)} help="This stays in this Kit; it does not replace your shared profile’s job description." />
                <TextAreaField label="Interview focus / notes" value={draft.customPrompt} maxLength={3_000} rows={3} placeholder="Optional: areas to probe, important constraints, or coaching focus…" onChange={value => patch('customPrompt', value)} help="Optional instructions for this Kit’s practice/live session." />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', borderTop: `1px solid ${T.border}`, paddingTop: 14, marginTop: 17 }}>
                <Button variant="primary" disabled={!dirty} onClick={save}>Save Kit</Button>
                <Button variant="secondary" onClick={openInReadyRoom}>Ready Room →</Button>
                <Button variant="quiet" onClick={remove} style={{ marginLeft: 'auto' }}>Delete</Button>
                {saveMessage && <span role="status" style={{ width: '100%', color: saveMessage.startsWith('Could not') ? '#fda4af' : '#5eead4', fontSize: 11.5 }}>{saveMessage}</span>}
              </div>
            </>
          ) : (
            <div style={{ minHeight: 390, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
              <div style={{ maxWidth: 400 }}>
                <div style={{ width: 58, height: 58, borderRadius: 17, margin: '0 auto 13px', display: 'grid', placeItems: 'center', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.25)', color: '#5eead4', fontSize: 25 }}>▤</div>
                <div style={{ color: T.text1, font: `600 20px ${T.fontDisplay}` }}>A context that travels with the role.</div>
                <div style={{ color: T.text2, fontSize: 12.5, lineHeight: 1.6, marginTop: 7 }}>Create an Interview Kit to keep your resume, job description, and focus together without overwriting the shared profile.</div>
                <Button variant="primary" onClick={create} style={{ marginTop: 17 }}>＋ Create your first Kit</Button>
              </div>
            </div>
          )}
        </section>
      </div>
      <style>{`@media(max-width:860px){.mm-kit-layout{grid-template-columns:1fr!important}}`}</style>
    </div>
  )
}

function CheckCard({ number, title, status, statusText, children, action, tone }) {
  const circle = status === 'passed' || status === 'done' ? { color: '#5eead4', bg: 'rgba(20,184,166,0.13)', icon: '✓' }
    : status === 'failed' || status === 'missing' || status === 'blocked' ? { color: '#fda4af', bg: 'rgba(244,63,94,0.12)', icon: '!' }
      : status === 'testing' || status === 'checking' || status === 'listening' || status === 'finishing' ? { color: '#fcd34d', bg: 'rgba(245,158,11,0.12)', icon: '…' }
        : { color: T.text3, bg: 'rgba(255,255,255,0.06)', icon: number }
  return (
    <section style={{ ...panelStyle, display: 'flex', gap: 13, padding: 15, borderColor: circle.color === '#5eead4' ? 'rgba(20,184,166,0.24)' : T.border }}>
      <div aria-hidden="true" style={{ width: 31, height: 31, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', color: circle.color, background: circle.bg, fontSize: 12, fontWeight: 800 }}>{circle.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, color: T.text1, fontSize: 13.5, fontWeight: 700 }}>{title}</h2>
          <Pill tone={tone || statusTone(status)}>{statusText}</Pill>
        </div>
        <div style={{ color: T.text2, fontSize: 11.5, lineHeight: 1.55, marginTop: 6 }}>{children}</div>
        {action && <div style={{ marginTop: 11 }}>{action}</div>}
      </div>
    </section>
  )
}

export function ReadyRoom({
  kit, onOpenKits, onEditKit, onSettings, onContinueLive, onApplyProtection, isLinux = false, stealth = true, previewMode = false,
}) {
  const [service, setService] = useState({ status: 'checking', providers: [], deepgram: false, error: '' })
  const [aiTest, setAiTest] = useState({ status: 'idle', message: '' })
  const [aiBusy, setAiBusy] = useState(false)
  const [voiceTest, setVoiceTest] = useState({ status: 'idle', message: '' })
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [protectionStatus, setProtectionStatus] = useState('idle')
  const [protectionMessage, setProtectionMessage] = useState('')
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [sharePreviewConfirmed, setSharePreviewConfirmed] = useState(false)
  const [linuxAcknowledged, setLinuxAcknowledged] = useState(false)
  const [primaryMessage, setPrimaryMessage] = useState('')
  const voiceStopTimer = useRef(null)
  const voiceResultTimer = useRef(null)
  const voiceAttempt = useRef(0)
  const voiceHasFinal = useRef(false)
  const voiceFailure = useRef(false)
  const voiceCancelled = useRef(false)
  const voiceRef = useRef(null)
  const checkRef = useRef(null)
  const serviceCheckGeneration = useRef(0)
  const checkServices = useCallback(async () => {
    const generation = ++serviceCheckGeneration.current
    setService({ status: 'checking', providers: [], deepgram: false, error: '' })
    try {
      const response = await apiFetch('/api/providers', { timeoutMs: 12000 })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || `Service returned ${response.status}`)
      if (serviceCheckGeneration.current !== generation) return
      setService({ status: 'ready', providers: Array.isArray(data.providers) ? data.providers : [], deepgram: !!data.deepgram, error: '' })
    } catch (error) {
      if (serviceCheckGeneration.current !== generation) return
      setService({ status: 'error', providers: [], deepgram: false, error: error?.message || 'Could not reach the AI service.' })
    }
  }, [])

  useEffect(() => {
    if (previewMode) {
      serviceCheckGeneration.current += 1
      setService({ status: 'ready', providers: [{ id: 'preview-provider' }], deepgram: true, error: '' })
      return () => { serviceCheckGeneration.current += 1 }
    }
    checkServices()
    return () => { serviceCheckGeneration.current += 1 }
  }, [checkServices, previewMode])

  useEffect(() => {
    setAiTest({ status: 'idle', message: '' })
    setVoiceTest({ status: 'idle', message: '' })
    setVoiceTranscript('')
    setProtectionStatus('idle')
    setProtectionMessage('')
    setSharePreviewConfirmed(false)
    setLinuxAcknowledged(false)
  }, [kit?.id])

  useEffect(() => {
    if (isLinux || stealth) return
    setProtectionStatus('idle')
    setProtectionMessage('Stealth was turned off. Re-apply OS protection and re-check your meeting preview.')
    setSharePreviewConfirmed(false)
  }, [isLinux, stealth])

  useEffect(() => {
    const off = window.electronAPI?.onMeetingDetected?.(() => setSharePreviewConfirmed(false))
    return () => { try { off?.() } catch {} }
  }, [])

  useEffect(() => () => {
    clearTimeout(voiceStopTimer.current)
    clearTimeout(voiceResultTimer.current)
    voiceAttempt.current += 1
  }, [])

  const runAiTest = async () => {
    if (previewMode) { setPrimaryMessage('Preview only: no AI request was sent.'); return }
    setAiBusy(true)
    setAiTest({ status: 'testing', message: 'Sending one short test question…' })
    trackProductEvent('ready_room_ai_test_started')
    try {
      const response = await apiFetch('/api/hint', {
        method: 'POST', timeoutMs: 30_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'In one short sentence, what does a hash map do?',
          profile: {}, conversationHistory: [], provider: isManaged() ? '' : 'auto',
          language: 'English', style: 'balanced', autoSkip: false, mode: 'answer',
        }),
      })
      const data = await response.json().catch(() => ({}))
      const result = data?.hint
      const answer = typeof result === 'string' ? result : (result?.fullAnswer || result?.sampleAnswer || result?.opener || '')
      if (!response.ok) throw new Error(data?.error || data?.message || `AI request failed (${response.status})`)
      if (!String(answer || '').trim()) throw new Error('The AI service returned no usable answer. No readiness claim made.')
      setAiTest({ status: 'passed', message: `AI round trip completed at ${formatTime(new Date().toISOString())}.` })
      trackProductEvent('ready_room_ai_test_passed')
    } catch (error) {
      setAiTest({ status: 'failed', message: error?.message || 'AI round trip failed. Check Settings and retry.' })
      trackProductEvent('ready_room_ai_test_failed')
    } finally { setAiBusy(false) }
  }

  const onVoiceFinal = useCallback(text => {
    const transcript = String(text || '').trim()
    if (!transcript || !voiceAttempt.current) return
    voiceHasFinal.current = true
    voiceFailure.current = false
    clearTimeout(voiceStopTimer.current)
    clearTimeout(voiceResultTimer.current)
    setVoiceTranscript(transcript)
    setVoiceTest({ status: 'passed', message: 'Microphone audio reached Deepgram and returned a final transcript.' })
    trackProductEvent('ready_room_voice_test_passed')
    voiceRef.current?.stop?.()
  }, [])

  const onVoiceFail = useCallback(message => {
    if (!voiceAttempt.current) return
    voiceFailure.current = true
    clearTimeout(voiceStopTimer.current)
    clearTimeout(voiceResultTimer.current)
    setVoiceTest({ status: 'failed', message: String(message || 'Voice test failed. Check microphone permission and Deepgram settings.') })
    trackProductEvent('ready_room_voice_test_failed')
  }, [])

  const voice = useDeepgram(onVoiceFinal, onVoiceFail, STT_LANG[kit?.language] || 'en-US')
  voiceRef.current = voice

  const startVoiceTest = async () => {
    if (previewMode) { setPrimaryMessage('Preview only: microphone capture is disabled.'); return }
    clearTimeout(voiceStopTimer.current)
    clearTimeout(voiceResultTimer.current)
    voiceAttempt.current += 1
    const attempt = voiceAttempt.current
    voiceHasFinal.current = false
    voiceFailure.current = false
    voiceCancelled.current = false
    setVoiceTranscript('')
    setVoiceTest({ status: 'listening', message: 'Connecting to Deepgram. Allow the microphone, then say “MockMate voice check” and pause.' })
    trackProductEvent('ready_room_voice_test_started')
    try { await voice.start() } catch (error) {
      if (voiceAttempt.current === attempt) onVoiceFail(error?.message)
      return
    }
    if (voiceAttempt.current !== attempt || voiceFailure.current || voiceCancelled.current || voiceHasFinal.current) return
    voiceStopTimer.current = setTimeout(() => {
      if (voiceAttempt.current !== attempt) return
      if (voiceHasFinal.current) return
      setVoiceTest({ status: 'finishing', message: 'Stopping the short capture and waiting for the final transcript…' })
      voiceRef.current?.stop?.()
      voiceResultTimer.current = setTimeout(() => {
        if (voiceAttempt.current === attempt && !voiceHasFinal.current) {
          setVoiceTest({ status: 'failed', message: 'No final transcript arrived. Check microphone permission, speak clearly, and try again.' })
        }
      }, 1800)
    }, 10_000)
  }

  const stopVoiceTest = () => {
    const attempt = voiceAttempt.current
    if (!voice.active) voiceCancelled.current = true
    clearTimeout(voiceStopTimer.current)
    setVoiceTest(current => current.status === 'passed' ? current : { status: 'finishing', message: 'Stopping capture and waiting briefly for the final transcript…' })
    voice.stop()
    voiceResultTimer.current = setTimeout(() => {
      if (voiceAttempt.current === attempt && !voiceHasFinal.current) {
        setVoiceTest({ status: 'failed', message: 'No final transcript arrived. Check microphone permission and try again.' })
      }
    }, 1800)
  }

  const applyProtection = async () => {
    if (previewMode) { setPrimaryMessage('Preview only: OS capture protection was not called.'); return }
    setPrivacyBusy(true)
    setProtectionStatus('testing')
    setProtectionMessage('Applying supported OS capture protection…')
    try {
      const result = await onApplyProtection?.()
      if (!result?.ok) {
        setProtectionStatus('failed')
        setProtectionMessage(result?.unsupported ? 'OS capture protection is not supported on this platform.' : (result?.error || 'Could not apply OS capture protection.'))
      } else {
        setProtectionStatus('passed')
        setProtectionMessage('OS capture protection applied. This does not prove what your meeting share preview shows.')
      }
    } catch (error) {
      setProtectionStatus('failed')
      setProtectionMessage(error?.message || 'Could not apply OS capture protection.')
    } finally { setPrivacyBusy(false) }
  }

  const contextReady = kitContextReady(kit)
  const providerReady = service.status === 'ready' && service.providers.length > 0
  const voiceConfigured = service.status === 'ready' && service.deepgram
  const privacyReady = isLinux ? linuxAcknowledged : protectionStatus === 'passed' && sharePreviewConfirmed
  const allReady = contextReady && aiTest.status === 'passed' && voiceTest.status === 'passed' && privacyReady
  const firstAction = !kit ? 'kits'
    : !contextReady ? 'context'
      : service.status === 'checking' ? 'checking'
        : service.status === 'error' ? 'service'
          : !providerReady ? 'ai-settings'
            : aiTest.status !== 'passed' ? 'ai-test'
              : !voiceConfigured ? 'voice-settings'
                : voiceTest.status !== 'passed' ? 'voice-test'
                  : !privacyReady ? 'privacy'
                    : 'continue'

  const goToCheck = action => {
    if (action === 'kits') { onOpenKits?.(); return }
    if (action === 'context') { onEditKit?.(kit); return }
    if (action === 'service') { checkServices(); return }
    if (action === 'ai-settings' || action === 'voice-settings') { onSettings?.(); return }
    if (action === 'ai-test') { runAiTest(); return }
    if (action === 'voice-test') { startVoiceTest(); return }
    if (action === 'privacy') { checkRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); setPrimaryMessage('Complete the privacy check below. Applying protection is not the same as confirming the meeting share preview.'); return }
    if (action === 'continue') { onContinueLive?.(kit); return }
    setPrimaryMessage('Checking the local AI and voice services…')
  }

  const primaryAction = () => {
    setPrimaryMessage('')
    if (firstAction === 'ai-test' && aiBusy) return
    if (firstAction === 'voice-test' && voiceTest.status === 'listening') { stopVoiceTest(); return }
    goToCheck(firstAction)
  }
  const primaryLabel = {
    kits: 'Create an Interview Kit', context: 'Add context to this Kit', checking: 'Checking services…',
    service: 'Retry the AI service check', 'ai-settings': 'Configure an AI provider', 'ai-test': aiBusy ? 'Testing AI…' : 'Run the AI test',
    'voice-settings': 'Configure Voice (Deepgram)', 'voice-test': voiceTest.status === 'listening' ? (voice.active ? 'Stop voice test' : 'Connecting to microphone…') : (voiceTest.status === 'passed' ? 'Voice test passed' : 'Test microphone'),
    privacy: isLinux ? 'Review Linux visibility risk' : 'Complete privacy check', continue: 'Continue to Live setup',
  }[firstAction]

  const aiStatus = service.status === 'checking' ? 'checking'
    : service.status === 'error' ? 'failed'
      : !providerReady ? 'missing'
        : aiTest.status === 'passed' ? 'passed'
          : aiTest.status === 'failed' ? 'failed'
            : aiTest.status === 'testing' ? 'testing' : 'idle'
  const aiStatusText = service.status === 'checking' ? 'Checking service…'
    : service.status === 'error' ? 'Service unavailable'
      : !providerReady ? 'No AI provider detected'
        : aiTest.status === 'passed' ? 'Round trip verified'
          : aiTest.status === 'failed' ? 'Test failed'
            : aiTest.status === 'testing' ? 'Testing now…' : 'Configured · not tested'
  const voiceStatus = service.status === 'checking' ? 'checking'
    : service.status === 'error' ? 'idle'
      : !voiceConfigured ? 'missing'
        : voiceTest.status
  const voiceStatusText = service.status === 'checking' ? 'Checking service…'
    : service.status === 'error' ? 'Service unavailable'
      : !voiceConfigured ? 'Deepgram not detected'
        : voiceTest.status === 'passed' ? 'Transcript verified'
          : voiceTest.status === 'failed' ? 'Test failed'
            : voiceTest.status === 'listening' ? (voice.active ? 'Listening · up to 10 sec' : 'Connecting…')
              : voiceTest.status === 'finishing' ? 'Waiting for transcript…'
                : 'Configured · not tested'

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <PageHeading eyebrow="LIVE INTERVIEW · PRE-FLIGHT" title="Ready Room" detail="Check the real connections and screen-share conditions before you enter Live. A configured key is not a successful test, and OS protection is not a meeting-preview check." action={kit && <Pill tone="teal">KIT · {kit.title}</Pill>} />

      {!kit ? (
        <section style={{ ...panelStyle, padding: 24, textAlign: 'center', maxWidth: 680, margin: '0 auto' }}>
          <div style={{ color: T.accentFrom, fontSize: 26, marginBottom: 9 }}>▤</div>
          <h2 style={{ color: T.text1, font: `600 21px ${T.fontDisplay}`, margin: '0 0 7px' }}>Choose the context you’ll bring.</h2>
          <p style={{ color: T.text2, fontSize: 12.5, lineHeight: 1.6, margin: '0 auto 15px', maxWidth: 470 }}>A Kit keeps this role’s resume and job description separate from your shared profile. Create or select one before running the Live preflight.</p>
          <Button variant="primary" onClick={onOpenKits}>Open Interview Kits →</Button>
        </section>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(250px, .72fr)', gap: 14, alignItems: 'start' }} className="mm-ready-layout">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <CheckCard number="01" title="Interview context" status={contextReady ? 'passed' : 'missing'} statusText={contextReady ? 'Kit context found' : 'Needs context'} action={<Button variant="quiet" onClick={() => onEditKit?.(kit)}>{contextReady ? 'Review Kit' : 'Add role or materials'}</Button>}>
                {contextReady
                  ? `${kit.targetRole || 'Role not set'}${kit.targetCompany ? ` · ${kit.targetCompany}` : ''}. Session context will be copied into a snapshot; it won’t update your shared profile.`
                  : 'This Kit has no role, company, resume, job description, or focus notes yet. Add context to keep the session grounded.'}
              </CheckCard>

              <CheckCard number="02" title="AI answer service" status={aiStatus} statusText={aiStatusText} action={
                service.status === 'error'
                  ? <Button variant="secondary" onClick={checkServices}>Retry service check</Button>
                  : !providerReady
                    ? <Button variant="secondary" onClick={onSettings}>Open AI settings</Button>
                    : previewMode
                      ? <Button variant="quiet" disabled>Test disabled in preview</Button>
                      : <Button variant={aiTest.status === 'passed' ? 'quiet' : 'secondary'} disabled={aiBusy} onClick={runAiTest}>{aiBusy ? 'Testing…' : aiTest.status === 'passed' ? 'Run test again' : 'Test AI round trip'}</Button>
              }>
                {service.status === 'error'
                  ? `The local/managed AI service could not be reached: ${service.error}`
                  : !providerReady && service.status === 'ready'
                    ? 'No configured AI provider was reported by the current service. Add or select one in Settings.'
                    : aiTest.message || 'A provider is configured, but has not completed a real test request in this Ready Room.'}
                <div style={{ color: T.text3, fontSize: 10.5, lineHeight: 1.5, marginTop: 7 }}>The test sends one short generic question to the configured AI provider and may use API credits. It does not send this Kit, resume, or job description.</div>
              </CheckCard>

              <CheckCard number="03" title="Microphone → Deepgram" status={voiceStatus} statusText={voiceStatusText} action={
                service.status === 'error'
                  ? <Button variant="secondary" onClick={checkServices}>Retry service check</Button>
                  : !voiceConfigured
                    ? <Button variant="secondary" onClick={onSettings}>Open Voice settings</Button>
                    : previewMode
                      ? <Button variant="quiet" disabled>Test disabled in preview</Button>
                      : voiceTest.status === 'listening'
                    ? <Button variant="danger" onClick={stopVoiceTest}>{voice.active ? 'Stop voice test' : 'Cancel microphone request'}</Button>
                    : <Button variant={voiceTest.status === 'passed' ? 'quiet' : 'secondary'} disabled={voiceTest.status === 'finishing'} onClick={startVoiceTest}>{voiceTest.status === 'passed' ? 'Run test again' : 'Test microphone'}</Button>
              }>
                {voiceTest.message || (!voiceConfigured && service.status === 'ready'
                  ? 'Deepgram isn’t configured or available. Add Voice in Settings before Live.'
                  : 'A configured Deepgram key does not confirm microphone permission or transcription yet. This test waits for an actual final transcript.')}
                <div style={{ color: T.text3, fontSize: 10.5, lineHeight: 1.5, marginTop: 7 }}>Voice test uses your microphone for up to 10 seconds and sends audio to Deepgram; provider usage may apply. The transcript stays on this screen and is not saved to the Kit or session history.</div>
                {voice.active && <div aria-live="polite" style={{ color: '#5eead4', fontSize: 11, marginTop: 6 }}>{voice.interim ? `Hearing: ${voice.interim}` : 'Listening—say “MockMate voice check”, then pause.'}</div>}
                {voiceTranscript && <div role="status" style={{ padding: '7px 9px', marginTop: 8, borderRadius: 8, background: 'rgba(20,184,166,0.08)', color: T.text1, fontSize: 11.5 }}><strong>Transcript:</strong> {voiceTranscript}</div>}
              </CheckCard>

              <div ref={checkRef}>
                <CheckCard number="04" title="Screen-share privacy" status={privacyReady ? 'passed' : (protectionStatus === 'failed' ? 'failed' : 'idle')} statusText={isLinux ? (linuxAcknowledged ? 'Risk acknowledged' : 'Stealth unavailable') : privacyReady ? 'Preview confirmed' : protectionStatus === 'passed' ? 'Preview still needs your check' : 'Not verified'}>
                  {isLinux ? (
                    <>
                      <div style={{ color: '#fcd34d', marginBottom: 8 }}>Linux does not support this overlay’s stealth capture protection. MockMate may be visible to other people in a screen share or recording.</div>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: T.text1, fontSize: 11.5, cursor: 'pointer' }}><input type="checkbox" checked={linuxAcknowledged} disabled={previewMode} onChange={event => setLinuxAcknowledged(event.target.checked)} style={{ marginTop: 2 }} /><span>I understand the overlay remains visible on Linux and accept that risk before opening Live.</span></label>
                    </>
                  ) : (
                    <>
                      <div>{protectionMessage || 'Apply OS capture protection, then check your actual meeting’s share preview. MockMate cannot verify what another app is showing.'}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        <Button variant="secondary" disabled={privacyBusy || previewMode} onClick={applyProtection}>{previewMode ? 'OS test disabled in preview' : privacyBusy ? 'Applying…' : protectionStatus === 'passed' ? 'Re-apply protection' : 'Apply OS protection'}</Button>
                      </div>
                      <div style={{ marginTop: 10, padding: 10, borderRadius: 9, background: 'rgba(255,255,255,0.035)', border: `1px solid ${T.border}` }}>
                        <div style={{ color: T.text1, fontWeight: 650, fontSize: 11.5, marginBottom: 6 }}>Manual preview check</div>
                        <div style={{ color: T.text3, fontSize: 10.5, lineHeight: 1.5, marginBottom: 8 }}>Open the meeting’s share preview or test share. Confirm MockMate is not visible there. Protection being applied is not proof of this.</div>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: T.text2, fontSize: 11, lineHeight: 1.45, cursor: protectionStatus === 'passed' ? 'pointer' : 'not-allowed', opacity: protectionStatus === 'passed' ? 1 : 0.55 }}><input type="checkbox" checked={sharePreviewConfirmed} disabled={previewMode || protectionStatus !== 'passed'} onChange={event => setSharePreviewConfirmed(event.target.checked)} style={{ marginTop: 2 }} /><span>I checked the meeting share preview and MockMate is not visible.</span></label>
                      </div>
                    </>
                  )}
                </CheckCard>
              </div>
            </div>

            <aside style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <section style={{ ...panelStyle, padding: 16, background: 'linear-gradient(145deg, rgba(20,184,166,0.11), rgba(18,21,27,0.98) 62%)' }}>
                <Eyebrow>THIS SESSION</Eyebrow>
                <div style={{ color: T.text1, font: `600 17px ${T.fontDisplay}`, marginTop: 9 }}>{kit.title}</div>
                <div style={{ color: T.text2, fontSize: 11.5, lineHeight: 1.55, marginTop: 5 }}>{[kit.targetRole, kit.targetCompany].filter(Boolean).join(' · ') || 'Add a target role or company in the Kit.'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 11 }}><Pill>{kit.interviewType || 'Technical'}</Pill>{kit.yearsExp && <Pill>{kit.yearsExp}</Pill>}<Pill>{kit.language || 'English'}</Pill></div>
                <Button variant="quiet" onClick={() => onEditKit?.(kit)} style={{ marginTop: 13, width: '100%' }}>Edit Kit context</Button>
              </section>

              <section style={{ ...panelStyle, padding: 16 }}>
                <Eyebrow>LIVE READINESS</Eyebrow>
                <div style={{ color: T.text1, fontSize: 13, fontWeight: 700, marginTop: 9 }}>{allReady ? 'Checks complete' : 'A few checks remain'}</div>
                <div style={{ color: T.text2, fontSize: 11, lineHeight: 1.55, marginTop: 5 }}>{allReady ? 'Continue to the existing Live setup. Its final start gate remains in place.' : 'Each status is based on a real test or an explicit manual confirmation—not just a saved setting.'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 10px', alignItems: 'center', borderTop: `1px solid ${T.border}`, paddingTop: 12, marginTop: 13 }}>
                  <span style={{ color: T.text3, fontSize: 10.5 }}>Kit context</span><Pill tone={contextReady ? 'teal' : 'red'}>{contextReady ? 'OK' : 'TODO'}</Pill>
                  <span style={{ color: T.text3, fontSize: 10.5 }}>AI round trip</span><Pill tone={aiTest.status === 'passed' ? 'teal' : 'neutral'}>{aiTest.status === 'passed' ? 'OK' : 'TODO'}</Pill>
                  <span style={{ color: T.text3, fontSize: 10.5 }}>Voice transcript</span><Pill tone={voiceTest.status === 'passed' ? 'teal' : 'neutral'}>{voiceTest.status === 'passed' ? 'OK' : 'TODO'}</Pill>
                  <span style={{ color: T.text3, fontSize: 10.5 }}>Privacy check</span><Pill tone={privacyReady ? 'teal' : 'neutral'}>{privacyReady ? 'OK' : 'TODO'}</Pill>
                </div>
              </section>

              <section style={{ ...panelStyle, padding: 15, borderColor: allReady ? 'rgba(20,184,166,0.4)' : T.border }}>
                <Button variant="primary" disabled={previewMode || aiBusy || service.status === 'checking' || (voiceTest.status === 'listening' && voice.active)} onClick={primaryAction} style={{ width: '100%', minHeight: 45, fontSize: 13 }}>
                  {allReady ? 'Continue to Live setup →' : primaryLabel || 'Complete readiness checks'}
                </Button>
                {!allReady && <div role="status" style={{ color: primaryMessage ? '#fcd34d' : T.text3, fontSize: 10.5, lineHeight: 1.5, marginTop: 8 }}>{primaryMessage || 'Choose the next action above. You can return here at any time.'}</div>}
                <div style={{ color: T.text3, fontSize: 10, lineHeight: 1.5, marginTop: 10 }}>Passing this room does not start a call or audio capture. Live’s existing start gate still checks its required platform protections and inputs.</div>
              </section>
            </aside>
          </div>
          <style>{`@media(max-width:820px){.mm-ready-layout{grid-template-columns:1fr!important}}`}</style>
        </>
      )}
    </div>
  )
}
