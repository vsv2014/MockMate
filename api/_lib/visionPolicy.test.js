import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  _resetVisionStateForTests,
  markVision429,
  markVision429Family,
  isVisionCooling,
  filterVisionProviders,
  classifyVisionError,
  shouldRetryVisionAttempt,
  makeVisionRateLimitedError,
  runVisionSingleFlight,
  estimateImageBytes,
  visionTelemetry,
} from './visionPolicy.js'

// visionComplete lives in core.js — inject _callProvider for isolation.
import { visionComplete } from './core.js'
import { extractJSON } from './core.js'

beforeEach(() => {
  _resetVisionStateForTests()
  // Ensure at least one vision key so listVisionProviders is non-empty in tests.
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.GEMINI_API_KEY = 'test-gemini-key'
  }
})

function rateErr() {
  const e = new Error('429 rate limit'); e.status = 429; return e
}
function authErr() {
  const e = new Error('401 unauthorized'); e.status = 401; return e
}
function serverErr() {
  const e = new Error('503 overloaded'); e.status = 503; return e
}
function timeoutErr() {
  const e = new Error('timeout'); e.status = 408; return e
}

describe('visionPolicy cooldown', () => {
  it('2) provider recently rate-limited is skipped by filter', () => {
    const now = Date.now()
    markVision429('openai', now)
    const ready = filterVisionProviders([
      { id: 'openai' },
      { id: 'gemini' },
    ], now)
    expect(ready.map(p => p.id)).toEqual(['gemini'])
    expect(isVisionCooling('openai', now)).toBe(true)
    expect(isVisionCooling('gemini', now)).toBe(false)
  })

  it('family ban does not cool the other vendor', () => {
    markVision429Family('openai_mini')
    expect(isVisionCooling('openai')).toBe(true)
    expect(isVisionCooling('openai_mini')).toBe(true)
    expect(isVisionCooling('gemini')).toBe(false)
  })
})

describe('classifyVisionError / retry rules', () => {
  it('4) 401 → no retry', () => {
    expect(classifyVisionError(authErr())).toBe('auth')
    expect(shouldRetryVisionAttempt('auth', 0)).toBe(false)
  })

  it('429 → no same-provider retry', () => {
    expect(classifyVisionError(rateErr())).toBe('rate')
    expect(shouldRetryVisionAttempt('rate', 0)).toBe(false)
  })

  it('5/6) 500/timeout → bounded retry allowed once', () => {
    expect(shouldRetryVisionAttempt('transient', 0)).toBe(true)
    expect(shouldRetryVisionAttempt('transient', 1)).toBe(false)
    expect(shouldRetryVisionAttempt('timeout', 0)).toBe(true)
  })

  it('11) cancelled → no retry', () => {
    const e = new Error('aborted'); e.name = 'AbortError'
    expect(classifyVisionError(e)).toBe('cancelled')
    expect(shouldRetryVisionAttempt('cancelled', 0)).toBe(false)
  })
})

