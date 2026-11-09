import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
import { EventEmitter } from 'node:events'
const require = createRequire(import.meta.url)
const { probeOwnedLoopbackService, makeOwnedLoopbackProbe } = require('./local-service-probe.cjs')
const { attachRequiredServiceLifecycle, waitForOptionalServiceReady } = require('./service-lifecycle.cjs')

async function withHealthServer(reply, task) {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(reply))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try { return await task(port) }
  finally { await new Promise(resolve => server.close(resolve)) }
}
function childStub() {
  const child = new EventEmitter()
  child.pid = process.pid
  child.kill = vi.fn(() => { child._mockMateIntentionalStop = true; return true })
  return child
}

describe('owned loopback startup readiness (offline)', () => {
  it('accepts the expected local UI child only', async () => {
    await withHealthServer({ ok: true, service: 'mockmate-local-ui', pid: process.pid }, async port => {
      expect(await probeOwnedLoopbackService({ port, pid: process.pid, service: 'mockmate-local-ui' })).toBe(true)
      expect(await probeOwnedLoopbackService({ port, pid: process.pid + 1, service: 'mockmate-local-ui' })).toBe(false)
      expect(await probeOwnedLoopbackService({ port, pid: process.pid, service: 'mockmate-backend' })).toBe(false)
    })
  })
  it('does not trust healthy-looking responses or invalid process IDs', async () => {
    await withHealthServer({ ok: false, service: 'mockmate-local-ui', pid: process.pid }, async port => {
      expect(await probeOwnedLoopbackService({ port, pid: process.pid, service: 'mockmate-local-ui' })).toBe(false)
      expect(await probeOwnedLoopbackService({ port, pid: 0, service: 'mockmate-local-ui' })).toBe(false)
    })
    await withHealthServer({ ok: true, service: 'mockmate-backend' }, async port => {
      expect(await probeOwnedLoopbackService({ port, pid: process.pid, service: 'mockmate-backend' })).toBe(false)
    })
  })
  it('tracks the child PID dynamically so an early undefined PID is not trusted', async () => {
    const child = { pid: undefined }
    await withHealthServer({ ok: true, service: 'mockmate-backend', pid: process.pid }, async port => {
      const check = makeOwnedLoopbackProbe(child, { port, service: 'mockmate-backend' })
      expect(await check()).toBe(false)
      child.pid = process.pid
      expect(await check()).toBe(true)
    })
  })
  it('recovers required service from an authenticated process probe without IPC', async () => {
    const child = childStub()
    const onReady = vi.fn()
    const onFatal = vi.fn()
    const state = attachRequiredServiceLifecycle(child, {
      timeoutMs: 2000, probeIntervalMs: 10,
      probeReady: () => true,
      onReady, onFatal,
    })
    try {
      await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce(), { timeout: 1000 })
      expect(onFatal).not.toHaveBeenCalled()
      expect(state.isReady()).toBe(true)
      expect(child.kill).not.toHaveBeenCalled()
    } finally { state.dispose() }
  })
  it('does not recover required service when probe returns false', async () => {
    const child = childStub()
    const onReady = vi.fn()
    const onFatal = vi.fn()
    const state = attachRequiredServiceLifecycle(child, {
      timeoutMs: 80, probeIntervalMs: 10,
      probeReady: () => false,
      onReady, onFatal,
    })
    try {
      await vi.waitFor(() => expect(onFatal).toHaveBeenCalledOnce(), { timeout: 900 })
      expect(onReady).not.toHaveBeenCalled()
      expect(child.kill).toHaveBeenCalledOnce()
    } finally { state.dispose() }
  })
  it('recovers optional account service via a verified probe', async () => {
    const child = childStub()
    const result = await waitForOptionalServiceReady(child, {
      timeoutMs: 1000, probeIntervalMs: 10,
      probeReady: async () => true,
    })
    expect(result.type).toBe('ready')
    expect(result.source).toBe('owned_loopback_probe')
    expect(child.kill).not.toHaveBeenCalled()
  })
  it('preserves child crash diagnostics over a stale positive probe', async () => {
    const child = childStub()
    let resolveProbe
    const waiting = waitForOptionalServiceReady(child, {
      timeoutMs: 1000,
      probeReady: () => new Promise(resolve => { resolveProbe = resolve }),
    })
    await vi.waitFor(() => expect(resolveProbe).toBeTypeOf('function'), { timeout: 500 })
    child.emit('exit', 23)
    resolveProbe(true)
    await expect(waiting).rejects.toThrow(/exited before ready.*23/)
  })
})
