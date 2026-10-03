import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PLAYBOOK_TEMPLATES,
  QUICK_SNIPPETS,
  insertOrUpdateSnippet,
  classifyPlaybookSections,
  loadSavedPlaybooks,
  savePlaybookSlot,
  deletePlaybookSlot,
} from './CustomPromptStudio.jsx'
import { compileCustomInstructions } from '../../shared/customInstructions.js'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: k => {},
  removeItem: k => { store.delete(k) },
})

describe('CustomPromptStudio helpers & compiler integration', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)) },
      removeItem: k => { store.delete(k) },
    })
  })

  it('parses every built-in role template into core + routed sections that compileCustomInstructions routes cleanly', () => {
    for (const tpl of PLAYBOOK_TEMPLATES) {
      const modules = classifyPlaybookSections(tpl.prompt)
      expect(modules.some(m => m.mode === 'core')).toBe(true)
      expect(modules.some(m => m.mode === 'routed')).toBe(true)

      const compiled = compileCustomInstructions(tpl.prompt, {
        question: 'Design a distributed rate limiter and write the algorithm in Python',
        classification: { questionType: 'coding' },
      })
      expect(compiled.text).toContain('VOICE:')
      expect(compiled.text).toContain('TRUTH:')
    }
  })

  it('inserts modular rule snippets without duplicating existing headings', () => {
    const sqlSnippet = QUICK_SNIPPETS.find(s => s.id === 'sql')
    const first = insertOrUpdateSnippet('VOICE: Speak clearly.', sqlSnippet)
    expect(first).toContain('VOICE: Speak clearly.')
    expect(first).toContain('SQL/DATABASE:')

    const second = insertOrUpdateSnippet(first, sqlSnippet)
    expect(second).toBe(first)
  })

  it('saves, updates, and deletes named playbook presets in scoped storage', () => {
    expect(loadSavedPlaybooks()).toEqual([])
    const afterOne = savePlaybookSlot('Stripe Backend', 'VOICE: Direct.\nAPI/BACKEND: Idempotent.')
    expect(afterOne).toHaveLength(1)
    expect(afterOne[0].name).toBe('Stripe Backend')

    const afterUpdate = savePlaybookSlot('stripe backend', 'VOICE: Updated.')
    expect(afterUpdate).toHaveLength(1)
    expect(afterUpdate[0].prompt).toBe('VOICE: Updated.')

    const afterDelete = deletePlaybookSlot(afterUpdate[0].id)
    expect(afterDelete).toEqual([])
  })
})

describe('Anti-Fail Guardrails template (LockedIn autopsy)', () => {
  it('ships every forensic always-on rule', () => {
    const tpl = PLAYBOOK_TEMPLATES.find(t => t.id === 'anti_fail')
    expect(tpl).toBeTruthy()
    for (const key of ['MISHEARD QUESTIONS', 'NOT-ASKED QUESTIONS', 'TRUTH', 'COMPANY CONTEXT', 'SQL/CODING', 'PACING', 'SENIORITY BAND']) {
      expect(tpl.prompt).toContain(`${key}:`)
    }
  })
})
