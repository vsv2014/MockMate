import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const uiServer = fs.readFileSync(path.join(root, 'server.js'), 'utf8')
const accountServer = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8')
const require = createRequire(import.meta.url)
const {
  attachRequiredServiceLifecycle,
  waitForOptionalServiceReady,
  classifyRendererLoadFailure,
} = require('./service-lifecycle.cjs')

function fakeService() {
  const child = new EventEmitter()
  child.killCount = 0
  child.kill = () => {
    child.killCount += 1
    child._mockMateIntentionalStop = true
  }
  return child
}

describe('Windows/local desktop service lifecycle', () => {
  it('uses a packaged utility process and keeps child_process.fork for development', () => {
    expect(main).toContain('utilityProcess.fork(modulePath')
    expect(main).toContain('service = fork(modulePath')
    expect(main).toContain("'MockMate Local UI and AI'")
    expect(main).toContain("'MockMate Local Account Service'")
    expect(main).toContain("typeof utilityProcess?.fork !== 'function'")
  })

  it('routes ready/error/diagnostic IPC through either Node fork or Electron parentPort', () => {
    expect(uiServer).toContain("process.parentPort?.postMessage(message)")
    expect(accountServer).toContain("process.parentPort?.postMessage(message)")
    expect(main).toContain('onDiagnostic: row => diagnostics?.ingest(row)')
  })

  it('does not spawn a local service after shutdown begins during an async port probe', () => {
    expect(main).toContain("ensurePortFree(3002, 'API').then(() => {\n    // The port probe is async; do not spawn a child after app shutdown has begun.\n    if (quitDrainStarted) return")
    expect(main).toContain("return ensurePortFree(port, 'backend').then(() => {\n    // The port probe is async; do not spawn a child after app shutdown has begun.\n    if (quitDrainStarted) return { type: 'stopped' }")
    expect(main).toContain("if (quitDrainStarted) return\n    const message = e?.message || 'The local API port could not be prepared.'")
  })

  it('makes a terminal renderer-load failure quit instead of retaining the single-instance lock', () => {
    expect(main).toContain('classifyRendererLoadFailure(rendererLoadFailures, code, isMainFrame)')
    expect(main).toContain("diag('renderer', 'load_failed_exhausted'")
    expect(main).toContain("dialog.showErrorBox('MockMate could not load'")
    expect(main).toContain('app.quit()')

    expect(classifyRendererLoadFailure(0, -3, true)).toEqual({ action: 'ignore', attempts: 0 })
    expect(classifyRendererLoadFailure(2, -105, false)).toEqual({ action: 'ignore', attempts: 2 })
    expect(classifyRendererLoadFailure(4, -105, true)).toEqual({ action: 'retry', attempts: 5, delayMs: 2500 })
    expect(classifyRendererLoadFailure(5, -105, true)).toEqual({ action: 'fatal', attempts: 6 })
  })

  it('turns an unexpected post-ready UI-service exit into one fatal action', () => {
    const child = fakeService()
    const events = []
    attachRequiredServiceLifecycle(child, {
      timeoutMs: 1000,
      timeoutMessage: 'timeout',
      exitBeforeReadyMessage: () => 'before ready',
      exitAfterReadyMessage: code => `after ready ${code}`,
      serverErrorMessage: message => message.message,
      onReady: () => events.push('ready'),
      onFatal: error => events.push(error.message),
    })

    child.emit('message', { type: 'ready' })
    child.emit('exit', 9)
    child.emit('exit', 10)
    expect(events).toEqual(['ready', 'after ready 9'])
    expect(child.killCount).toBe(1)
  })

  it('kills a required UI service that never becomes ready', async () => {
    vi.useFakeTimers()
    try {
      const child = fakeService()
      const onFatal = vi.fn()
      attachRequiredServiceLifecycle(child, {
        timeoutMs: 15_000,
        timeoutMessage: 'UI timeout',
        onFatal,
      })
      await vi.advanceTimersByTimeAsync(15_000)
      expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ message: 'UI timeout' }))
      expect(child.killCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not treat an intentional pre-ready shutdown as a startup failure', async () => {
    vi.useFakeTimers()
    try {
      const child = fakeService()
      const onFatal = vi.fn()
      attachRequiredServiceLifecycle(child, { timeoutMs: 15_000, onFatal })
      child.kill()
      child.emit('exit', 0)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(onFatal).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('kills and rejects an optional account service that times out before readiness', async () => {
    vi.useFakeTimers()
    try {
      const child = fakeService()
      const waiting = waitForOptionalServiceReady(child, {
        timeoutMs: 10_000,
        timeoutMessage: 'account timeout',
        serverErrorMessage: message => message.message,
      })
      const assertion = expect(waiting).rejects.toThrow('account timeout')
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
      expect(child.killCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('kills an optional account service after an explicit startup error', async () => {
    const child = fakeService()
    const waiting = waitForOptionalServiceReady(child, {
      timeoutMs: 10_000,
      serverErrorMessage: message => message.message,
    })
    const assertion = expect(waiting).rejects.toThrow('port already in use')
    child.emit('message', { type: 'server-error', message: 'port already in use' })
    await assertion
    expect(child.killCount).toBe(1)
  })

  it('settles an optional account startup wait when shutdown is intentional', async () => {
    const child = fakeService()
    const waiting = waitForOptionalServiceReady(child, { timeoutMs: 60_000 })
    child.kill()
    child.emit('exit', 0)
    await expect(waiting).resolves.toEqual({ type: 'stopped' })
  })
})
