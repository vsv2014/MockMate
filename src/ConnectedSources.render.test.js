import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import ConnectedSources from './ConnectedSources.jsx'
import { AppShell } from './Dashboard.jsx'
import { JourneyHome } from './journey/JourneyScreens.jsx'

describe('Track B Sources & ARCH navigation', () => {
  it('advertises connected accounts and ARCH from the home screen with a working navigation affordance', () => {
    const html = renderToString(React.createElement(JourneyHome, {
      auth: { guest: true }, onOpenSources: () => {}, kits: [], sessions: [],
    }))
    expect(html).toContain('Open Sources &amp; ARCH')
    expect(html).toContain('Connect accounts')
    expect(html).toContain('review imports')
  })
  it('exposes a real workspace entry in desktop navigation', () => {
    const html = renderToString(React.createElement(AppShell, {
      active: 'sources', auth: { guest: true }, stealth: true,
      onNav: () => {}, onStealth: () => {}, onMinimize: () => {}, onClose: () => {},
    }, React.createElement('div', null, 'Sources workspace')))
    expect(html).toContain('aria-label="Sources &amp; ARCH"')
    expect(html).toContain('Sources workspace')
  })
  it('shows manual review, explicit consent and honest OAuth status', () => {
    const html = renderToString(React.createElement(ConnectedSources, { auth: { guest: true } }))
    expect(html).toContain('Connected accounts')
    expect(html).toContain('Sign in to connect accounts')
    expect(html).toContain('Accounts &amp; OAuth')
    expect(html).toContain('ARCH graph')
    expect(html).toContain('Composio SDK and Activepieces workflow automation are not connected')
    expect(html).toContain('Authorize external account')
    expect(html).toContain('Connected accounts')
    expect(html).toContain('ARCH professional evidence graph')
    expect(html).toContain('Import one selected source')
    expect(html).toContain('Preview selected source')
    expect(html).toContain('ARCH professional profile')
    expect(html).toContain('No source imports yet')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })
})
