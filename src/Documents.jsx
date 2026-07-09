import React, { useState, useRef } from 'react'
import { T } from './auth/tokens'
import { listDocs, addDoc, removeDoc } from './lib/docs'
import { extractPdfText } from './pdf'

// Documents panel — upload resume / JD / notes; they're chunked + embedded locally and the most
// relevant pieces are retrieved per question to ground Live answers (RAG). Files stay on-device.
export default function Documents() {
  const [docs, setDocs] = useState(() => listDocs())
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const refresh = () => setDocs(listDocs())

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setMsg('Reading…')
    try {
      const text = /\.pdf$/i.test(file.name) ? await extractPdfText(file) : await file.text()
      if (text && text.trim().length > 20) {
        const n = file.name.toLowerCase()
        const type = /resume|cv/.test(n) ? 'resume' : /job|jd|descrip/.test(n) ? 'job description' : 'document'
        addDoc({ name: file.name, type, text })
        refresh(); setMsg(`✓ Added — ${text.length.toLocaleString()} chars (indexed on first question)`)
      } else setMsg('⚠ Could not read text from that file.')
    } catch (err) { setMsg('⚠ ' + (err.message || 'Failed to read file')) }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function del(id) { if (!window.confirm('Remove this document?')) return; removeDoc(id); refresh(); setMsg('') }

  return (
    <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.rCtrl, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: docs.length ? 8 : 0 }}>
        <span style={{ fontSize: 11, color: T.text2 }}>
          {docs.length ? `${docs.length} document${docs.length > 1 ? 's' : ''} indexed — used to ground Live answers` : 'No documents yet — add your resume, JD, or notes'}
        </span>
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#5eead4', cursor: busy ? 'default' : 'pointer', background: 'rgba(13,148,136,0.12)', border: '1px solid rgba(13,148,136,0.3)', borderRadius: 6, padding: '4px 10px', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Reading…' : '⬆ Upload'}
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" disabled={busy} style={{ display: 'none' }} onChange={onFile} />
        </label>
      </div>
      {docs.map(d => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderTop: `1px solid ${T.border}`, fontSize: 12 }}>
          <span style={{ color: T.text1, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>📄 {d.name}</span>
          <span style={{ fontSize: 10, color: T.text3, background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: '1px 6px' }}>{d.type}</span>
          <span style={{ fontSize: 10, color: T.text3 }}>{(d.chars / 1000).toFixed(1)}k</span>
          <button onClick={() => del(d.id)} title="Remove" style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>✕</button>
        </div>
      ))}
      {msg && <div style={{ fontSize: 10.5, color: msg.startsWith('⚠') ? '#fca5a5' : '#86efac', marginTop: 6 }}>{msg}</div>}
    </div>
  )
}
