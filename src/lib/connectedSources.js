// Local-first, reviewed source import for ARCH. No OAuth, background sync or Live calls.
// A pasted item is NOT a connected external account; no provider credentials are stored here.
import { activeAccountScope, getScopedItem, setScopedItem } from './accountScope.js'
import { addDoc, listDocs, listKitDocs, removeDoc, removeKitDoc, replaceReviewedImportedDoc } from './docs.js'

export const APPROVED_IMPORTS_KEY = 'mm-arch-approved-imports-v1'
export const MAX_SOURCE_BYTES = 250 * 1024
const MAX_RECORDS = 100
export const SOURCE_TYPES = Object.freeze({
  github: Object.freeze({ label: 'GitHub Markdown', mimeType: 'text/markdown' }),
  googledrive: Object.freeze({ label: 'Google Drive document text', mimeType: 'text/plain' }),
  googlecalendar: Object.freeze({ label: 'Google Calendar event notes', mimeType: 'text/calendar-event' }),
})
const clean = (v, max = 300) => String(v ?? '').trim().slice(0, max)
const fail = message => { throw new Error(message) }

export function normalizeSourceText(value) {
  if (typeof value !== 'string') fail('Source content must be text')
  const text = value.replace(/\r\n?/g, '\n').normalize('NFC')
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail('Unsupported control characters')
  if (!text.trim()) fail('Source text cannot be empty')
  if (new TextEncoder().encode(text).length > MAX_SOURCE_BYTES) fail('Source exceeds 250 KiB')
  return text
}
function sourceFields(input) {
  if (input?.selectedByUser !== true) fail('Select the specific source before previewing')
  const provider = clean(input.provider, 40)
  // A plain-object lookup also resolves inherited names such as __proto__.
  // Only explicitly registered connector providers may be imported.
  const type = Object.hasOwn(SOURCE_TYPES, provider) ? SOURCE_TYPES[provider] : null
  if (!type) fail('Unsupported source type')
  const title = clean(input.title, 180)
  // Keep preview/approval bound to the exact identifier the user selected.
  // Truncating a long ID could silently import a different source.
  if (typeof input.sourceId !== 'string' || input.sourceId.trim().length > 512) fail('Invalid source identifier')
  const sourceId = clean(input.sourceId, 512)
  if (/[\u0000-\u001f\u007f]/.test(sourceId)) fail('Invalid source identifier characters')
  if (!title || !sourceId) fail('A source title and source ID are required')
  return {
    provider, mimeType: type.mimeType, title, sourceId,
    accountLabel: clean(input.accountLabel, 140),
    connectedAccountId: clean(input.connectedAccountId, 200) || null,
    revision: clean(input.revision, 120),
    kitId: clean(input.kitId, 180) || null,
    text: normalizeSourceText(input.text),
  }
}
export async function sha256(text) {
  if (!globalThis.crypto?.subtle?.digest) fail('Secure SHA-256 is unavailable; import stopped')
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
export async function previewSelectedSource(input) {
  const source = sourceFields(input)
  const scope = activeAccountScope()
  const sha = await sha256(source.text)
  if (scope !== activeAccountScope()) fail('Account changed during import preview')
  return Object.freeze({
    ...source, accountScope: scope, sha256: sha,
    sizeBytes: new TextEncoder().encode(source.text).length,
    excerpt: Array.from(source.text).slice(0, 500).join(''),
    selectedByUser: true,
  })
}
const loadRecords = () => {
  try {
    const v = JSON.parse(getScopedItem(APPROVED_IMPORTS_KEY, '[]'))
    return Array.isArray(v) ? v.filter(row => row && row.id && row.documentId).slice(-MAX_RECORDS) : []
  } catch { return [] }
}
const saveRecords = rows => setScopedItem(APPROVED_IMPORTS_KEY, JSON.stringify(rows.slice(-MAX_RECORDS)))
export function listApprovedImports() {
  return loadRecords().map(record => {
    const documents = record.kitId ? listKitDocs(record.kitId) : listDocs()
    const doc = documents.find(item => item.id === record.documentId)
    return { ...record, documentPresent: !!doc, selectedForLive: !!doc && doc.selected !== false }
  })
}

function documentExists(record) {
  const rows = record.kitId ? listKitDocs(record.kitId) : listDocs()
  return rows.some(doc => doc.id === record.documentId)
}
export async function approveSelectedSource(preview, input, { approved = false } = {}) {
  if (!approved) fail('Explicit approval is required before importing')
  const scope = activeAccountScope()
  if (!preview || preview.accountScope !== scope) fail('Account changed since preview')
  const fresh = await previewSelectedSource(input)
  if (activeAccountScope() !== scope) fail('Account changed during import')
  for (const key of ['provider', 'mimeType', 'title', 'sourceId', 'accountLabel', 'connectedAccountId', 'revision', 'kitId', 'sha256']) {
    if (fresh[key] !== preview[key]) fail('Source changed since preview: ' + key)
  }
  const records = loadRecords()
  const old = records.find(row => row.provider === fresh.provider && row.sourceId === fresh.sourceId
    && row.connectedAccountId === fresh.connectedAccountId
    && (fresh.connectedAccountId !== null || row.accountLabel === fresh.accountLabel)
    && row.kitId === fresh.kitId && row.sha256 === fresh.sha256)
  if (old && documentExists(old)) return { record: { ...old }, existing: true }
  const doc = addDoc({
    name: `[${SOURCE_TYPES[fresh.provider].label}] ${fresh.title}`,
    type: fresh.provider === 'googlecalendar' ? 'supporting' : 'knowledge',
    text: fresh.text, source: 'reviewed-import', selected: false, kitId: fresh.kitId,
  })
  if (!doc) fail('Document save failed; check local storage capacity')
  const record = {
    id: `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    provider: fresh.provider, title: fresh.title, sourceId: fresh.sourceId,
    accountLabel: fresh.accountLabel, connectedAccountId: fresh.connectedAccountId,
    revision: fresh.revision,
    mimeType: fresh.mimeType, sha256: fresh.sha256, sizeBytes: fresh.sizeBytes,
    kitId: fresh.kitId, documentId: doc.id, importedAt: new Date().toISOString(),
    selectedForLive: false,
  }
  if (!saveRecords([...records.filter(row => documentExists(row)), record])) {
    if (fresh.kitId) removeKitDoc(fresh.kitId, doc.id)
    else removeDoc(doc.id)
    fail('Import metadata could not be saved; imported document rolled back')
  }
  return { record, existing: false }
}
export function removeApprovedImport(importId) {
  const records = loadRecords()
  const record = records.find(row => row.id === importId)
  if (!record) return false
  if (documentExists(record)) {
    const deleted = record.kitId ? removeKitDoc(record.kitId, record.documentId) : removeDoc(record.documentId)
    if (!deleted) fail('Document could not be deleted; import metadata was preserved')
  }
  if (!saveRecords(records.filter(row => row.id !== importId))) fail('Import metadata could not be updated')
  return true
}

export async function applyApprovedRemoteUpdate(update) {
  if (!update?.importId || !update?.accountId) throw new Error('Connected source identity is required')
  const scope = activeAccountScope()
  const rows = loadRecords()
  const record = rows.find(x => x.id === update.importId)
  if (!record || record.connectedAccountId !== update.accountId
    || record.provider !== update.provider || record.sourceId !== update.sourceId)
    throw new Error('Remote update does not match the approved account and source')
  const current = await previewSelectedSource({
    ...update, accountLabel: record.accountLabel, connectedAccountId: record.connectedAccountId,
    kitId: record.kitId, selectedByUser: true,
  })
  if (current.sha256 !== update.sha256 || scope !== activeAccountScope())
    throw new Error('Remote content changed or account switched during verification')
  if (record.sha256 === current.sha256) return { unchanged: true, record }
  if (!documentExists(record)) throw new Error('Approved import document is missing')
  const updated = replaceReviewedImportedDoc({
    documentId: record.documentId, kitId: record.kitId, text: current.text,
  })
  if (!updated) throw new Error('Could not persist the updated source document')
  const previous = { sha256: record.sha256, revision: record.revision, changedAt: new Date().toISOString() }
  const next = { ...record, sha256: current.sha256, revision: current.revision, sizeBytes: current.sizeBytes,
    lastSyncedAt: new Date().toISOString(), versions: [...(record.versions || []).slice(-9), previous] }
  const newRows = rows.map(x => x.id === record.id ? next : x)
  if (scope !== activeAccountScope() || !saveRecords(newRows))
    throw new Error('Remote text saved but metadata update failed; retry synchronization')
  return { unchanged: false, record: next }
}
