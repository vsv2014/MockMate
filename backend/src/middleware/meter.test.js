import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Metering fail-closed when MONGO_URI is set (Phase 5).
describe('checkCap fail-closed (hosted)', () => {
  const prev = process.env.MONGO_URI

  beforeEach(() => {
    process.env.MONGO_URI = 'mongodb://test'
    vi.resetModules()
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.MONGO_URI
    else process.env.MONGO_URI = prev
    vi.restoreAllMocks()
  })

  it('returns 503 when store throws (does not allow)', async () => {
    vi.doMock('../store.js', () => ({
      currentPeriod: () => '2026-08',
      store: () => ({
        findUserById: async () => { throw new Error('db down') },
        getUsage: async () => ({ llmCalls: 0 }),
      }),
    }))
    vi.doMock('../plans.js', () => ({ limitFor: () => ({ llmCalls: 100 }) }))
    const { checkCap } = await import('./meter.js')
    const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    let nextCalled = false
    await checkCap({ userId: 'u1' }, res, () => { nextCalled = true })
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(503)
    expect(res.body?.code).toBe('metering_unavailable')
  })

  it('skips caps when MONGO_URI unset (local fork)', async () => {
    delete process.env.MONGO_URI
    vi.resetModules()
    const { checkCap } = await import('./meter.js')
    let nextCalled = false
    const req = { userId: 'u1' }
    await checkCap(req, {}, () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(req._plan).toBe('local')
  })
})
