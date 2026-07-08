import React, { useState, useEffect } from 'react'
import { T } from './auth/tokens'
import changelog from '../CHANGELOG.md?raw'

// "What's New" — shows the latest CHANGELOG section once per version, on first open after an update.
// Version is injected by Vite (__APP_VERSION__); the seen-version is remembered in localStorage.

const VERSION = (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) || '0.0.0'
const SEEN_KEY = 'mm-seen-version'

// Pull the first "## vX …" block out of the changelog and turn it into a title + flat list of
// { header?, items[] } groups (### subheadings + their "- " bullets). Best-effort, never throws.
function parseLatest(md) {
  try {
    const blocks = md.split(/\n## /).slice(1)          // drop the "# Changelog" preamble
    if (!blocks.length) return null
    const lines = ('## ' + blocks[0]).split('\n')
    const title = lines[0].replace(/^##\s*/, '').trim() // "v1.4.2 — 2026-07-08"
    const groups = []
    let cur = { header: null, items: [] }
    for (const raw of lines.slice(1)) {
      const l = raw.trim()
      if (l.startsWith('### ')) { if (cur.items.length) groups.push(cur); cur = { header: l.replace(/^###\s*/, ''), items: [] } }
      else if (l.startsWith('- ')) cur.items.push(l.slice(2))
    }
    if (cur.items.length) groups.push(cur)
    return { title, groups }
  } catch { return null }
}

// Strip **bold** markers to plain text (keep it simple — no full markdown renderer).
const clean = s => s.replace(/\*\*(.+?)\*\*/g, '$1')

export default function WhatsNew({ openSignal = 0 }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(SEEN_KEY) !== VERSION } catch { return false }
  })
  // Re-open on demand (e.g. a "What's new" button in Settings bumps openSignal).
  useEffect(() => { if (openSignal > 0) setOpen(true) }, [openSignal])
  const data = open ? parseLatest(changelog) : null
  if (!open || !data) return null

  const dismiss = () => { try { localStorage.setItem(SEEN_KEY, VERSION) } catch {} ; setOpen(false) }

  return (
    <div onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 100001, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '80vh', overflowY: 'auto', background: T.surface1, border: `1px solid ${T.border}`, borderRadius: T.rCard, boxShadow: '0 24px 60px rgba(0,0,0,0.5)', fontFamily: T.font }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, background: T.surface1 }}>
          <span style={{ fontSize: 18 }}>🎉</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.text1 }}>What's new</div>
            <div style={{ fontSize: 11.5, color: T.text3 }}>{data.title}</div>
          </div>
          <button onClick={dismiss} aria-label="Close" style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.text2, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: '14px 18px' }}>
          {data.groups.map((g, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              {g.header && <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: '#5eead4', textTransform: 'uppercase', marginBottom: 6 }}>{g.header}</div>}
              {g.items.map((it, j) => (
                <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 5, fontSize: 12.5, color: T.text2, lineHeight: 1.5 }}>
                  <span style={{ color: T.accentFrom, flexShrink: 0 }}>•</span><span>{clean(it)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${T.border}`, position: 'sticky', bottom: 0, background: T.surface1 }}>
          <button onClick={dismiss} style={{ width: '100%', height: 40, background: T.accent, color: '#fff', border: 'none', borderRadius: T.rCtrl, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>Got it</button>
        </div>
      </div>
    </div>
  )
}
