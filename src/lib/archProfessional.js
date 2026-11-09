// ARCH Professional Evidence v1: local, account-scoped, user-curated, provenance-first.
// Never injects evidence automatically into Live; imported text cannot alter interview answers.
import { activeAccountScope, getScopedItem, setScopedItem } from './accountScope.js'
import { listApprovedImports } from './connectedSources.js'

export const ARCH_PROFESSIONAL_KEY = 'mm-arch-professional-v1'
export const ARCH_PROFESSIONAL_SCHEMA = 1
const str = (value, limit) => String(value ?? '').trim().slice(0, limit)
const empty = () => ({
  schemaVersion: ARCH_PROFESSIONAL_SCHEMA,
  profile: { headline: '', targetRoles: '', goals: '' },
  evidence: [], updatedAt: null,
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
  return persist({ ...current, evidence: current.evidence.filter(item => item.importId !== importId) })
}
