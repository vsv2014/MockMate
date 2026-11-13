import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createScreenContextRecord, previousScreenForContinuation, screenFingerprint } from '../shared/screenContext.js'

// Exercise the actual async callback without mounting Electron or replacing the
// existing Vitest harness. Its dependencies are the same refs/setters as React.
const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
const callbackSource = appSource.split('const runAnalysis = useCallback(')[1].split('\n  }, [])')[0] + '\n  }'

function analysisHarness(responses) {
  const deps = {
    apiFetch: vi.fn(),
    setScreenAnalyzing: vi.fn(), setScreenAnalysis: vi.fn(), setScreenFlowStatus: vi.fn(),
    analysisAbortRef: { current: null }, analysisGenRef: { current: 0 },
    analysisCacheRef: { current: new Map() }, profileRef: { current: {} },
    screenChainRef: { current: null }, screenUndoRef: { current: null },
    queuedCaptureCountRef: { current: 0 }, liveSpokenQRef: { current: '' },
    screenshotStyle: () => 'balanced', diagnostic: vi.fn(), trackProductEvent: vi.fn(),
    createScreenContextRecord, previousScreenForContinuation, screenFingerprint,
  }
  for (const response of responses) deps.apiFetch.mockResolvedValueOnce({
    ok: response.status === 200, status: response.status, json: async () => response.body,
  })
  const run = new Function(...Object.keys(deps), `const runAnalysis = ${callbackSource}; return runAnalysis`)(...Object.values(deps))
  return { run, ...deps }
}

describe('screenshot analysis busy retry', () => {
  it('retries once with continuation context and preserves the undo screenshot', async () => {
    vi.useFakeTimers()
    try {
      const prior = createScreenContextRecord({ analysis: { contentType: 'coding', detectedText: 'Part one' } })
      const previousShot = { base64: 'YQ==', mime: 'image/png' }
      const h = analysisHarness([
        { status: 503, body: { error: 'Screen analysis is busy right now' } },
        { status: 200, body: { analysis: { contentType: 'coding', detectedText: 'Part one and two', isContinuation: true } } },
      ])
      const pending = h.run({ base64: 'Yg==', mime: 'image/png', previousScreenRecord: prior, previousShot, continuationMode: 'continue' }, 'JavaScript')
      await vi.advanceTimersByTimeAsync(1600)
      await pending
      expect(h.apiFetch).toHaveBeenCalledTimes(2)
      const secondBody = JSON.parse(h.apiFetch.mock.calls[1][1].body)
      expect(secondBody.previousScreen.screenContextId).toBe(prior.screenContextId)
      expect(secondBody.continuationMode).toBe('continue')
      expect(h.screenChainRef.current.error).toBeFalsy()
      expect(h.screenUndoRef.current).toEqual({ record: prior, shot: previousShot })
      expect(h.setScreenAnalyzing).toHaveBeenLastCalledWith(false)
    } finally { vi.useRealTimers() }
  })
})
