// Node-only request context. Correlation IDs are metadata, not identity tokens.
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

const context = new AsyncLocalStorage()
const SAFE_ID = /^[a-zA-Z0-9_-]{1,96}$/
export function requestTraceId(req) {
  const header = String(req?.headers?.['x-mockmate-request-id'] || req?.get?.('X-MockMate-Request-Id') || '')
  return SAFE_ID.test(header) ? header : 'req_' + randomUUID().replace(/-/g, '')
}
export function withRequestTrace(req, callback) {
  const requestId = requestTraceId(req)
  return context.run({ requestId }, callback)
}
export function currentRequestTrace() { return context.getStore() || null }