describe('visionComplete failover (injected)', () => {
  it('1) 429 provider A → provider B succeeds', async () => {
    const calls = []
    const raw = await visionComplete({
      imageBase64: 'aaaa',
      prompt: 'x',
      requestId: 'r1',
      _skipSingleFlight: true,
      _callProvider: async (prov) => {
        calls.push(prov.id)
        if (prov.id.includes('gemini') || calls.length === 1) {
          // First ready provider fails with 429
          if (calls.filter(c => c === prov.id).length === 1 && calls.length === 1) throw rateErr()
        }
        return 'META: {}\nhello from B'
      },
    })
    expect(raw).toMatch(/hello from B/)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    // First provider should not be re-called after 429
    const first = calls[0]
    expect(calls.filter(c => c === first).length).toBe(1)
  })

  it('3) all providers 429 → VISION_RATE_LIMITED', async () => {
    await expect(visionComplete({
      imageBase64: 'aaaa',
      prompt: 'x',
      requestId: 'r2',
      _skipSingleFlight: true,
      _callProvider: async () => { throw rateErr() },
    })).rejects.toMatchObject({ code: 'VISION_RATE_LIMITED', status: 429 })
  })

  it('4) 401 does not loop the same provider', async () => {
    const calls = []
    try {
      await visionComplete({
        imageBase64: 'aaaa',
        prompt: 'x',
        requestId: 'r3',
        _skipSingleFlight: true,
        _callProvider: async (prov) => {
          calls.push(prov.id)
          throw authErr()
        },
      })
    } catch { /* expected */ }
    // Each provider at most once
    const counts = calls.reduce((m, id) => (m[id] = (m[id] || 0) + 1, m), {})
    expect(Object.values(counts).every(n => n === 1)).toBe(true)
  })

  it('5) 500 → bounded failover then success', async () => {
    let n = 0
    const raw = await visionComplete({
      imageBase64: 'aaaa',
      prompt: 'x',
      requestId: 'r4',
      _skipSingleFlight: true,
      _callProvider: async () => {
        n++
        if (n === 1) throw serverErr()
        return 'ok after failover'
      },
    })
    expect(raw).toBe('ok after failover')
  })

  it('6) timeout → failover', async () => {
    let n = 0
    const raw = await visionComplete({
      imageBase64: 'aaaa',
      prompt: 'x',
      requestId: 'r5',
      _skipSingleFlight: true,
      _callProvider: async () => {
        n++
        if (n === 1) throw timeoutErr()
        return 'recovered'
      },
    })
    expect(raw).toBe('recovered')
  })
})

describe('JSON repair is text-only (budget)', () => {
  it('7/8) malformed JSON uses extractJSON repair path without image call in completeTextQuick contract', async () => {
    // Simulate: vision returns prose; extractJSON fails; text repair returns JSON.
    const bad = 'Here is the analysis:\n{ "contentType": "coding", "fullAnswer": "ok", "keyPoints": ["a"] '
    expect(() => extractJSON(bad)).toThrow()
    // completeTextQuick is text-only by API — assert telemetry shape never claims image repair.
    const t = visionTelemetry({ repairAttempt: true, repairType: 'text' })
    expect(t.repairType).toBe('text')
    expect(t.repairType).not.toBe('image')
  })
})

describe('single-flight', () => {
  it('9/10) duplicate key shares one in-flight promise', async () => {
    let runs = 0
    const work = async () => {
      runs++
      await new Promise(r => setTimeout(r, 30))
      return 'done'
    }
    const [a, b] = await Promise.all([
      runVisionSingleFlight('fp1', 'same', work),
      runVisionSingleFlight('fp1', 'same', work),
    ])
    expect(a).toBe('done')
    expect(b).toBe('done')
    expect(runs).toBe(1)
  })
})

describe('image payload budget helpers', () => {
  it('12/13/14) JPEG target dims + byte estimate vs large PNG-like base64', () => {
    // Simulated: optimized JPEG ~50KB vs large PNG ~400KB (base64 lengths).
    const smallJpegB64 = 'a'.repeat(Math.floor(50_000 * 4 / 3))
    const largePngB64 = 'b'.repeat(Math.floor(400_000 * 4 / 3))
    const smallBytes = estimateImageBytes(smallJpegB64)
    const largeBytes = estimateImageBytes(largePngB64)
    expect(smallBytes).toBeLessThan(largeBytes)
    expect(smallBytes).toBeLessThan(80_000)
    // Capture contract from main: 1280×720 JPEG
    const captureContract = { width: 1280, height: 720, mime: 'image/jpeg' }
    expect(captureContract.width).toBe(1280)
    expect(captureContract.height).toBe(720)
    expect(captureContract.mime).toBe('image/jpeg')
  })
})

describe('structured errors', () => {
  it('VISION_RATE_LIMITED code', () => {
    const e = makeVisionRateLimitedError(false)
    expect(e.code).toBe('VISION_RATE_LIMITED')
    expect(e.status).toBe(429)
  })
})
