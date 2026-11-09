// ARCH Professional Evidence v1: local, account-scoped, user-curated, provenance-first.
// Never injects evidence automatically into Live; imported text cannot alter interview answers.
import { activeAccountScope, getScopedItem, setScopedItem } from './accountScope.js'
import { listApprovedImports } from './connectedSources.js'

export const ARCH_PROFESSIONAL_KEY = 'mm-arch-professional-v1'
export const ARCH_PROFESSIONAL_SCHEMA = 2
const str = (value, limit) => String(value ?? '').trim().slice(0, limit)
const empty = () => ({
  schemaVersion: ARCH_PROFESSIONAL_SCHEMA,
  profile: { headline: '', targetRoles: '', goals: '' },
  evidence: [], claims: [], outcomes: [], history: [], updatedAt: null,
})
export function normalizeProfessionalState(value) {
  const out = empty()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  out.profile = {
    headline: str(value.profile?.headline, 180),
    targetRoles: str(value.profile?.targetRoles, 300),
    goals: str(value.profile?.goals, 1200),
  }
  if (Array.isArray(value.evidence)) {
    const used = new Set()
    out.evidence = value.evidence.slice(-150).flatMap(raw => {
      const id = str(raw?.id, 110)
      const quote = str(raw?.quote, 900)
      const importId = str(raw?.importId, 110)
      if (!id || !importId || !quote || used.has(id)) return []
      used.add(id)
      return [{
        id, quote, importId, provider: str(raw.provider, 40),
        title: str(raw.title, 180), documentId: str(raw.documentId, 140),
        sourceId: str(raw.sourceId, 512),
        sourceRevision: str(raw.sourceRevision, 120),
        createdAt: str(raw.createdAt, 40),
      }]
    })
  }
  const list = (array, limit = 100) => Array.isArray(array) ? array.slice(-limit) : []
  out.claims = list(value.claims, 120).flatMap(row => {
    if (!row || !row.id || !row.key || !row.value) return []
    return [{
      id: str(row.id, 120), key: str(row.key, 140), value: str(row.value, 400),
      category: str(row.category, 50) || 'skill', status: str(row.status, 40) || 'self_reported',
      evidenceIds: Array.isArray(row.evidenceIds) ? row.evidenceIds.map(id => str(id, 120)).slice(0, 15) : [],
      createdAt: str(row.createdAt, 40), updatedAt: str(row.updatedAt, 40),
    }]
  })
  out.outcomes = list(value.outcomes, 120).flatMap(row => row?.id && row?.description ? [{
    id: str(row.id, 120), description: str(row.description, 900),
    result: str(row.result, 140), eventAt: str(row.eventAt, 40),
    claimIds: Array.isArray(row.claimIds) ? row.claimIds.map(id => str(id, 120)).slice(0, 15) : [],
    createdAt: str(row.createdAt, 40),
  }] : [])
  out.history = list(value.history, 250).flatMap(row => row?.type && row?.at ? [{
    type: str(row.type, 60), id: str(row.id, 120), at: str(row.at, 40),
  }] : [])
  out.updatedAt = str(value.updatedAt, 40) || null
  return out
}
export function loadProfessionalState() {
  try { return normalizeProfessionalState(JSON.parse(getScopedItem(ARCH_PROFESSIONAL_KEY, 'null'))) }
  catch { return empty() }
}
function persist(state) {
  const next = normalizeProfessionalState({ ...state, updatedAt: new Date().toISOString() })
  return setScopedItem(ARCH_PROFESSIONAL_KEY, JSON.stringify(next)) ? next : null
}
export function updateProfessionalProfile(changes = {}) {
  const current = loadProfessionalState()
  return persist({ ...current, profile: { ...current.profile, ...changes } })
}
export function addEvidenceQuote({ importId, quote } = {}) {
  const scope = activeAccountScope()
  const record = listApprovedImports().find(x => x.id === importId)
  if (!record) throw new Error('An approved, existing source is required')
  const q = str(quote, 900)
  if (q.length < 12) throw new Error('Select an exact quote of at least 12 characters')
  const docs = JSON.parse(getScopedItem('mm-docs', '[]'))
  const doc = Array.isArray(docs) && docs.find(row => row?.id === record.documentId
    && (row.kitId || null) === (record.kitId || null) && row.source === 'reviewed-import')
  if (!doc || typeof doc.text !== 'string' || !doc.text.includes(q))
    throw new Error('Quote must appear verbatim in the approved document')
  if (activeAccountScope() !== scope) throw new Error('Account changed while adding evidence')
  const current = loadProfessionalState()
  const prior = current.evidence.find(row => row.importId === importId && row.quote === q)
  if (prior) return { state: current, existing: true }
  const recordEvidence = {
    id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    quote: q, importId,
    provider: record.provider, title: record.title, documentId: record.documentId,
    sourceId: record.sourceId, sourceRevision: record.revision,
    createdAt: new Date().toISOString(),
  }
  const state = persist({ ...current, evidence: [...current.evidence, recordEvidence] })
  if (!state) throw new Error('Could not save evidence')
  return { state, existing: false }
}
export function removeEvidence(id) {
  const current = loadProfessionalState()
  return persist({ ...current, evidence: current.evidence.filter(item => item.id !== id) })
}
export function removeEvidenceForImport(importId) {
  const current = loadProfessionalState()
  const removed = new Set(current.evidence.filter(item => item.importId === importId).map(item => item.id))
  return persist({
    ...current, evidence: current.evidence.filter(item => !removed.has(item.id)),
    claims: current.claims.map(claim => ({ ...claim,
      evidenceIds: claim.evidenceIds.filter(id => !removed.has(id)) })),
    history: [...current.history, { type: 'source_removed', id: importId, at: new Date().toISOString() }],
  })
}

