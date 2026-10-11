import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const localServer = fs.readFileSync(path.join(root, 'server.js'), 'utf8')
const accountServer = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8')

describe('packaged desktop service startup', () => {
  it('uses Electron utility processes instead of respawning MockMate.exe', () => {
    expect(main).toContain('utilityProcess.fork(modulePath')
    expect(main).toContain("'MockMate Local UI and AI'")
    expect(main).toContain("'MockMate Local Account Service'")
  })

  it('supports utility-process readiness messages in both local services', () => {
    expect(localServer).toContain('process.parentPort?.postMessage(message)')
    expect(accountServer).toContain('process.parentPort?.postMessage(message)')
  })

  it('never leaves a blank single instance waiting forever for the UI service', () => {
    expect(main).toContain('did not become ready within 15 seconds')
    expect(main).toContain('apiServer.on(\'exit\'')
    expect(main).toContain("dialog.showErrorBox('MockMate could not start'")
  })
})
