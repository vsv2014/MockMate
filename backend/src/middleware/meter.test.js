import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { estimateLlmUnits } from './meter.js'

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
    vi.doMock('../plans.js', async (importOriginal) => {
      const actual = await importOriginal()
      return { ...actual, effectivePlan: user => user?.plan || 'free', limitFor: () => ({ llmCalls: 100 }) }
    })
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
    vi.doMock('../plans.js', async (importOriginal) => {
      const actual = await importOriginal()
      return { ...actual, effectivePlan: user => user?.plan || 'free', limitFor: () => ({ llmCalls: 100 }) }
    })
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
    expect(req.body.maxProviderAttempts).toBe(2)
    expect(req.body.profile.modelStrategy).toBe('fast')
    expect(req.body.profile.targetRole).toBe('QA')
  })

  it('rejects oversized inputs exceeding plan maxInputChars with 413', async () => {
    vi.doMock('../store.js', () => ({
      currentPeriod: () => '2026-08',
      store: () => ({ findUserById: async () => ({ plan: 'free' }), reserveLlmUsage: async () => true }),
    }))
    const { checkCap } = await import('./meter.js')
    const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    let nextCalled = false
    await checkCap({ userId: 'u1', body: { text: 'x'.repeat(90_000) } }, res, () => { nextCalled = true })
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(413)
    expect(res.body?.code).toBe('input_too_large')
  })
})

describe('estimateLlmUnits multi-call paths (blast-radius BR-1)', () => {
  it('grants the +1 unit bonus on real registered routes, including /api/jobs', () => {
    const big = { q: 'x'.repeat(13_000) } // 2 size units
    expect(estimateLlmUnits(big, '/api/jobs')).toBe(3)
    expect(estimateLlmUnits(big, '/api/report')).toBe(3)
    // Non-multi-call routes get size units only
    expect(estimateLlmUnits(big, '/api/hint')).toBe(2)
  })

  it('every MULTI_CALL path exists in the real API routing contract (structural ghost-route guard)', async () => {
    // Derives both sides from PRODUCTION modules — no hardcoded parallel list.
    // If someone re-points metering at a route that is not in the routing
    // contract (the original BR-1 bug: '/api/match-jobs'), this fails.
    vi.resetModules() // ensure we see the real plans.js, not any leaked test mock
    const { MULTI_CALL_PATHS } = await import('../plans.js')
    const { OPERATION_BY_PATH } = await import('../../../api/_lib/apiRoutes.js')
    expect(MULTI_CALL_PATHS.size).toBeGreaterThan(0)
    for (const p of MULTI_CALL_PATHS) {
      expect(OPERATION_BY_PATH[p], `${p} is metered as multi-call but is not a registered route`).toBeDefined()
    }
  })
})
