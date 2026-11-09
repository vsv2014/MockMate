import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { saveSession } from '../history.js'
import { previewSelectedSource, approveSelectedSource, removeApprovedImport } from './connectedSources.js'
import {
  ARCH_PROFESSIONAL_SCHEMA, loadProfessionalState, updateProfessionalProfile,
  addEvidenceQuote, removeEvidenceForImport, addProfessionalClaim, linkEvidenceToClaim,
  recordProfessionalOutcome, recordApprovedInterviewOutcome, linkOutcomeToClaim, unlinkOutcomeFromClaim, buildProfessionalGraph, buildProfessionalReviewQueue,
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

  it('links approved evidence to existing claims and surfaces deterministic review actions', async () => {
    const preview = await previewSelectedSource(source)
    const { record } = await approveSelectedSource(preview, source, { approved: true })
    const quote = addEvidenceQuote({ importId: record.id, quote: 'reliable offline-first application' }).state.evidence[0]
    const claim = addProfessionalClaim({ key: 'Architecture', value: 'Offline-first' })
    expect(buildProfessionalReviewQueue().some(a => a.id === 'claim:' + claim.id)).toBe(true)
    const linked = linkEvidenceToClaim(claim.id, quote.id)
    expect(linked.claims.find(c => c.id === claim.id).evidenceIds).toContain(quote.id)
    expect(buildProfessionalReviewQueue().some(a => a.id === 'claim:' + claim.id)).toBe(false)
    expect(() => linkEvidenceToClaim(claim.id, 'unknown-evidence')).toThrow(/approved evidence/)
    expect(buildProfessionalGraph(loadProfessionalState(), [{ ...record, revision: 'rev-updated' }]).staleEvidence).toBe(1)
    expect(buildProfessionalReviewQueue(loadProfessionalState(), [{ ...record, revision: 'rev-updated' }])
      .some(a => a.type === 'stale_evidence')).toBe(true)
    expect(buildProfessionalReviewQueue(loadProfessionalState(), [{ ...record, revision: 'rev-updated' }])
      .some(a => a.type === 'unverified_claim')).toBe(true)
  })


  it('imports a user-approved saved interview without inventing a score or duplicating its history link', async () => {
    const saved = saveSession({
      report: { overallScore: 84, summary: 'Practice answers improved with clearer structure.' },
      config: { domainLabel: 'Software Engineer', source: 'solo' },
    })
    expect(saved?.id).toBeTruthy()
    const first = await recordApprovedInterviewOutcome(saved.id)
    expect(first.existing).toBe(false)
    expect(first.outcome.result).toBe('Saved evaluation: 84/100')
    expect(first.outcome.sourceSessionId).toBe(saved.id)
    const repeated = await recordApprovedInterviewOutcome(saved.id)
    expect(repeated.existing).toBe(true)
    expect(loadProfessionalState().outcomes).toHaveLength(1)
    const graph = buildProfessionalGraph()
    expect(graph.edges.some(edge => edge.from === first.outcome.id
      && edge.to === 'interview:' + saved.id && edge.relation === 'recorded_from')).toBe(true)
    session.set('mm-active-account-scope', 'user-b')
    await expect(recordApprovedInterviewOutcome(saved.id)).rejects.toThrow(/unavailable/)
    session.set('mm-active-account-scope', 'user-a')
    const unscored = saveSession({ report: { summary: 'Notes only' }, config: { source: 'live' } })
    const imported = await recordApprovedInterviewOutcome(unscored.id)
    expect(imported.outcome.result).toBe('Unscored')
  })

  it('reviewer links and unlinks a saved outcome without claiming automatic skill verification', () => {
    const claim = addProfessionalClaim({ key: 'System design', value: 'Practice exposure' })
    const outcome = recordProfessionalOutcome({ description: 'Completed a system design practice interview.' })
    expect(buildProfessionalGraph().edges.some(e => e.relation === 'observes')).toBe(false)
    expect(() => linkOutcomeToClaim(outcome.id, 'not-owned')).toThrow(/existing professional claim/)
    const linked = linkOutcomeToClaim(outcome.id, claim.id)
    expect(linked.outcomes.find(x => x.id === outcome.id).claimIds).toContain(claim.id)
    expect(linkOutcomeToClaim(outcome.id, claim.id).outcomes[0].claimIds).toEqual([claim.id])
    expect(buildProfessionalGraph().edges.some(e => e.relation === 'observes' && e.from === outcome.id && e.to === claim.id)).toBe(true)
    expect(loadProfessionalState().claims[0].status).toBe('self_reported')
    const updated = unlinkOutcomeFromClaim(outcome.id, claim.id)
    expect(updated.outcomes[0].claimIds).toEqual([])
    expect(buildProfessionalGraph().edges.some(e => e.relation === 'observes')).toBe(false)
    session.set('mm-active-account-scope', 'user-b')
    expect(() => linkOutcomeToClaim(outcome.id, claim.id)).toThrow(/existing professional claim/)
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
