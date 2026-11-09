import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { previewSelectedSource, approveSelectedSource, removeApprovedImport } from './connectedSources.js'
import {
  ARCH_PROFESSIONAL_SCHEMA, loadProfessionalState, updateProfessionalProfile,
  addEvidenceQuote, removeEvidenceForImport, addProfessionalClaim, recordProfessionalOutcome, buildProfessionalGraph,
} from './archProfessional.js'
const local = new Map(), session = new Map()
const store = map => ({
  getItem: k => map.get(k) ?? null,
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: k => map.delete(k),
  get length() { return map.size }, key: i => [...map.keys()][i] ?? null,
})
const source = {
  provider: 'github', title: 'Engineering notes', sourceId: 'repo/notes',
  text: 'Designed a reliable offline-first application with clear user permissions.',
  accountLabel: 'personal', revision: 'rev-a', selectedByUser: true, kitId: null,
}
beforeEach(() => {
  local.clear(); session.clear(); session.set('mm-active-account-scope', 'user-a')
  vi.stubGlobal('localStorage', store(local))
  vi.stubGlobal('sessionStorage', store(session))
  vi.stubGlobal('crypto', webcrypto)
})
describe('Track B ARCH professional evidence', () => {
  it('saves versioned profiles per account without leaking between logins', () => {
    expect(loadProfessionalState().schemaVersion).toBe(ARCH_PROFESSIONAL_SCHEMA)
    const updated = updateProfessionalProfile({ headline: 'Full-stack engineer', goals: 'Prepare for design interview' })
    expect(updated.profile.headline).toBe('Full-stack engineer')
    session.set('mm-active-account-scope', 'user-b')
    expect(loadProfessionalState().profile.headline).toBe('')
    session.set('mm-active-account-scope', 'user-a')
    expect(loadProfessionalState().profile.goals).toContain('design')
  })

  it('projects a provenance graph with claims, outcomes and unresolved conflicts', async () => {
    const preview = await previewSelectedSource(source)
    const { record } = await approveSelectedSource(preview, source, { approved: true })
    const quote = addEvidenceQuote({ importId: record.id, quote: 'reliable offline-first application' }).state.evidence[0]
    const original = addProfessionalClaim({ key: 'Primary framework', value: 'Angular', evidenceIds: [quote.id] })
    addProfessionalClaim({ key: 'Primary framework', value: 'React' })
    recordProfessionalOutcome({ description: 'Completed a mock system design interview.' })
    const graph = buildProfessionalGraph()
    expect(graph.nodes.find(n => n.id === original.id).label).toContain('Angular')
    expect(graph.edges.some(edge => edge.from === original.id && edge.to === quote.id)).toBe(true)
    expect(graph.conflicts).toHaveLength(1)
    expect(graph.nodes.some(node => node.kind === 'outcome')).toBe(true)
  })

  it('requires exact evidence in an approved document and supports provenance deletion', async () => {
    const preview = await previewSelectedSource(source)
    const { record } = await approveSelectedSource(preview, source, { approved: true })
    expect(() => addEvidenceQuote({ importId: record.id, quote: 'invented performance metric' }))
      .toThrow(/verbatim/)
    const quote = 'reliable offline-first application'
    const added = addEvidenceQuote({ importId: record.id, quote })
    expect(added.state.evidence).toHaveLength(1)
    expect(added.state.evidence[0]).toMatchObject({ quote, importId: record.id, sourceRevision: 'rev-a' })
    expect(addEvidenceQuote({ importId: record.id, quote }).existing).toBe(true)
    session.set('mm-active-account-scope', 'user-b')
    expect(loadProfessionalState().evidence).toEqual([])
    session.set('mm-active-account-scope', 'user-a')
    expect(removeApprovedImport(record.id)).toBe(true)
    expect(removeEvidenceForImport(record.id).evidence).toEqual([])
  })
})
