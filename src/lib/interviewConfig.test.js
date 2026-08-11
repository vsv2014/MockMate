import { describe, it, expect } from 'vitest'
import { buildInterviewConfig, CUSTOM_INSTRUCTIONS_STORE_MAX } from './interviewConfig.js'

describe('buildInterviewConfig', () => {
  it('snapshots profile + selected ids without inventing fields', () => {
    const cfg = buildInterviewConfig({
      profile: {
        name: 'Ada',
        targetRole: 'SWE',
        targetCompany: 'Acme',
        resume: 'Built APIs',
        jobDescription: 'Need Go',
        customPrompt: 'Be concise',
      },
      selectedDocumentIds: ['d1', 'd1', 'd2'],
      source: 'live',
    })
    expect(cfg.source).toBe('live')
    expect(cfg.candidateName).toBe('Ada')
    expect(cfg.targetRole).toBe('SWE')
    expect(cfg.selectedDocumentIds).toEqual(['d1', 'd2'])
    expect(cfg.resumeText).toBe('Built APIs')
    expect(cfg.jobDescriptionText).toBe('Need Go')
    expect(cfg.customInstructions).toBe('Be concise')
    expect(cfg.createdAt).toMatch(/^\d{4}-/)
  })

  it('caps stored custom instructions', () => {
    const long = 'x'.repeat(CUSTOM_INSTRUCTIONS_STORE_MAX + 500)
    const cfg = buildInterviewConfig({ profile: { customPrompt: long }, selectedDocumentIds: [] })
    expect(cfg.customInstructions.length).toBe(CUSTOM_INSTRUCTIONS_STORE_MAX)
  })
})
