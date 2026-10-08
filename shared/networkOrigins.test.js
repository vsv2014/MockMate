import { describe, expect, it } from 'vitest'
import { websocketOriginForApi } from './networkOrigins.js'

describe('managed STT packaged-electron CSP origins', () => {
  it('permits hosted WSS alongside HTTPS managed API fetches', () => {
    expect(websocketOriginForApi('https://api.mockmate.example.com/managed/api')).toBe('wss://api.mockmate.example.com')
    expect(websocketOriginForApi('https://api.mockmate.example.com:444')).toBe('wss://api.mockmate.example.com:444')
  })
  it('permits only local loopback WS in development', () => {
    expect(websocketOriginForApi('http://127.0.0.1:4000')).toBe('ws://127.0.0.1:4000')
    expect(websocketOriginForApi('http://localhost:4000')).toBe('ws://localhost:4000')
  })
  it('refuses insecure remote schemes, embedded credentials, and invalid URLs', () => {
    expect(websocketOriginForApi('http://public.mockmate.example.com')).toBeNull()
    expect(websocketOriginForApi('https://user:pass@api.mockmate.example.com')).toBeNull()
    expect(websocketOriginForApi('data:audio/wav;base64,AAAA')).toBeNull()
    expect(websocketOriginForApi('')).toBeNull()
  })
})
