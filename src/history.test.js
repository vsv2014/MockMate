import { describe, it, expect } from 'vitest'
import { transcriptToText } from './history.js'

describe('transcriptToText labels', () => {
  it('distinguishes SCREEN / HINT / INTERVIEWER / YOU', () => {
    const text = transcriptToText([
      { role: 'interviewer', text: 'Tell me about yourself' },
      { role: 'candidate', text: 'I am an engineer' },
      { role: 'interviewer', text: 'Two Sum', source: 'screen_f7' },
      { role: 'hint', text: 'Use a hash map', source: 'screen_f7' },
      { role: 'hint', text: 'Spoken tip from Live' },
    ])
    expect(text).toContain('INTERVIEWER: Tell me about yourself')
    expect(text).toContain('YOU: I am an engineer')
    expect(text).toContain('SCREEN: Two Sum')
    expect(text).toContain('SCREEN: Use a hash map')
    expect(text).toContain('HINT: Spoken tip from Live')
  })
})