const makeId = prefix => prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9)
const addEvent = (state, type, id) => [...state.history, { type, id, at: new Date().toISOString() }].slice(-250)
export function addProfessionalClaim({ key, value, category = 'skill', evidenceIds = [] } = {}) {
  const current = loadProfessionalState()
  const normalizedKey = str(key, 140), normalizedValue = str(value, 400)
  if (!normalizedKey || !normalizedValue) throw new Error('Claim name and value are required')
  const permittedIds = new Set(current.evidence.map(row => row.id))
  if (!Array.isArray(evidenceIds) || evidenceIds.some(id => !permittedIds.has(id)))
    throw new Error('Claims can only link to existing evidence')
  const claim = {
    id: makeId('claim'), key: normalizedKey, value: normalizedValue, category: str(category, 50),
    status: evidenceIds.length ? 'evidence_linked' : 'self_reported',
    evidenceIds: [...new Set(evidenceIds)].slice(0, 15),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  const next = persist({ ...current, claims: [...current.claims, claim],
    history: addEvent(current, 'claim_added', claim.id) })
  if (!next) throw new Error('Unable to save claim')
  return claim
}
export function removeProfessionalClaim(id) {
  const current = loadProfessionalState()
  return persist({ ...current, claims: current.claims.filter(row => row.id !== id),
    history: addEvent(current, 'claim_removed', id) })
}
export function recordProfessionalOutcome({ description, result = '', eventAt = '', claimIds = [] } = {}) {
  const current = loadProfessionalState()
  const text = str(description, 900)
  if (text.length < 10) throw new Error('Provide an outcome description')
  const permitted = new Set(current.claims.map(row => row.id))
  if (!Array.isArray(claimIds) || claimIds.some(id => !permitted.has(id))) throw new Error('Unknown claim reference')
  const row = {
    id: makeId('outcome'), description: text, result: str(result, 140),
    eventAt: eventAt && Number.isFinite(Date.parse(eventAt)) ? new Date(eventAt).toISOString() : new Date().toISOString(),
    claimIds: [...new Set(claimIds)].slice(0, 15), createdAt: new Date().toISOString(),
  }
  const next = persist({ ...current, outcomes: [...current.outcomes, row],
    history: addEvent(current, 'outcome_added', row.id) })
  if (!next) throw new Error('Unable to save outcome')
  return row
}
export function removeProfessionalOutcome(id) {
  const current = loadProfessionalState()
  return persist({ ...current, outcomes: current.outcomes.filter(row => row.id !== id),
    history: addEvent(current, 'outcome_removed', id) })
}

// Read-only projection: never infer candidate capabilities or resolve contradictions
// from an LLM. Conflicting self-reported facts appear as explicit conflicts.
export function buildProfessionalGraph(state = loadProfessionalState(), imports = listApprovedImports()) {
  const nodes = [{ id: 'professional', kind: 'professional', label: state.profile.headline || 'Professional profile' }]
  const edges = []
  const importMap = new Map(imports.map(row => [row.id, row]))
  for (const item of imports) {
    nodes.push({ id: 'src:' + item.id, kind: 'source', label: item.title, provider: item.provider,
      revision: item.revision, connectedAccountId: item.connectedAccountId })
  }
  const docs = (() => { try { return JSON.parse(getScopedItem('mm-docs', '[]')) } catch { return [] } })()
  for (const item of state.evidence) {
    const src = importMap.get(item.importId)
    const doc = Array.isArray(docs) && docs.find(row => row?.id === item.documentId)
    const stale = !src || !doc || !String(doc.text || '').includes(item.quote)
    nodes.push({ id: item.id, kind: 'evidence', label: item.quote, stale, sourceId: item.sourceId,
      revision: item.sourceRevision })
    if (src) edges.push({ from: item.id, to: 'src:' + item.importId, relation: 'quoted_from' })
  }
  for (const claim of state.claims) {
    nodes.push({ id: claim.id, kind: 'claim', label: claim.key + ': ' + claim.value,
      status: claim.status, category: claim.category })
    edges.push({ from: 'professional', to: claim.id, relation: 'claims' })
    for (const id of claim.evidenceIds) if (state.evidence.some(ev => ev.id === id))
      edges.push({ from: claim.id, to: id, relation: 'supported_by' })
  }
  const goals = state.profile.targetRoles.split(/[,\n;]/).map(s => s.trim()).filter(Boolean).slice(0, 20)
  for (let i = 0; i < goals.length; i++) {
    const id = 'goal:' + i
    nodes.push({ id, kind: 'goal', label: goals[i] })
    edges.push({ from: 'professional', to: id, relation: 'targets' })
  }
  for (const outcome of state.outcomes) {
    nodes.push({ id: outcome.id, kind: 'outcome', label: outcome.description, result: outcome.result,
      eventAt: outcome.eventAt, provenance: 'user_recorded' })
    edges.push({ from: 'professional', to: outcome.id, relation: 'recorded' })
    for (const id of outcome.claimIds) if (state.claims.some(claim => claim.id === id))
      edges.push({ from: outcome.id, to: id, relation: 'observes' })
  }
  const conflicts = []
  const byKey = new Map()
  for (const claim of state.claims) {
    const key = claim.category.toLowerCase() + ':' + claim.key.toLowerCase()
    const prior = byKey.get(key) || []
    for (const earlier of prior) {
      if (earlier.value.toLowerCase() !== claim.value.toLowerCase()) {
        conflicts.push({ a: earlier.id, b: claim.id, key: claim.key })
        edges.push({ from: earlier.id, to: claim.id, relation: 'conflicts_with' })
      }
    }
    byKey.set(key, [...prior, claim])
  }
  return { schemaVersion: 2, nodes, edges, conflicts,
    staleEvidence: nodes.filter(row => row.kind === 'evidence' && row.stale).length,
    updatedAt: state.updatedAt }
}
