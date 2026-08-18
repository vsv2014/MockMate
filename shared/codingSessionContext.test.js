import { describe, expect, it } from 'vitest'
import { selectScreenForTurn, updateCodingSessionContext } from './codingSessionContext.js'

const code = { timestamp: 100, contentType: 'screen_code', analysis: { detectedText: 'Two Sum', code: 'function solve() {}' } }
const page = { timestamp: 200, contentType: 'screen_ui', analysis: { detectedText: 'Dashboard' } }

describe('coding session context', () => {
  it('keeps a coding capture when a later non-code screen is analyzed', () => {
    const saved = updateCodingSessionContext(null, code)
    expect(updateCodingSessionContext(saved, page)).toBe(saved)
  })

  it('restores saved code for language transforms', () => {
    const selected = selectScreenForTurn({
      question: 'Now write it in Python',
      classification: { questionType: 'follow_up', parentType: 'coding' },
      recentScreen: page,
      codingScreen: code,
    })
    expect(selected.analysis.detectedText).toBe('Two Sum')
    expect(selected.restoredFromCodingSession).toBe(true)
  })

  it('does not attach old code to a behavioral question', () => {
    const selected = selectScreenForTurn({
      question: 'Tell me about a conflict at work',
      classification: { questionType: 'behavioral' },
      recentScreen: page,
      codingScreen: code,
    })
    expect(selected).toBe(page)
  })
})
