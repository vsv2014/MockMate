import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, managedSttGatewayUrl } from './apiClient'
import { deepgramSocketConfig, requestDeepgramToken } from './deepgramTransport'

vi.mock('./apiClient', () => ({
  apiFetch: vi.fn(),
  managedSttGatewayUrl: vi.fn(url => 'wss://managed.mockmate.test/api/stt-stream' + new URL(url).search),
}))

describe('managed Live STT gateway credentials', () => {
  beforeEach(() => vi.resetAllMocks())

  it('does not return a direct Deepgram token in managed mode', async () => {
    apiFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ gateway: true, gateway_ticket: 'private-ticket', expires_in: 30 }),
    })
    const cacheRef = { current: null }
    const response = await requestDeepgramToken({ mode: 'system_audio', cacheRef })
    expect(response.ok).toBe(true)
    expect(response.tokenRes.access_token).toBeUndefined()
    const upstream = 'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1'
    const ws = deepgramSocketConfig(response.tokenRes, upstream)
    expect(managedSttGatewayUrl).toHaveBeenCalledWith(upstream)
    expect(ws.url).toMatch(/^wss:\/\/managed\.mockmate\.test\/api\/stt-stream/)
    expect(ws.protocols).toEqual(['mockmate-stt', 'private-ticket'])
    expect(ws.url).not.toContain('private-ticket')
    expect(cacheRef.current).toBeNull()
  })

  it('never reuses an already-spent one-time gateway ticket', async () => {
    let i = 0
    apiFetch.mockImplementation(async () => ({
      ok: true, status: 200,
      json: async () => ({ gateway: true, gateway_ticket: 'ticket-' + ++i, expires_in: 30 }),
    }))
    const cacheRef = { current: null }
    const a = await requestDeepgramToken({ cacheRef })
    const b = await requestDeepgramToken({ cacheRef })
    expect(a.tokenRes.gateway_ticket).not.toEqual(b.tokenRes.gateway_ticket)
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('preserves local BYOK Deepgram WebSocket authentication', () => {
    expect(deepgramSocketConfig(
      { access_token: 'local-key' },
      'wss://api.deepgram.com/v1/listen?model=nova-2',
    )).toEqual({
      url: 'wss://api.deepgram.com/v1/listen?model=nova-2',
      protocols: ['token', 'local-key'],
    })
  })

  it('does not treat a failed gateway issuance as authenticated', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ gateway: true, gateway_ticket: 'invalid' }) })
    expect((await requestDeepgramToken({})).ok).toBe(false)
    expect(() => deepgramSocketConfig({ gateway: true }, 'wss://api.deepgram.com')).toThrow('ticket missing')
  })
})
