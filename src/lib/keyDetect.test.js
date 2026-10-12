import { describe, expect, it } from 'vitest'
import { cleanPastedKey, describeDetection, detectKeyProvider } from './keyDetect.js'

const filler = n => 'A1b2C3d4E5'.repeat(Math.ceil(n / 10)).slice(0, n)

describe('detectKeyProvider (on-device only)', () => {
  it.each([
    [`sk-ant-api03-${filler(80)}`, 'anthropic', 'high'],
    [`sk-proj-${filler(60)}`, 'openai', 'high'],
    [`gsk_${filler(52)}`, 'groq', 'high'],
    [`csk-${filler(48)}`, 'cerebras', 'high'],
    [`AIza${filler(35)}`, 'gemini', 'high'],
    [`sk-${filler(48)}`, 'openai', 'medium'],
    ['0123456789abcdef0123456789abcdef01234567', 'deepgram', 'medium'],
  ])('%s → %s (%s)', (key, providerId, confidence) => {
    const result = detectKeyProvider(key)
    expect(result.providerId).toBe(providerId)
    expect(result.provider?.id).toBe(providerId)
    expect(result.confidence).toBe(confidence)
    expect(result.problem).toBeNull()
  })

  it('recognises keys MockMate cannot use and explains why instead of suggesting a provider', () => {
    const openrouter = detectKeyProvider(`sk-or-v1-${filler(64)}`)
    expect(openrouter).toMatchObject({ providerId: 'openrouter', provider: null, unsupported: true })
    expect(openrouter.problem).toMatch(/OpenRouter/)
    const admin = detectKeyProvider(`sk-ant-admin01-${filler(80)}`)
    expect(admin.providerId).toBe('anthropic')
    expect(admin.problem).toMatch(/Admin key/)
  })

  it('does not guess for unknown formats or text with spaces', () => {
    expect(detectKeyProvider('not-a-real-key')).toMatchObject({ provider: null, confidence: null })
    expect(detectKeyProvider(`sk-ant-api03-${filler(20)} extra`).problem).toMatch(/spaces/)
    expect(detectKeyProvider('   ').value).toBe('')
  })

  it('cleans quotes, whitespace and NAME=value pastes before detecting', () => {
    const key = `gsk_${filler(52)}`
    expect(cleanPastedKey(`  "${key}"\n`)).toBe(key)
    expect(cleanPastedKey(`GROQ_API_KEY=${key}`)).toBe(key)
    expect(detectKeyProvider(`GROQ_API_KEY="${key}"`).providerId).toBe('groq')
  })

  it('describes certain and uncertain detections differently', () => {
    expect(describeDetection(detectKeyProvider(`sk-ant-api03-${filler(80)}`))).toBe('Looks like an Anthropic (Claude) key.')
    expect(describeDetection(detectKeyProvider(`sk-${filler(48)}`))).toMatch(/^Possibly an OpenAI key/)
    expect(describeDetection(detectKeyProvider('mystery-format'))).toMatch(/could not recognise/)
    expect(describeDetection(detectKeyProvider(''))).toBe('')
  })
})
