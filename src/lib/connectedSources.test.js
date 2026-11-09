import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { listDocs, listKitDocs, getKitSelectedDocIds, setDocSelected } from './docs.js'
import {
  MAX_SOURCE_BYTES, normalizeSourceText, previewSelectedSource,
  approveSelectedSource, listApprovedImports, removeApprovedImport,
} from './connectedSources.js'

const local = new Map()
const session = new Map()
function storage(map) {
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    get length() { return map.size },
    key: i => [...map.keys()][i] ?? null,
  }
}
const source = overrides => ({
  provider: 'github', title: 'Architecture', sourceId: 'repo/main/architecture.md',
  text: '# Architecture\nThe interview service is event driven and resilient.',
  accountLabel: 'personal', revision: 'sha-1', selectedByUser: true, ...overrides,
})
beforeEach(() => {
  local.clear(); session.clear(); session.set('mm-active-account-scope', 'alice')
  vi.stubGlobal('localStorage', storage(local))
  vi.stubGlobal('sessionStorage', storage(session))
  vi.stubGlobal('crypto', webcrypto)
})

describe('Track B reviewed import', () => {
  it('allows only explicitly selected, supported nonempty, size-limited text', async () => {
    await expect(previewSelectedSource(source({ selectedByUser: false }))).rejects.toThrow(/Select/)
    await expect(previewSelectedSource(source({ provider: 'mailbox' }))).rejects.toThrow(/Unsupported/)
    await expect(previewSelectedSource(source({ text: 'x'.repeat(MAX_SOURCE_BYTES + 1) }))).rejects.toThrow(/250 KiB/)
    expect(() => normalizeSourceText('bad\u0000text')).toThrow(/control/)
    expect(normalizeSourceText('a\r\nb')).toBe('a\nb')
  })

  it('requires approval, imports unselected and deduplicates exact revision/content', async () => {
    const input = source()
    const preview = await previewSelectedSource(input)
    await expect(approveSelectedSource(preview, input)).rejects.toThrow(/approval/i)
    const first = await approveSelectedSource(preview, input, { approved: true })
    expect(first.existing).toBe(false)
    expect(listDocs()).toHaveLength(1)
    expect(listDocs()[0].selected).toBe(false)
    const again = await approveSelectedSource(preview, input, { approved: true })
    expect(again.existing).toBe(true)
    expect(listDocs()).toHaveLength(1)
    expect(listApprovedImports()).toHaveLength(1)
    expect(listApprovedImports()[0].selectedForLive).toBe(false)
    expect(setDocSelected(first.record.documentId, true).selected).toBe(true)
    expect(listApprovedImports()[0].selectedForLive).toBe(true)
    expect(removeApprovedImport(first.record.id)).toBe(true)
    expect(listDocs()).toHaveLength(0)
    expect(listApprovedImports()).toHaveLength(0)
  })

  it('rejects edits between preview and approval and changes of signed-in account', async () => {
    const input = source()
    const preview = await previewSelectedSource(input)
    await expect(approveSelectedSource(preview, source({ text: 'Edited' }), { approved: true })).rejects.toThrow(/Source changed/)
    session.set('mm-active-account-scope', 'bob')
    await expect(approveSelectedSource(preview, input, { approved: true })).rejects.toThrow(/Account changed/)
    expect(listDocs()).toEqual([])
  })

  it('retains source account isolation and prevents automatic Kit retrieval', async () => {
    const input = source({ kitId: 'kit-1' })
    const preview = await previewSelectedSource(input)
    await approveSelectedSource(preview, input, { approved: true })
    expect(listDocs()).toHaveLength(0)
    expect(listKitDocs('kit-1')).toHaveLength(1)
    expect(getKitSelectedDocIds('kit-1')).toEqual([])
    session.set('mm-active-account-scope', 'bob')
    expect(listApprovedImports()).toEqual([])
    expect(listKitDocs('kit-1')).toEqual([])
    session.set('mm-active-account-scope', 'alice')
    expect(listKitDocs('kit-1')).toHaveLength(1)
  })
})
