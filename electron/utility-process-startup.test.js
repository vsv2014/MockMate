import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const localServer = fs.readFileSync(path.join(root, 'server.js'), 'utf8')
const accountServer = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8')
const require = createRequire(import.meta.url)
const { attachRequiredServiceLifecycle, waitForOptionalServiceReady } = require('./service-lifecycle.cjs')

function fakeService() {
  const child = new EventEmitter()
  child.killCount = 0
  child.kill = () => {
    child.killCount += 1
    child._mockMateIntentionalStop = true
  }
  return child
}

describe('packaged desktop service startup', () => {
  it('uses Electron utility processes instead of respawning MockMate.exe', () => {
    expect(main).toContain('utilityProcess.fork(modulePath')
    expect(main).toContain("'MockMate Local UI and AI'")
    expect(main).toContain("'MockMate Local Account Service'")
    expect(main).toContain("typeof utilityProcess?.fork !== 'function'")
  })

  it('supports utility-process readiness messages in both local services', () => {
    expect(localServer).toContain('process.parentPort?.postMessage(message)')
    expect(accountServer).toContain('process.parentPort?.postMessage(message)')
  })

  it('never leaves a blank single instance waiting forever for the UI service', () => {
    expect(main).toContain('did not become ready within 15 seconds')
    expect(main).toContain('attachRequiredServiceLifecycle(service')
    expect(main).toContain("dialog.showErrorBox('MockMate could not start'")
    expect(main).toContain("dialog.showErrorBox('MockMate could not load'")
    expect(main).toContain("app.quit()")
  })

  it('treats an unexpected post-ready service exit as fatal', () => {
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
    expect(events).toEqual(['ready', 'after ready 9'])
  })

  it('ignores an intentional service exit during restart or app shutdown', () => {
    const child = fakeService()
    const events = []
    attachRequiredServiceLifecycle(child, {
      timeoutMs: 1000,
      timeoutMessage: 'timeout',
      exitBeforeReadyMessage: () => 'before ready',
      exitAfterReadyMessage: () => 'after ready',
      serverErrorMessage: message => message.message,
      onReady: () => events.push('ready'),
      onFatal: error => events.push(error.message),
    })

    child.emit('message', { type: 'ready' })
    child.kill()
    child.emit('exit', 0)
    expect(events).toEqual(['ready'])
  })

  it('kills an optional backend that times out before readiness', async () => {
    vi.useFakeTimers()
    try {
      const child = fakeService()
      const waiting = waitForOptionalServiceReady(child, {
        timeoutMs: 10_000,
        timeoutMessage: 'backend timeout',
        serverErrorMessage: message => message.message,
      })
      const assertion = expect(waiting).rejects.toThrow('backend timeout')
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
      expect(child.killCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
