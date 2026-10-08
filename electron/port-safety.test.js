import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, 'main.cjs'), 'utf8')

describe('Electron local port safety', () => {
  it('never force-kills an unknown process that owns a preferred port', () => {
    expect(source).not.toMatch(/taskkill\s+\/PID/i)
    expect(source).not.toMatch(/fuser\s+-k/i)
    expect(source).not.toMatch(/process\.kill\s*\(/)
    expect(source).not.toMatch(/execSync\s*\(/)
  })

  it('fails closed with EADDRINUSE when a preferred port is occupied', () => {
    expect(source).toContain("error.code = 'EADDRINUSE'")
    expect(source).toContain('is already in use')
    expect(source).toContain('throw error')
  })
})
