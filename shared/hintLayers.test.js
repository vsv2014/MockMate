import { describe, it, expect } from 'vitest'
import { stripHintMeta, glanceLayers, isHintMetaObject, ensureCodingCodeBlock } from './hintLayers.js'

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
