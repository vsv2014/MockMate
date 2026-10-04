import { describe, it, expect } from 'vitest'
import { stripHintMeta, glanceLayers, isHintMetaObject, ensureCodingCodeBlock, sanitizeSpokenProse } from './hintLayers.js'

describe('stripHintMeta', () => {
  it('strips META: line + keeps prose', () => {
    const raw = 'META: {"type":"technical","confidence":"general","pattern":null,"complexity":null,"watch":"Start with the full form."}\nSo, GPT stands for Generative Pre-trained Transformer.'
    const { meta, prose, pending } = stripHintMeta(raw)
    expect(pending).toBe(false)
    expect(meta.type).toBe('technical')
    expect(prose).toMatch(/^So, GPT/)
    expect(prose).not.toMatch(/\{/)
  })

  it('strips bare leading JSON meta (no META: label)', () => {
    const raw = '{"type":"technical","confidence":"general","pattern":null,"complexity":null,"watch":"x"}\nIdempotency means the same request twice has the same effect.'
    const { meta, prose } = stripHintMeta(raw)
    expect(meta.type).toBe('technical')
    expect(prose).toMatch(/^Idempotency/)
    expect(prose).not.toContain('"type"')
  })

  it('strips {"META":{...}} wrappers and trailing duplicates', () => {
    const raw = '{"META": {"type": "technical", "confidence": "general", "pattern": null, "complexity": null, "watch": "x"}}\nConcept: Idempotency means once.\n{"type":"technical","confidence":"general","pattern":null,"complexity":null,"watch":"x"}'
    const { prose } = stripHintMeta(raw)
    expect(prose).toMatch(/Concept: Idempotency/)
    expect(prose).not.toMatch(/"type"/)
  })

  it('pending while leading JSON incomplete', () => {
    const { pending, prose } = stripHintMeta('{"type":"technical","confidence":')
    expect(pending).toBe(true)
    expect(prose).toBe('')
  })
})

describe('glanceLayers after leak', () => {
  it('does not use JSON as opener', () => {
    const leaked = '{"type":"dsa","confidence":"general","pattern":"null","complexity":"null","watch":"Keep short."} When creating a resource with POST, use an idempotency key.'
    const layers = glanceLayers(leaked, {})
    expect(layers.opener.startsWith('{')).toBe(false)
    expect(layers.fullAnswer).not.toContain('"type"')
    expect(layers.opener).toMatch(/When creating|idempotency/i)
  })
})

describe('isHintMetaObject', () => {
  it('detects META and type/confidence shapes', () => {
    expect(isHintMetaObject({ type: 'technical', confidence: 'general' })).toBe(true)
    expect(isHintMetaObject({ META: { type: 'dsa' } })).toBe(true)
    expect(isHintMetaObject({ foo: 1 })).toBe(false)
  })
})

describe('ensureCodingCodeBlock', () => {
  it('wraps loose Playwright JavaScript as a fenced code block', () => {
    const raw = 'Use locators and auto-waiting.\n\njavascript\nawait page.goto("https://amazon.com");\nconst item = page.locator(".result").first();\nawait item.click();'
    const out = ensureCodingCodeBlock(raw, 'coding')
    expect(out).toContain('```js\nawait page.goto')
    expect(out).toContain('\n```')
    expect(out).not.toContain('\njavascript\n')
  })

  it('does not format ordinary technical prose as code', () => {
    expect(ensureCodingCodeBlock('JWT is a signed token.', 'technical')).toBe('JWT is a signed token.')
  })
})

describe('sanitizeSpokenProse (Artemis-style streaming output guardrail)', () => {
  it('strips robotic AI preambles and rewrites banned AI-tell words in spoken prose', () => {
    const raw = "Sure! Here's how I would answer that: We utilized Redis streams to delve into backpressure issues."
    const out = sanitizeSpokenProse(raw)
    expect(out).toBe('We used Redis streams to dig into backpressure issues.')
    const layers = glanceLayers(raw)
    expect(layers.opener).toBe('We used Redis streams to dig into backpressure issues.')
  })

  it('never alters identifiers inside fenced code blocks', () => {
    const raw = 'Certainly! Use a helper.\n\n```js\nfunction utilizeCache() { return true }\n```'
    const out = sanitizeSpokenProse(raw)
    expect(out).toMatch(/^Use a helper\./)
    expect(out).toContain('function utilizeCache()')
  })

  it('LP-20: strips bracketed placeholders like "[X] years" from spoken prose', () => {
    const raw = "I've had my current vehicle for about [X] years, so roughly [Y] years now."
    const out = sanitizeSpokenProse(raw)
    expect(out).not.toContain('[')
    expect(out).not.toContain(']')
    expect(out).toBe("I've had my current vehicle for about years, so roughly years now.")
  })

  it('LP-20: strips coach prefixes (SAY:/THINK:/IF HE GOES DEEPER:) from spoken prose', () => {
    const raw = 'SAY: Yes, I would bucket by language first.\nTHINK: He may push on sorting.\nIF HE GOES DEEPER: mention bucket counts.'
    const out = sanitizeSpokenProse(raw)
    expect(out).not.toMatch(/SAY:/i)
    expect(out).not.toMatch(/THINK:/i)
    expect(out).not.toMatch(/IF HE GOES DEEPER:/i)
    expect(out).toContain('bucket by language first')
  })

  it('LP-20: preserves brackets inside fenced code blocks', () => {
    const raw = 'Here is the sort.\n\n```ts\nconst a: string[] = [x];\n```'
    const out = sanitizeSpokenProse(raw)
    expect(out).toContain('const a: string[] = [x];')
  })
})
