import { describe, expect, it } from 'vitest'
import { compileCustomInstructions, parseCustomInstructionSections } from './customInstructions.js'

const LONG_PLAYBOOK = `YOU ARE MY REAL-TIME INTERVIEW COPILOT.

VOICE:Answer the literal ask first. Keep normal answers short.

TRUTH:Never invent experience, ownership, metrics, scale, tools, or timelines.

${'BACKGROUND:' + 'This is deliberately irrelevant filler. '.repeat(90)}

ARCHITECTURE:Start with requirements, then use only components the problem justifies.

SQL SUPPORT:Read the exact schema and ask. Give simple correct SQL first. Use HAVING for aggregate filters.

PYTHON SUPPORT:If Python is requested, use simple runnable Python.

CODING/DSA:Approach, runnable code, complexity, then a short dry run.

UNKNOWN:Say I have not used it directly, then bridge to verified experience.

FINAL SILENT RULE:Fetch the correct source, answer the literal ask, then stop.`

describe('custom interview playbook compiler', () => {
  it('parses named sections while retaining the preamble', () => {
    const sections = parseCustomInstructionSections(LONG_PLAYBOOK)
    expect(sections.map(s => s.title)).toEqual(expect.arrayContaining([
      'PREAMBLE', 'VOICE', 'TRUTH', 'SQL SUPPORT', 'PYTHON SUPPORT', 'CODING/DSA', 'UNKNOWN', 'FINAL SILENT RULE',
    ]))
  })

  it('keeps core rules and routes a late SQL section instead of prefix truncating', () => {
    const compiled = compileCustomInstructions(LONG_PLAYBOOK, {
      question: 'Write a SQL query for the third highest salary in each department',
      classification: { questionType: 'technical', roleFamily: 'software_engineering' },
    })
    expect(compiled.text).toMatch(/Never invent experience/)
    expect(compiled.text).toMatch(/SQL SUPPORT:.*HAVING/s)
    expect(compiled.text).toMatch(/answer the literal ask/i)
    expect(compiled.text).not.toMatch(/PYTHON SUPPORT/)
    expect(compiled.text).not.toMatch(/ARCHITECTURE/)
    expect(compiled.omittedSections).toContain('PYTHON SUPPORT')
  })

  it('routes coding and requested-language sections together', () => {
    const compiled = compileCustomInstructions(LONG_PLAYBOOK, {
      question: 'Code this in Python and include complexity',
      classification: { questionType: 'dsa', roleFamily: 'software_engineering' },
    })
    expect(compiled.text).toMatch(/CODING\/DSA/)
    expect(compiled.text).toMatch(/PYTHON SUPPORT/)
    expect(compiled.text).not.toMatch(/SQL SUPPORT/)
  })

  it('keeps ordinary unstructured instructions backward compatible', () => {
    const compiled = compileCustomInstructions('Sound casual, confident, and brief.', {
      question: 'What is eventual consistency?',
    })
    expect(compiled.text).toBe('Sound casual, confident, and brief.')
  })
})
