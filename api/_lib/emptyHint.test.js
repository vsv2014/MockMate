import { describe, it, expect, vi } from 'vitest'
import express from 'express'
const { hint } = vi.hoisted(() => ({ hint: vi.fn() }))
vi.mock('./interview.js', async importOriginal => ({ ...await importOriginal(), streamHint: hint }))
import { registerApiRoutes } from './apiRoutes.js'

describe('Electron/managed hint SSE terminal events', () => {
  it.each([
    [{ emptyOutput: true, skipped: false }, 'error', false],
    [{ skipped: true }, 'skip', true],
    [{ skipped: false }, 'done', false],
  ])('surfaces %j with the correct terminal event', async (result, event, released) => {
    hint.mockResolvedValue(result)
    const consume = vi.fn(), release = vi.fn()
    const app = express(); app.use(express.json())
    registerApiRoutes(app, { onLlm: consume, onLlmFailure: release })
    const server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/hint-stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Explain RAG' }) })
      const body = await response.text()
      expect(body).toContain(`event: ${event}\n`)
      if (result.emptyOutput) { expect(body).toContain('empty_output'); expect(body).not.toContain('event: done') }
      expect(released ? release : consume).toHaveBeenCalledOnce()
    } finally { await new Promise(resolve => server.close(resolve)) }
  })
})
