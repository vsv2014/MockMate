import { describe, it, expect } from 'vitest'
import {
  redactInteractionEvent,
  createRageClickDetector,
  summarizeProductIntelligence,
} from './productIntelligence.js'

describe('ARCH Product Intelligence (privacy-first behavioral telemetry)', () => {
  it('aggressively strips resumes, transcripts, prompts, API keys, passwords, screenshots, and audio', () => {
    const raw = {
      ts: 1700000000000,
      action: 'live_started',
      view: 'companion',
      resume: 'Senior Staff Engineer at Acme Corp',
      transcript: 'Tell me about a time you scaled a distributed database',
      prompt: 'VOICE: Lead with metrics',
      fullAnswer: 'At Acme I sharded Postgres...',
      apiKey: 'sk-proj-1234567890abcdef',
      password: 'hunter2-secret-password',
      screenshot: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      audioData: 'PCM16_BYTES',
      target: 'start_live_btn sk-1234567890abcdef',
      ttftMs: 420,
      ok: true,
    }

    const clean = redactInteractionEvent(raw)
    expect(clean).toEqual({
      ts: 1700000000000,
      action: 'live_started',
      view: 'companion',
      target: 'start_live_btn_redacted',
      ttftMs: 420,
      ok: true,
    })
    expect(JSON.stringify(clean)).not.toMatch(/Acme|Postgres|sk-|hunter2|base64|PCM16/i)
  })

  it('detects repeated rage clicks on the same UI target within the time window', () => {
    const detect = createRageClickDetector({ threshold: 3, windowMs: 1500 })
    expect(detect('start-live-cta', 1000)).toBeNull()
    expect(detect('start-live-cta', 1400)).toBeNull()
    const burst = detect('start-live-cta', 1900)
    expect(burst).toEqual({
      action: 'rage_click',
      target: 'start-live-cta',
      clicks: 3,
      ts: 1900,
    })
  })

  it('summarizes funnels, preflight drop-off, and overlay-resize-before-Alt+T sequences', () => {
    const events = [
      // Session 1: stalls at preflight + rage clicks start button
      { sessionId: 's1', ts: 1000, action: 'login' },
      { sessionId: 's1', ts: 2000, action: 'live_setup' },
      { sessionId: 's1', ts: 3000, action: 'preflight_failed', reason: 'share_unverified' },
      { sessionId: 's1', ts: 3500, action: 'rage_click', target: 'start_live_btn', clicks: 4 },

      // Session 2: completes Live flow, resizes overlay before Alt+T, uses playbook
      { sessionId: 's2', ts: 10000, action: 'login' },
      { sessionId: 's2', ts: 11000, action: 'live_setup' },
      { sessionId: 's2', ts: 11500, action: 'playbook_template_applied', templateId: 'swe-coding' },
      { sessionId: 's2', ts: 12000, action: 'preflight_verified' },
      { sessionId: 's2', ts: 13000, action: 'live_started' },
      { sessionId: 's2', ts: 14000, action: 'overlay_resize', edge: 'se' },
      { sessionId: 's2', ts: 15000, action: 'teleprompter_toggle', teleprompter: true },
      { sessionId: 's2', ts: 16000, action: 'first_hint_rendered', ttftMs: 680 },
      { sessionId: 's2', ts: 180000, action: 'live_ended', durationMs: 167000 },

      // Session 3: completes preflight + Live, but slow TTFT (>3.5s) leads to early abandon (<90s)
      { sessionId: 's3', ts: 300000, action: 'live_setup' },
      { sessionId: 's3', ts: 301000, action: 'preflight_verified' },
      { sessionId: 's3', ts: 302000, action: 'live_started' },
      { sessionId: 's3', ts: 306500, action: 'first_hint_rendered', ttftMs: 4200 },
      { sessionId: 's3', ts: 340000, action: 'live_ended', durationMs: 38000 },
    ]

    const report = summarizeProductIntelligence(events)
    expect(report.totalSessions).toBe(3)
    expect(report.funnels.live_interview.entryCount).toBe(3)

    const headlineTexts = report.headlineInsights.map(h => h.text)
    expect(headlineTexts.some(t => /33% of Live setup attempts stall or fail at Live preflight/i.test(t))).toBe(true)
    expect(headlineTexts.some(t => /Users resize the overlay before using Alt\+T teleprompter in 100%/i.test(t))).toBe(true)
    expect(headlineTexts.some(t => /100% of sessions with slow first-token latency/i.test(t))).toBe(true)
    expect(headlineTexts.some(t => /Repeated click friction detected on "start_live_btn"/i.test(t))).toBe(true)
    expect(report.privacyContract.excludedData).toContain('resumes')
    expect(report.privacyContract.optInReplay).toBe(false)
  })
})
