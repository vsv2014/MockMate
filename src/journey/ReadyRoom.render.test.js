import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'

// Provider status never resolves here: this is a render contract test of the
// Ready Room preflight screen, not of the local service.
vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn(() => new Promise(() => {})) }))
vi.mock('../lib/productIntelligence', () => ({ trackProductEvent: vi.fn() }))

const { ReadyRoom } = await import('./JourneyScreens.jsx')
const { normalizeInterviewKit } = await import('../lib/interviewKits')

const kit = normalizeInterviewKit({
  id: 'kit-ready-room-contract',
  title: 'Senior Backend Engineer',
  targetRole: 'Senior Backend Engineer',
  targetCompany: 'Acme',
  resume: 'Backend engineer with 9 years of API and streaming experience.',
})

function renderReadyRoom(overrides = {}) {
  return renderToString(React.createElement(ReadyRoom, {
    kit,
    onOpenKits: () => {},
    onEditKit: () => {},
    onSettings: () => {},
    onContinueLive: () => {},
    onApplyProtection: async () => ({ ok: true }),
    isLinux: false,
    stealth: true,
    ...overrides,
  }))
}

describe('Ready Room (linear preflight)', () => {
  it('keeps the Live action button reachable — it must not sit in a hidden container', () => {
    const html = renderReadyRoom()
    // v1.6.4 shipped the whole action rail inside <aside style="display:none">, which
    // removed the only path from the Ready Room into Live setup.
    expect(html).toContain('data-mm-ready-room-primary="1"')
    expect(html).not.toMatch(/display:\s*none/)
    expect(html).not.toContain('<aside')
  })

  it('keeps the documented linear order: session summary, four checks, readiness, action', () => {
    const html = renderReadyRoom()
    const order = [
      'THIS SESSION',
      'Interview context',
      'AI answer service',
      'Screen-share privacy',
      'LIVE READINESS',
      'data-mm-ready-room-primary="1"',
    ].map(marker => {
      const at = html.indexOf(marker)
      expect(at, `${marker} missing`).toBeGreaterThan(-1)
      return at
    })
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // The primary label depends on live preflight state; the CTA itself never does.
    expect(html).toMatch(/Continue to Live setup|Complete readiness checks|Checking services|Run the AI test|Test (microphone|system audio)|Configure|Add context|Create an Interview Kit|Review Linux risk|privacy check/)
  })

  it('asks for a Kit when none is selected instead of showing a dead action rail', () => {
    const html = renderReadyRoom({ kit: null })
    expect(html).toContain('Open Interview Kits')
    expect(html).not.toContain('data-mm-ready-room-primary="1"')
  })
})
