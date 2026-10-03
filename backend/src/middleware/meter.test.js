import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
      store: () => ({ findUserById: async () => { throw new Error('db down') } }),
    }))
    vi.doMock('../plans.js', () => ({
      effectivePlan: user => user?.plan || 'free',
      limitFor: () => ({ llmCalls: 100 }),
    }))
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

  it('reserves usage atomically and pins the reservation period', async () => {
    const reserve = vi.fn(async () => true)
    vi.doMock('../store.js', () => ({
      currentPeriod: () => '2026-08',
      store: () => ({ findUserById: async () => ({ plan: 'pro' }), reserveLlmUsage: reserve }),
    }))
    vi.doMock('../plans.js', () => ({
      effectivePlan: user => user?.plan || 'free',
      limitFor: () => ({ llmCalls: 100 }),
    }))
    const { checkCap } = await import('./meter.js')
    const req = { userId: 'u1' }
    let nextCalled = false
    await checkCap(req, {}, () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(req._llmReserved).toBe(true)
    expect(req._llmPeriod).toBe('2026-08')
    expect(reserve).toHaveBeenCalledWith('u1', '2026-08', 100)
  })

  it('enforces server-owned strategy and removes explicit provider selection', async () => {
    const { enforceManagedModelPolicy } = await import('./meter.js')
    const req = { _plan: 'free', body: { provider: 'gpt_56_sol', profile: { modelStrategy: 'quality', targetRole: 'QA' } } }
    enforceManagedModelPolicy(req, {}, () => {})
    expect(req.body.provider).toBe('')
    expect(req.body.profile.modelStrategy).toBe('fast')
    expect(req.body.profile.targetRole).toBe('QA')
  })
})
