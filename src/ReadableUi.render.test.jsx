import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('./lib/apiClient', () => ({ apiFetch: vi.fn(() => new Promise(() => {})) }))
import ApiKeysPanel from './ApiKeys.jsx'
import { AuthShell } from './auth/AuthShell.jsx'
import { Field } from './auth/ui.jsx'
import { AppShell } from './Dashboard.jsx'

describe('readable and reachable desktop pages', () => {
  it('uses readable key labels and inputs instead of 12px settings text', () => {
    const html = renderToString(<ApiKeysPanel />)
    expect(html).toContain('font-size:25px')
    expect(html).toContain('font-size:24px')
    expect(html).not.toMatch(/font-size:(?:9|10|11|12|13|14)(?:\.\d+)?px/)
  })
  it('preserves a viewport scroll owner in auth with large fields', () => {
    const html = renderToString(<AuthShell><Field id="test" label="API key" value="" onChange={() => {}} /></AuthShell>)
    expect(html).toContain('overflow:auto')
    expect(html).toContain('font-size:28px')
    expect(html).toContain('font-size:22px')
  })
  it('preserves shell content scrolling and keyboard focus for long settings', () => {
    const html=renderToString(<AppShell active="settings" auth={{guest:true}} onNav={() => {}}><div>Long settings</div></AppShell>)
    expect(html).toContain('class="mm-shell-content mm-nodrag"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('min-height:0;overflow:auto')
    expect(html).toContain('height:100dvh')
  })
})
