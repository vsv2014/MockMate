import { describe, it, expect, vi, afterEach } from 'vitest'
import { publicProxyDisabled } from './publicProxyGuard.js'
afterEach(() => vi.unstubAllEnvs())
function response() { return { status: vi.fn().mockReturnThis(), json: vi.fn() } }
describe('standalone public proxy opt-in', () => {
  it('does not block local execution', () => {
    vi.stubEnv('VERCEL', ''); vi.stubEnv('MOCKMATE_ALLOW_PUBLIC_API', '')
    const res = response(); expect(publicProxyDisabled(res)).toBe(false); expect(res.status).not.toHaveBeenCalled()
  })
  it('blocks deployed proxies unless exact opt-in is supplied', () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('MOCKMATE_ALLOW_PUBLIC_API', 'true')
    const res = response(); expect(publicProxyDisabled(res)).toBe(true); expect(res.status).toHaveBeenCalledWith(403)
  })
  it('permits explicit private-testing opt-in', () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('MOCKMATE_ALLOW_PUBLIC_API', '1')
    expect(publicProxyDisabled(response())).toBe(false)
  })
})
