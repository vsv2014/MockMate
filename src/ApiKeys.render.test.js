import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'

// Provider status never resolves here: this is a render smoke test of the BYOK layout.
vi.mock('./lib/apiClient', () => ({ apiFetch: vi.fn(() => new Promise(() => {})) }))
const { default: ApiKeysPanel } = await import('./ApiKeys.jsx')

describe('ApiKeysPanel (bring your own key)', () => {
  it('shows a routing summary, the saved-key list and one add-key box instead of a field per provider', () => {
    const html = renderToString(React.createElement(ApiKeysPanel))
    expect(html).toContain('Which model answers')
    expect(html).toContain('Saved AI keys')
    expect(html).toContain('Add API key')
    expect(html).toContain('id="mm-add-api-key"')
    expect(html).toContain('id="mm-add-api-key-provider"')
    expect(html).toContain('The key is not sent anywhere to identify it.')
    for (const name of ['Google Gemini', 'Anthropic (Claude)', 'OpenAI', 'Groq', 'Cerebras', 'OpenRouter (multi-model gateway)']) {
      expect(html).toContain(`>${name}</option>`)
    }
    // The old one-input-per-provider stack is gone; Deepgram keeps its own voice field.
    expect(html).not.toContain('id="mm-key-anthropic"')
    expect(html).not.toContain('id="mm-key-google-gemini"')
    expect(html).toContain('id="mm-key-deepgram"')
  })

  it('lays the panel out with the shared design-system container, not Tailwind utilities', () => {
    const html = renderToString(React.createElement(ApiKeysPanel))
    expect(html).toContain('class="mm-content-medium"')
    expect(html).not.toContain('max-w-[1000px]')
  })
})
