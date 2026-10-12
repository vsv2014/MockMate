import React, { useEffect, useRef, useState } from 'react'
import { T } from './auth/tokens'
import {
  listDocs, listKitDocs, addDoc, removeDoc, removeKitDoc, inferDocType,
  setDocSelected, setKitDocSelected, setDocType, setKitDocType,
  DOC_TYPES, DOC_TYPE_LABELS,
} from './lib/docs'
import { extractPdfText, MAX_LOCAL_PDF_BYTES } from './pdf'

const MAX_LOCAL_TEXT_BYTES = 10 * 1024 * 1024

/**
 * Documents panel — RAG library.
 * @param {{ hideBioTypes?: boolean, onLibraryChange?: (docs: object[]) => void, kitId?: string|null }} props
 */
export default function Documents({ hideBioTypes = false, onLibraryChange, kitId = null } = {}) {
  const [docs, setDocs] = useState(() => kitId ? listKitDocs(kitId) : listDocs())
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const readControllerRef = useRef(null)
  useEffect(() => () => { try { readControllerRef.current?.abort() } catch {} }, [])

  const refresh = () => {
    const next = kitId ? listKitDocs(kitId) : listDocs()
    setDocs(next)
    onLibraryChange?.(next)
  }

  useEffect(() => {
    const next = kitId ? listKitDocs(kitId) : listDocs()
    setDocs(next)
    onLibraryChange?.(next)
    setMsg('')
  }, [kitId])

  const visible = hideBioTypes ? docs.filter(d => d.type !== 'resume' && d.type !== 'jd') : docs
  const selectedCount = visible.filter(d => d.selected !== false).length

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (Number(file.size || 0) > MAX_LOCAL_TEXT_BYTES) {
      setMsg(`⚠ File is too large. Choose a document under ${Math.round(MAX_LOCAL_TEXT_BYTES / 1024 / 1024)} MB.`)
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    try { readControllerRef.current?.abort() } catch {}
    const controller = new AbortController(); readControllerRef.current = controller
    setBusy(true); setMsg('Reading…')
    try {
      const text = /\.pdf$/i.test(file.name)
        ? await extractPdfText(file, { signal: controller.signal, maxBytes: MAX_LOCAL_PDF_BYTES })
        : await file.text()
      if (controller.signal.aborted) return
      if (text && text.trim().length > 20) {
        let type = inferDocType(file.name)
        if (hideBioTypes && (type === 'resume' || type === 'jd')) type = kitId ? 'supporting' : 'document'
        const added = addDoc({ name: file.name, type, text, selected: true, source: 'upload', kitId })
        if (!added) throw new Error('Could not save the document. Local storage may be full.')
        refresh()
        setMsg(`✓ Added as ${DOC_TYPE_LABELS[type] || type} — ${text.length.toLocaleString()} chars.${added.retrievalCoverage === 'representative' ? ' Long file: representative sections across the document will be indexed.' : ''} Set the category if wrong.`)
      } else setMsg('⚠ Could not read text from that file (scanned PDF?) — paste text instead.')
    } catch (err) {
      if (err?.name !== 'AbortError') setMsg('⚠ ' + (err.message || 'Failed to read file'))
    } finally {
      if (readControllerRef.current === controller) readControllerRef.current = null
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function del(id) {
    if (!window.confirm('Remove this document?')) return
    const removed = kitId ? removeKitDoc(kitId, id) : removeDoc(id)
    if (!removed) { setMsg('⚠ Could not remove the document from local storage.'); return }
    refresh(); setMsg('')
  }
  function toggle(id, selected) {
    if (kitId) setKitDocSelected(kitId, id, selected)
    else setDocSelected(id, selected)
    refresh()
  }
  function changeType(id, type) {
    if (kitId) setKitDocType(kitId, id, type)
    else setDocType(id, type)
    refresh(); setMsg('✓ Category changed. Existing documents were kept.')
  }

  const typeChoices = hideBioTypes ? DOC_TYPES.filter(t => t !== 'resume' && t !== 'jd') : DOC_TYPES

  return (
    <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: visible.length ? 8 : 0 }}>
        <span style={{ fontSize: 11, color: T.text2 }}>
          {visible.length
            ? `${selectedCount}/${visible.length} selected — ${kitId ? 'materials for this Kit' : 'knowledge banks / notes for this interview'}`
            : hideBioTypes ? 'Add a knowledge bank or notes (resume & JD are above)' : 'No documents yet — add resume, JD, knowledge bank, or notes'}
        </span>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Upload a PDF, text, or Markdown document"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5eead4', cursor: busy ? 'default' : 'pointer', background: 'rgba(13,148,136,0.12)', border: '1px solid rgba(13,148,136,0.3)', borderRadius: 6, padding: '4px 10px', opacity: busy ? 0.6 : 1, fontFamily: T.font }}>
          {busy ? 'Reading…' : '⬆ Upload'}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" disabled={busy} aria-label="Choose a PDF, text, or Markdown document" style={{ display: 'none' }} onChange={onFile} />
      </div>
      {kitId && <div style={{ color: T.text3, fontSize: 10.5, lineHeight: 1.5, margin: '5px 2px 7px' }}>
        PDF, TXT, or Markdown · up to 10 MB each. Stored locally and isolated to this Kit; selected content may be sent to the configured AI provider for retrieval and grounded answers.
      </div>}
      {visible.map(d => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderTop: `1px solid ${T.border}`, fontSize: 12 }}>
          <input type="checkbox" checked={d.selected !== false} onChange={e => toggle(d.id, e.target.checked)} title={kitId ? 'Include in this Kit’s practice and Live retrieval' : 'Include in next Live / Solo retrieval'} aria-label={`Select ${d.name}`} />
          <span style={{ color: T.text1, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📄 {d.name}</span>
          <select value={d.type} onChange={e => changeType(d.id, e.target.value)} title="Category affects when this is retrieved" aria-label={`Category for ${d.name}`} style={{ fontSize: 10, color: T.text2, background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.border}`, borderRadius: 6, padding: '2px 4px', maxWidth: 130, fontFamily: T.font }}>
            {typeChoices.map(t => <option key={t} value={t}>{DOC_TYPE_LABELS[t] || t}</option>)}
          </select>
          <span style={{ fontSize: 10, color: T.text3 }}>{(d.chars / 1000).toFixed(1)}k</span>
          {d.retrievalCoverage === 'representative' && <span title="Long document: MockMate indexes representative sections across the file" style={{ fontSize: 9.5, color: '#fbbf24' }}>sampled</span>}
          <button type="button" onClick={() => del(d.id)} data-pi-target="document_remove" title="Remove" aria-label={`Remove ${d.name}`} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>✕</button>
        </div>
      ))}
      {msg && <div role={msg.startsWith('⚠') ? 'alert' : 'status'} aria-live={msg.startsWith('⚠') ? 'assertive' : 'polite'} style={{ fontSize: 10.5, color: msg.startsWith('⚠') ? '#fca5a5' : '#86efac', marginTop: 6 }}>{msg}</div>}
    </div>
  )
}
