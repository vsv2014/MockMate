import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { AppShell } from './Dashboard.jsx'

describe('full-window workspace navigation', () => {
  it('reserves a full icon column and keeps labels separate', () => {
    const html = renderToString(React.createElement(AppShell, {
      active: 'ready-room',
      auth: { guest: true },
      stealth: true,
      onNav: () => {},
      onStealth: () => {},
      onMinimize: () => {},
      onClose: () => {},
    }, React.createElement('div', null, 'Content area')))
    expect(html).toContain('aria-label="Ready Room"')
    expect(html).toContain('Interview Kits')
    expect(html).toContain('Content area')
    expect(html).toContain('min-width:30px')
    expect(html).toContain('flex-shrink:0')
    expect(html).not.toContain('width:18px;text-align:center')
  })
})
