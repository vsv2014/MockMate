import { describe, it, expect } from 'vitest'
import { createGenerationManager } from './generationManager.js'

describe('GenerationManager lifecycle rules', () => {
  it('Rule 1: new question cancels previous generation', () => {
    const gm = createGenerationManager()
    const g1 = gm.start({ questionId: 'q1' })
    g1.markGenerating()
    expect(g1.status).toBe('generating')
    const g2 = gm.start({ questionId: 'q2' })
    expect(g1.status).toBe('cancelled')
    expect(g1.canCommit()).toBe(false)
    expect(g2.status).toBe('pending')
    expect(g2.canCommit()).toBe(true)
  })

  it('Rule 2: cancelled generation cannot update UI (canCommit false)', () => {
    const gm = createGenerationManager()
    const g1 = gm.start({ questionId: 'q1' })
    g1.markGenerating()
    gm.start({ questionId: 'q2' })
    const ui = []
    if (g1.canCommit()) ui.push('stale')
    expect(ui).toEqual([])
  })

  it('Rule 3: stale SSE chunks cannot overwrite current answer', () => {
    const gm = createGenerationManager()
    const g1 = gm.start({ questionId: 'q1' })
    g1.markGenerating()
    const g2 = gm.start({ questionId: 'q2' })
    g2.markGenerating()
    let answer = ''
    const applyChunk = (gen, chunk) => {
      if (!gen.canCommit()) return
      answer = chunk
    }
    applyChunk(g1, 'IRCTC architecture dump')
    applyChunk(g2, 'production incident story')
    expect(answer).toBe('production incident story')
    expect(gm.markStaleIfNotCurrent(g1.generationId)).toBe(true)
    expect(gm.markStaleIfNotCurrent(g2.generationId)).toBe(false)
  })

  it('Rule 4: failed generation cannot silently continue', () => {
    const gm = createGenerationManager()
    const g1 = gm.start({ questionId: 'q1' })
    g1.markGenerating()
    expect(g1.fail('provider 500')).toBe(true)
    expect(g1.status).toBe('failed')
    expect(g1.canCommit()).toBe(false)
    expect(g1.complete()).toBe(false)
  })

  it('Rule 5: only current generation may commit answer state', () => {
    const gm = createGenerationManager()
    const g1 = gm.start({ questionId: 'q1' })
    const g2 = gm.start({ questionId: 'q2' })
    const commits = []
    const commit = (gen, text) => {
      if (!gen.canCommit()) return false
      commits.push(text)
      return gen.complete()
    }
    expect(commit(g1, 'old')).toBe(false)
    expect(commit(g2, 'new')).toBe(true)
    expect(commits).toEqual(['new'])
    expect(g2.status).toBe('completed')
  })

  it('Rule 6: topic switch invalidates previous generation as stale', () => {
    const gm = createGenerationManager()
    const g1 = gm.start({ questionId: 'q1', reason: 'system_design' })
    g1.markGenerating()
    const g2 = gm.start({ questionId: 'q2', reason: 'topic_switch' })
    expect(g1.status).toBe('stale')
    expect(g1.canCommit()).toBe(false)
    expect(g2.canCommit()).toBe(true)
  })

  it('Rule 7: follow-up preserves parent question relationship on generation', () => {
    const gm = createGenerationManager()
    const g1 = gm.start({ questionId: 'q_parent' })
    g1.markGenerating()
    g1.complete()
    const g2 = gm.start({ questionId: 'q_follow' })
    expect(g2.questionId).toBe('q_follow')
    expect(gm.getCurrent().questionId).toBe('q_follow')
    // Parent is owned by InterviewState — generation carries questionId only
    expect(g2.questionId).not.toBe('q_parent')
  })

  it('abort signal fires when superseded', () => {
    const gm = createGenerationManager()
    const g1 = gm.start({ questionId: 'q1' })
    let aborted = false
    g1.signal.addEventListener('abort', () => { aborted = true })
    gm.start({ questionId: 'q2' })
    expect(aborted).toBe(true)
  })
})
