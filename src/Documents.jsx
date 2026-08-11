import React, { useState, useRef } from 'react'
import { T } from './auth/tokens'
import {
  listDocs, addDoc, removeDoc, inferDocType, setDocSelected, setDocType,
  DOC_TYPES, DOC_TYPE_LABELS,
} from './lib/docs'
import { extractPdfText } from './pdf'

/**
 * Documents panel — RAG library.
 * @param {{ hideBioTypes?: boolean }} props — when true (Live setup), hide resume/JD rows
 *   because those are edited in the paste fields above and synced on Start.
 */
export default function Documents({ hideBioTypes = false } = {}) {
  const [docs, setDocs] = useState(() => listDocs())
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const refresh = () => setDocs(listDocs())

  const visible = hideBioTypes ? docs.filter(d => d.type !== 'resume' && d.type !== 'jd') : docs
  const selectedCount = visible.filter(d => d.selected !== false).length

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setMsg('Reading…')
    try {
      const text = /\.pdf$/i.test(file.name) ? await extractPdfText(file) : await file.text()
      if (text && text.trim().length > 20) {
        let type = inferDocType(file.name)
        // In Live extras mode, don't park a second resume/JD here — user has paste fields.
        if (hideBioTypes && (type === 'resume' || type === 'jd')) type = 'document'
        addDoc({ name: file.name, type, text, selected: true })
        refresh()
        setMsg(`✓ Added as ${DOC_TYPE_LABELS[type] || type} — ${text.length.toLocaleString()} chars. Set the category if wrong.`)
      } else setMsg('⚠ Could not read text from that file (scanned PDF?) — paste text instead.')
    } catch (err) { setMsg('⚠ ' + (err.message || 'Failed to read file')) }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function del(id) { if (!window.confirm('Remove this document?')) return; removeDoc(id); refresh(); setMsg('') }
  function toggle(id, selected) { setDocSelected(id, selected); refresh() }
  function changeType(id, type) { setDocType(id, type); refresh() }

  const typeChoices = hideBioTypes
    ? DOC_TYPES.filter(t => t !== 'resume' && t !== 'jd')
    : DOC_TYPES

  return (
    <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: visible.length ? 8 : 0 }}>
        <span style={{ fontSize: 11, color: T.text2 }}>
          {visible.length
            ? `${selectedCount}/${visible.length} selected — knowledge banks / notes for this interview`
            : hideBioTypes
              ? 'Add a knowledge bank or notes (resume & JD are above)'
              : 'No documents yet — add resume, JD, knowledge bank, or notes'}
        </span>
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5eead4', cursor: busy ? 'default' : 'pointer', background: 'rgba(13,148,136,0.12)', border: '1px solid rgba(13,148,136,0.3)', borderRadius: 6, padding: '4px 10px', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Reading…' : '⬆ Upload'}
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" disabled={busy} style={{ display: 'none' }} onChange={onFile} />
        </label>
      </div>
      {visible.map(d => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderTop: `1px solid ${T.border}`, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={d.selected !== false}
            onChange={e => toggle(d.id, e.target.checked)}
            title="Include in next Live / Solo retrieval"
            aria-label={`Select ${d.name}`}
          />
          <span style={{ color: T.text1, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📄 {d.name}</span>
          <select
            value={d.type}
            onChange={e => changeType(d.id, e.target.value)}
            title="Category affects when this is retrieved"
            style={{
              fontSize: 10, color: T.text2, background: 'rgba(255,255,255,0.05)', border: `1px solid ${T.border}`,
              borderRadius: 6, padding: '2px 4px', maxWidth: 130, fontFamily: T.font,
            }}
          >
            {typeChoices.map(t => (
              <option key={t} value={t}>{DOC_TYPE_LABELS[t] || t}</option>
            ))}
          </select>
          <span style={{ fontSize: 10, color: T.text3 }}>{(d.chars / 1000).toFixed(1)}k</span>
          <button type="button" onClick={() => del(d.id)} title="Remove" style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>✕</button>
        </div>
      ))}
      {msg && <div style={{ fontSize: 10.5, color: msg.startsWith('⚠') ? '#fca5a5' : '#86efac', marginTop: 6 }}>{msg}</div>}
    </div>
  )
}
