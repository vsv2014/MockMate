import { describe, it, expect } from 'vitest'
import { splitSseBuffer } from './hintTransport.js'

describe('SSE line endings', () => {
  it.each(['\n', '\r\n', '\r'])('parses %j-delimited events', ending => {
    const frame = ['event: delta', 'data: {"text":"hello"}', '', ''].join(ending)
    const parsed = splitSseBuffer(frame)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0].event).toBe('delta')
    expect(parsed.events[0].data).toEqual({ text: 'hello' })
    expect(parsed.rest).toBe('')
  })
})
