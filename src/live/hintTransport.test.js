import { describe, it, expect } from 'vitest'
import { splitSseBuffer } from './hintTransport.js'

describe('splitSseBuffer', () => {
  it('parses complete SSE events and leaves a partial rest', () => {
    const { events, rest } = splitSseBuffer(
      'event: meta\ndata: {"type":"behavioral"}\n\nevent: token\ndata: "Hello"\n\nevent: token\ndata: " wor',
    )
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event: 'meta', data: { type: 'behavioral' } })
    expect(events[1]).toMatchObject({ event: 'token', data: 'Hello' })
    expect(rest).toContain('event: token')
  })

  it('returns empty events when buffer has no delimiter', () => {
    const { events, rest } = splitSseBuffer('event: meta\ndata: {')
    expect(events).toHaveLength(0)
    expect(rest.startsWith('event: meta')).toBe(true)
  })
})
