#!/usr/bin/env node
/**
 * Phase 6 — lightweight soak / metrics harness (no LLM spend by default).
 *
 * Simulates a Live session metrics lifecycle + optional memory sample loop.
 * Usage:
 *   node scripts/soak-metrics.mjs
 *   SOAK_MS=60000 node scripts/soak-metrics.mjs
 */
import { createSessionMetrics } from '../src/lib/sessionMetrics.js'

const soakMs = Number(process.env.SOAK_MS || 5000)
const tickMs = 250
const m = createSessionMetrics('soak')
const mem0 = process.memoryUsage().heapUsed
let ticks = 0

const t0 = Date.now()
while (Date.now() - t0 < soakMs) {
  ticks++
  if (ticks % 4 === 0) m.markSttReconnect()
  const h = m.startHint()
  // Simulate stream TTFT ~40–120ms then completion.
  await new Promise(r => setTimeout(r, 40 + (ticks % 3) * 40))
  m.markFirstToken(h)
  if (ticks % 11 === 0) m.markFallback()
  if (ticks % 17 === 0) m.markIncomplete()
  await new Promise(r => setTimeout(r, tickMs))
}

const summary = m.end({ soakMs, ticks })
const mem1 = process.memoryUsage().heapUsed
const deltaMb = ((mem1 - mem0) / (1024 * 1024)).toFixed(2)

console.log(JSON.stringify({ ok: true, summary, heapDeltaMb: Number(deltaMb), ticks }, null, 2))

if (!summary.hints || summary.ttftAvgMs == null) {
  console.error('Soak failed: missing TTFT summary')
  process.exit(1)
}
