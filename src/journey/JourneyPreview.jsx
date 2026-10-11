import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell } from '../Dashboard'
import { JourneyHome, InterviewKitsScreen, ReadyRoom } from './JourneyScreens'
import { createInterviewKit } from '../lib/interviewKits'
import { T } from '../auth/tokens'
import '../fonts.css'
import '../styles.css'

const starterKit = createInterviewKit({
  name: 'Alex Morgan',
  targetRole: 'Senior Platform Engineer',
  targetCompany: 'Northstar',
  yearsExp: '6 years · Senior',
  interviewType: 'System Design',
  resume: 'Platform engineer with six years building reliable developer infrastructure. Led a migration that reduced deploy time by 42% and improved service ownership across 18 teams.',
  jobDescription: 'Northstar is hiring a Senior Platform Engineer to design resilient internal platforms, improve deployment safety, and partner with product teams on cloud infrastructure.',
  customPrompt: 'Probe platform reliability, deployment tradeoffs, and how I measured adoption.',
}, { id: 'preview-platform-kit', title: 'Platform Engineer · Northstar' })

const sampleSessions = [{
  id: 'preview-session-01',
  ts: Date.now() - 1000 * 60 * 60 * 24,
  label: 'Platform Engineer · Northstar',
  mode: 'solo',
  score: 84,
  kitSnapshot: { name: 'Platform Engineer · Northstar' },
}]

function JourneyPreview() {
  const [view, setView] = useState('home')
  const [kits, setKits] = useState([starterKit])
  const [activeKitId, setActiveKitId] = useState(starterKit.id)
  const activeKit = kits.find(kit => kit.id === activeKitId) || kits[0] || null
  const auth = { guest: true, user: { name: 'Alex Morgan' }, signIn: () => {} }

  const activateKit = id => {
    if (kits.some(kit => kit.id === id)) setActiveKitId(id)
  }
  const createKit = () => {
    const kit = createInterviewKit({}, { title: 'New interview kit' })
    setKits(current => [kit, ...current])
    setActiveKitId(kit.id)
    return kit.id
  }
  const saveKit = value => {
    setKits(current => current.map(kit => kit.id === value.id ? { ...kit, ...value } : kit))
    return true
  }
  const deleteKit = id => {
    const remaining = kits.filter(kit => kit.id !== id)
    setKits(remaining)
    setActiveKitId(current => current === id ? (remaining[0]?.id || null) : current)
  }
  const openReadyRoom = kit => {
    if (kit?.id) activateKit(kit.id)
    setView('ready-room')
  }
  const nav = destination => setView(destination === 'companion' ? 'ready-room' : destination)

  let content
  if (view === 'home') content = (
    <JourneyHome
      auth={auth}
      sessions={sampleSessions}
      kits={kits}
      activeKit={activeKit}
      onSelectKit={activateKit}
      onOpenKits={() => setView('kits')}
      onOpenReadyRoom={() => openReadyRoom(activeKit)}
      onStartPractice={() => setView('practice-preview')}
      onOpenHistory={() => setView('history-preview')}
      onSettings={() => setView('settings-preview')}
    />
  )
  else if (view === 'kits') content = (
    <InterviewKitsScreen
      key={activeKit?.id || 'no-active-kit'}
      kits={kits}
      activeKitId={activeKit?.id || null}
      onCreate={createKit}
      onSave={saveKit}
      onDelete={deleteKit}
      onActivate={activateKit}
      onOpenReadyRoom={kit => openReadyRoom(kit || activeKit)}
    />
  )
  else if (view === 'ready-room') content = (
    <ReadyRoom
      key={activeKit?.id || 'no-active-kit'}
      kit={activeKit}
      onOpenKits={() => setView('kits')}
      onEditKit={kit => { if (kit?.id) activateKit(kit.id); setView('kits') }}
      onSettings={() => setView('settings-preview')}
      onContinueLive={() => setView('live-handoff-preview')}
      isLinux={false}
      stealth
      previewMode
    />
  )
  else content = (
    <section style={{ maxWidth: 720, margin: '30px auto', padding: 24, border: `1px solid ${T.border}`, borderRadius: T.rCard, background: T.surface1 }}>
      <div style={{ color: T.accentFrom, fontSize: 10, fontWeight: 750, letterSpacing: '0.12em', textTransform: 'uppercase' }}>DESIGN PREVIEW</div>
      <h1 style={{ color: T.text1, font: `600 24px ${T.fontDisplay}`, margin: '9px 0' }}>{view === 'practice-preview' ? 'Solo Practice handoff' : view === 'live-handoff-preview' ? 'Live setup handoff' : view === 'history-preview' ? 'Session history' : 'Settings'}</h1>
      <p style={{ color: T.text2, fontSize: 13, lineHeight: 1.6, margin: '0 0 16px' }}>
        This preview is focused on Home, Interview Kits, and Ready Room. The actual practice, settings, and Live setup continue through MockMate’s existing app flows.
      </p>
      <button type="button" onClick={() => setView(view === 'live-handoff-preview' ? 'ready-room' : 'home')} style={{ minHeight: 38, padding: '0 14px', border: `1px solid ${T.borderStrong}`, borderRadius: T.rCtrl, color: T.text1, background: T.surface2, cursor: 'pointer', font: `600 12.5px ${T.font}` }}>{view === 'live-handoff-preview' ? '← Back to Ready Room' : '← Back to Home'}</button>
    </section>
  )

  return (
    <AppShell active={view} onNav={nav} auth={auth} meetingActive={false} stealth onStealth={() => {}} onMinimize={() => {}} onClose={() => {}}>
      <div role="note" style={{ maxWidth: 1080, margin: '0 auto 16px', padding: '8px 11px', borderRadius: 9, border: '1px solid rgba(245,158,11,0.24)', background: 'rgba(245,158,11,0.07)', color: '#fcd34d', fontSize: 10.5, lineHeight: 1.45 }}>
        INTERACTIVE DESIGN PREVIEW · Sample Kit/session data only · no data is saved · AI, microphone, and OS-capture tests are disabled.
      </div>
      {content}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(<JourneyPreview />)
