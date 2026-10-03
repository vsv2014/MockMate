import { describe, it, expect } from 'vitest'
import express from 'express'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { registerApiRoutes, API_ROUTE_CONTRACT, isProviderFailureError } from './apiRoutes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function registeredRoutes(app) {
  const out = []
  for (const layer of app._router?.stack || []) {
    if (!layer.route) continue
    const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m])
    for (const method of methods) out.push({ method: method.toUpperCase(), path: layer.route.path })
  }
  return out
}

describe('API route contract', () => {
  it('registerApiRoutes mounts every contracted route', () => {
    const app = express()
    registerApiRoutes(app)
    const routes = registeredRoutes(app)
    for (const expected of API_ROUTE_CONTRACT) {
      const found = routes.some(r => r.method === expected.method && r.path === expected.path)
      expect(found, `${expected.method} ${expected.path}`).toBe(true)
    }
  })

  it('includes GET /api/models (BYOK model picker)', () => {
    expect(API_ROUTE_CONTRACT.some(r => r.method === 'GET' && r.path === '/api/models')).toBe(true)
  })

  it('local server.js uses registerApiRoutes (no divergent inline copy)', () => {
    const serverPath = path.join(__dirname, '..', '..', 'server.js')
    const src = readFileSync(serverPath, 'utf8')
    expect(src).toMatch(/registerApiRoutes\s*\(/)
    expect(src).not.toMatch(/app\.get\(['"]\/api\/providers['"]/)
    expect(src).toMatch(/from ['"]\.\/api\/_lib\/apiRoutes\.js['"]/)
  })

  it('isProviderFailureError ignores client disconnects/aborts and 400 validation errors while counting real provider errors', () => {
    const ac = new AbortController()
    ac.abort()
    expect(isProviderFailureError(new Error('any'), { signal: ac.signal })).toBe(false)
    expect(isProviderFailureError(new Error('closed'), { closed: true })).toBe(false)
    const abortErr = Object.assign(new Error('Aborted'), { name: 'AbortError' })
    expect(isProviderFailureError(abortErr)).toBe(false)
    const validationErr = Object.assign(new Error('No screenshot'), { status: 400, code: 'SCREEN_EMPTY' })
    expect(isProviderFailureError(validationErr)).toBe(false)

    const rateErr = Object.assign(new Error('Rate limit'), { status: 429 })
    expect(isProviderFailureError(rateErr)).toBe(true)
    const upstreamErr = Object.assign(new Error('Provider 503'), { status: 503 })
    expect(isProviderFailureError(upstreamErr)).toBe(true)
  })
})
