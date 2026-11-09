import { describe, expect, it, vi } from 'vitest'

vi.mock('./_lib/publicProxyGuard.js', () => ({ publicProxyDisabled: () => false }))
vi.mock('./_lib/core.js', () => ({
  availableProviders: () => [{ id: 'groq', label: 'Groq · GPT-OSS 120B' }],
  allProviders: () => [{ id: 'groq', configured: true }],
  deepgramConfigured: () => true,
  searchConfigured: () => false,
  listModels: async () => [],
  getModelDiscoveryStatus: () => ({ discoveredProviders: [] }),
  describeAutomaticRouting: () => ({
    fast: { id: 'groq', model: 'openai/gpt-oss-120b', label: 'Groq GPT-OSS 120B' },
    strong: { id: 'groq', model: 'openai/gpt-oss-120b', label: 'Groq GPT-OSS 120B' },
  }),
}))

import handler from './providers.js'

describe('providers settings route', () => {
  it('returns explicit current routing for quick and coding/design answers', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
    await handler({ method: 'GET', query: {} }, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      providers: [{ id: 'groq', label: 'Groq · GPT-OSS 120B' }],
      routing: {
        fast: { id: 'groq', model: 'openai/gpt-oss-120b', label: 'Groq GPT-OSS 120B' },
        strong: { id: 'groq', model: 'openai/gpt-oss-120b', label: 'Groq GPT-OSS 120B' },
      },
    }))
  })
})
