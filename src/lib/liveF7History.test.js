import { describe, it, expect } from 'vitest'
import {
  buildF7SeedText,
  f7HasUsableContent,
  upsertF7TranscriptCard,
  appendScreenF7ToConversation,
  captureRejectLabel,
  resolveF7QuestionId,
} from './liveF7History.js'

describe('liveF7History', () => {
  it('builds seed text from coding analysis', () => {
    const t = buildF7SeedText({
      detectedText: 'Two Sum',
      pattern: 'Hash map',
      approach: ['Scan once', 'Store complements'],
      code: 'def two_sum(): pass',
      complexity: 'O(n)',
    })
    expect(t).toContain('Two Sum')
    expect(t).toContain('Hash map')
    expect(t).toContain('def two_sum')
  })

  it('upserts by questionId — reanalyze never duplicates', () => {
    let list = []
    list = upsertF7TranscriptCard(list, {
      questionId: 'sc_1',
      text: 'Two Sum',
      answer: 'v1',
      hint: { fullAnswer: 'v1' },
    })
    list = upsertF7TranscriptCard(list, {
      questionId: 'sc_1',
      text: 'Two Sum',
      answer: 'v2 better',
      hint: { fullAnswer: 'v2 better' },
    })
    expect(list).toHaveLength(1)
    expect(list[0].answer).toBe('v2 better')
    expect(list[0].source).toBe('screen_f7')
  })

  it('upserts by fingerprint when reanalyze mints a new screenContextId', () => {
    let list = upsertF7TranscriptCard([], {
      questionId: 'sc_old',
      fingerprint: 'fp_same',
      text: 'Two Sum',
      answer: 'python',
    })
    list = upsertF7TranscriptCard(list, {
      questionId: 'sc_new',
      fingerprint: 'fp_same',
      text: 'Two Sum',
      answer: 'java',
    })
    expect(list).toHaveLength(1)
    expect(list[0].questionId).toBe('sc_old')
    expect(list[0].answer).toBe('java')
  })

  it('resolveF7QuestionId reuses prior id for same fingerprint', () => {
    expect(resolveF7QuestionId(
      { screenContextId: 'sc_new', fingerprint: 'fp1' },
      { questionId: 'sc_old', fingerprint: 'fp1' },
    )).toBe('sc_old')
    expect(resolveF7QuestionId(
      { screenContextId: 'sc_new', fingerprint: 'fp2' },
      { questionId: 'sc_old', fingerprint: 'fp1' },
    )).toBe('sc_new')
  })

  it('appendScreenF7ToConversation works with empty speechTurns (no candidate)', () => {
    const transcript = [{
      source: 'screen_f7',
      isQuestion: true,
      questionId: 'sc_1',
      text: 'Screen Q',
      answer: 'Solution body',
      hint: { fullAnswer: 'Solution body' },
      ts: 1,
    }]
    const out = appendScreenF7ToConversation([], transcript)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ role: 'interviewer', text: 'Screen Q', source: 'screen_f7' })
    expect(out[1]).toMatchObject({ role: 'hint', text: 'Solution body', source: 'screen_f7' })
  })

  it('appendScreenF7ToConversation keeps F7 when candidate speech exists', () => {
    const conversation = [
      { role: 'interviewer', text: 'Tell me about yourself', ts: 1 },
      { role: 'candidate', text: 'I am a backend engineer', ts: 2 },
    ]
    const transcript = [{
      source: 'screen_f7',
      isQuestion: true,
      questionId: 'sc_9',
      text: 'House Robber',
      answer: 'DP solution',
      hint: { fullAnswer: 'DP solution' },
      ts: 3,
    }]
    const out = appendScreenF7ToConversation(conversation, transcript)
    expect(out.some(t => t.role === 'candidate')).toBe(true)
    expect(out.some(t => t.source === 'screen_f7' && t.role === 'interviewer')).toBe(true)
    expect(out.some(t => t.source === 'screen_f7' && t.role === 'hint')).toBe(true)
  })

  it('append is idempotent', () => {
    const transcript = [{
      source: 'screen_f7', isQuestion: true, questionId: 'sc_1',
      text: 'Q', answer: 'A', hint: { fullAnswer: 'A' }, ts: 1,
    }]
    const once = appendScreenF7ToConversation([], transcript)
    const twice = appendScreenF7ToConversation(once, transcript)
    expect(twice).toHaveLength(2)
  })

  it('f7HasUsableContent rejects errors/empty', () => {
    expect(f7HasUsableContent(null)).toBe(false)
    expect(f7HasUsableContent({ error: 'x', analysis: { detectedText: 'y' } })).toBe(false)
    expect(f7HasUsableContent({ analysis: { detectedText: 'Two Sum', code: 'x' } })).toBe(true)
  })

  it('captureRejectLabel distinguishes system vs mic candidate', () => {
    expect(captureRejectLabel('candidate_speech', { audioSource: 'system' })).toMatch(/System Audio/i)
    expect(captureRejectLabel('candidate_speech', { audioSource: 'microphone' })).toMatch(/sounds like you/i)
  })
})
