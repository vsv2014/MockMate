import React, { useState } from 'react'
import { T } from './auth/tokens'
import { activeAccountScope } from './lib/accountScope'
import {
  SOURCE_TYPES, listApprovedImports, previewSelectedSource,
  approveSelectedSource, removeApprovedImport,
} from './lib/connectedSources'
import {
  loadProfessionalState, updateProfessionalProfile, addEvidenceQuote,
  removeEvidence, removeEvidenceForImport,
} from './lib/archProfessional'

const panel = {
  padding: '16px 18px', borderRadius: T.rCard, border: `1px solid ${T.borderStrong}`,
  background: T.surface1, minWidth: 0,
}
const input = {
  boxSizing: 'border-box', width: '100%', minWidth: 0, padding: '10px 12px',
  background: T.surface2, border: `1px solid ${T.borderStrong}`,
  color: T.text1, borderRadius: 8, fontSize: 14, fontFamily: T.font,
}
const action = {
  padding: '9px 14px', borderRadius: 9, color: T.text1,
  border: `1px solid ${T.accentBorder}`, background: T.accentSoft,
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
}
const quiet = { ...action, color: T.text2, border: `1px solid ${T.borderStrong}`, background: 'transparent' }
const label = { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, color: T.text2, fontSize: 12 }
const small = { color: T.text3, fontSize: 12, lineHeight: 1.5 }
const blank = () => ({ provider: 'github', title: '', sourceId: '', accountLabel: '', revision: '', text: '', selectedByUser: false, kitId: null })
const readableError = error => error?.message || 'Operation failed; no changes were made.'

function Field({ name, children }) {
  return <label style={label}>{name}{children}</label>
}

export default function ConnectedSources({ auth, activeKit } = {}) {
  const [draft, setDraft] = useState(blank)
  const [preview, setPreview] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [imports, setImports] = useState(() => listApprovedImports())
  const [professional, setProfessional] = useState(() => loadProfessionalState())
  const [profileDraft, setProfileDraft] = useState(() => loadProfessionalState().profile)
  const [quote, setQuote] = useState('')
  const [quoteImportId, setQuoteImportId] = useState('')
  const [accountScope] = useState(() => activeAccountScope())
  const providerEntries = Object.entries(SOURCE_TYPES)
  const pendingCount = imports.filter(x => x.selectedForLive === false).length

  function change(key, value) {
    setDraft(old => ({ ...old, [key]: value }))
    setPreview(null)
    setConfirmed(false)
    setMessage('')
  }
  function refresh() {
    setImports(listApprovedImports())
    setProfessional(loadProfessionalState())
  }
  async function makePreview() {
    setBusy(true)
    setMessage('')
    try {
      const result = await previewSelectedSource(draft)
      setPreview(result)
      setMessage('Preview ready. Nothing has been saved or shared.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
    finally { setBusy(false) }
  }
  async function importApproved() {
    if (!preview || !confirmed) return
    setBusy(true)
    try {
      const { record, existing } = await approveSelectedSource(preview, draft, { approved: confirmed })
      refresh()
      setDraft(blank())
      setPreview(null)
      setConfirmed(false)
      setMessage(existing
        ? 'This exact source was already imported. No duplicate created.'
        : `Imported ${record.title} as an unselected document. Enable it explicitly in your document or Kit settings before AI retrieval.`)
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
    finally { setBusy(false) }
  }
  function deleteImport(id) {
    if (!window.confirm('Remove this approved import and its local document? Linked ARCH quotes will also be removed.')) return
    try {
      if (!removeApprovedImport(id)) throw new Error('Import is no longer available')
      if (!removeEvidenceForImport(id)) throw new Error('Document removed but evidence cleanup could not be saved')
      refresh()
      setMessage('Approved import and linked quotes removed.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
  }
  function saveProfile() {
    const saved = updateProfessionalProfile(profileDraft)
    if (!saved) { setMessage('⚠ Profile could not be saved; check storage capacity'); return }
    setProfessional(saved)
    setMessage('Professional profile saved locally. It is not automatically injected into Live.')
  }
  function saveQuote() {
    try {
      const { existing } = addEvidenceQuote({ importId: quoteImportId, quote })
      setQuote('')
      refresh()
      setMessage(existing ? 'That exact quote is already recorded.' : 'Verbatim evidence quote saved with source provenance.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
  }

  return (
    <div data-mm-connectors style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14, color: T.text1, fontFamily: T.font }}>
      <div>
        <h2 style={{ margin: '0 0 5px', fontSize: 24, lineHeight: 1.25 }}>Sources &amp; ARCH</h2>
        <p style={{ ...small, margin: 0 }}>Connectors, reviewed imports and your professional evidence — outside the Live response path.</p>
      </div>
      {message && <div role="status" aria-live="polite" style={{ ...panel, padding: '10px 14px', color: message.startsWith('⚠') ? '#fda4af' : '#5eead4' }}>{message}</div>}
      <section style={panel} aria-label="Connection status">
        <h3 style={{ fontSize: 17, margin: '0 0 8px' }}>Connected accounts</h3>
        <p style={{ ...small, margin: '0 0 12px' }}>
          MockMate account: <strong style={{ color: T.text1 }}>{auth?.user?.email || auth?.user?.name || (auth?.guest ? 'Guest (local)' : 'Current account')}</strong>.
          External account OAuth, Composio and Activepieces are <strong>not connected or authorized</strong> in this build.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 10 }}>
          {providerEntries.map(([id, meta]) => (
            <div key={id} style={{ padding: 12, border: `1px solid ${T.border}`, borderRadius: 10, background: T.surface2, minWidth: 0 }}>
              <strong style={{ fontSize: 13 }}>{meta.label}</strong>
              <div style={{ ...small, marginTop: 5 }}>OAuth not configured · no remote access</div>
            </div>
          ))}
        </div>
        <p style={{ ...small, margin: '12px 0 0' }}>
          You can paste one explicitly chosen source below. This does not connect an entire Drive, calendar or repository; no access token is accepted here.
        </p>
      </section>

      <section style={panel} aria-label="Review and import source">
        <h3 style={{ fontSize: 17, margin: '0 0 6px' }}>Import one selected source</h3>
        <p style={{ ...small, margin: '0 0 14px' }}>Source text stays in this account's local document store. Imports begin unselected for Live and Solo. No automatic sync, LLM rewriting or bulk mailbox/Drive access.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 245px), 1fr))', gap: 12 }}>
          <Field name="Source type">
            <select style={input} value={draft.provider} onChange={e => change('provider', e.target.value)}>
              {providerEntries.map(([id, data]) => <option key={id} value={id}>{data.label}</option>)}
            </select>
          </Field>
          <Field name="Source title"><input style={input} maxLength={180} value={draft.title} onChange={e => change('title', e.target.value)} placeholder="e.g. Architecture notes" /></Field>
          <Field name="Source URL or stable ID"><input style={input} maxLength={512} value={draft.sourceId} onChange={e => change('sourceId', e.target.value)} placeholder="Paste URL or unique source identifier" /></Field>
          <Field name="Account label (optional; not an OAuth login)"><input style={input} maxLength={140} value={draft.accountLabel} onChange={e => change('accountLabel', e.target.value)} placeholder="e.g. Work GitHub" /></Field>
          <Field name="Source revision (optional)"><input style={input} maxLength={120} value={draft.revision} onChange={e => change('revision', e.target.value)} placeholder="commit SHA or modification version" /></Field>
          <Field name="Destination">
            <select style={input} value={draft.kitId || ''} onChange={e => change('kitId', e.target.value || null)}>
              <option value="">Shared documents</option>
              {activeKit?.id && <option value={activeKit.id}>Active Kit: {activeKit.title}</option>}
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field name="Paste only the chosen document/event text (maximum 250 KiB)">
            <textarea style={{ ...input, minHeight: 136, resize: 'vertical', lineHeight: 1.5 }} value={draft.text} onChange={e => change('text', e.target.value)} placeholder="The exact Markdown, plain text or event notes you selected…" />
          </Field>
        </div>
        <label style={{ ...small, display: 'flex', alignItems: 'flex-start', gap: 8, margin: '12px 0' }}>
          <input type="checkbox" checked={draft.selectedByUser} onChange={e => change('selectedByUser', e.target.checked)} />
          I deliberately selected this individual source and understand this is a manual local import.
        </label>
        <button style={action} type="button" disabled={busy || !draft.selectedByUser} onClick={makePreview}>Preview selected source</button>
        {preview && (
          <div style={{ background: T.surface2, border: `1px solid ${T.accentBorder}`, borderRadius: 10, padding: 12, marginTop: 12 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Review before import</h4>
            <div style={small}>{preview.title} · {preview.sizeBytes.toLocaleString()} bytes · SHA-256 {preview.sha256.slice(0, 16)}…</div>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 180, overflow: 'auto', fontFamily: T.fontMono, fontSize: 12, color: T.text1, margin: '10px 0' }}>{preview.excerpt}</pre>
            <label style={{ ...small, display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 11 }}>
              <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
              I reviewed this preview and approve saving it as an unselected local document.
            </label>
            <button style={action} disabled={busy || !confirmed} type="button" onClick={importApproved}>Approve &amp; import</button>
          </div>
        )}
      </section>

      <section style={panel} aria-label="Approved imports">
        <h3 style={{ fontSize: 17, margin: '0 0 8px' }}>Approved imports ({imports.length})</h3>
        <p style={{ ...small, margin: '0 0 10px' }}>{pendingCount} imported source(s) initially excluded from AI retrieval. Turn on selected documents only when you want them used.</p>
        {imports.length === 0 && <p style={small}>No source imports yet.</p>}
        {imports.map(row => (
          <div key={row.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${T.border}`, padding: '10px 0' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{row.title}</strong>
              <div style={small}>{SOURCE_TYPES[row.provider]?.label || row.provider} · {row.kitId ? 'Interview Kit' : 'Shared library'} · {row.revision || 'no revision specified'}</div>
            </div>
            <button style={quiet} type="button" onClick={() => deleteImport(row.id)}>Remove import</button>
          </div>
        ))}
      </section>

      <section style={panel} aria-label="Professional profile and evidence">
        <h3 style={{ fontSize: 17, margin: '0 0 6px' }}>ARCH professional profile</h3>
        <p style={{ ...small, margin: '0 0 14px' }}>A versioned, account-scoped evidence workspace. Claims are literal quotations from approved sources, not AI-generated summaries. No automatic editing of your résumé or Live prompts.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 12 }}>
          <Field name="Professional headline"><input style={input} maxLength={180} value={profileDraft.headline} onChange={e => setProfileDraft(d => ({ ...d, headline: e.target.value }))} placeholder="e.g. Full-stack software engineer" /></Field>
          <Field name="Target roles"><input style={input} maxLength={300} value={profileDraft.targetRoles} onChange={e => setProfileDraft(d => ({ ...d, targetRoles: e.target.value }))} placeholder="Frontend, Full-stack, AI engineering" /></Field>
        </div>
        <div style={{ margin: '12px 0' }}>
          <Field name="Goals and professional context (you control this)">
            <textarea style={{ ...input, minHeight: 85, resize: 'vertical' }} maxLength={1200} value={profileDraft.goals} onChange={e => setProfileDraft(d => ({ ...d, goals: e.target.value }))} />
          </Field>
        </div>
        <button style={action} type="button" onClick={saveProfile}>Save professional profile</button>
        <div style={{ marginTop: 20, paddingTop: 15, borderTop: `1px solid ${T.border}` }}>
          <h4 style={{ fontSize: 15, margin: '0 0 7px' }}>Evidence with provenance ({professional.evidence.length})</h4>
          {imports.length ? (
            <>
              <Field name="Approved source">
                <select style={input} value={quoteImportId} onChange={e => setQuoteImportId(e.target.value)}>
                  <option value="">Choose an imported source</option>
                  {imports.map(row => <option key={row.id} value={row.id}>{row.title} ({row.provider})</option>)}
                </select>
              </Field>
              <div style={{ marginTop: 10 }}>
                <Field name="Exact quote from that source (minimum 12 characters)">
                  <textarea style={{ ...input, minHeight: 75, resize: 'vertical' }} maxLength={900} value={quote} onChange={e => setQuote(e.target.value)} placeholder="Paste a verifiable excerpt from the selected imported document…" />
                </Field>
              </div>
              <button style={{ ...action, marginTop: 10 }} disabled={!quoteImportId || quote.trim().length < 12} type="button" onClick={saveQuote}>Add evidence quote</button>
            </>
          ) : <p style={small}>Import and approve one source to start recording evidence.</p>}
          {professional.evidence.map(item => (
            <div key={item.id} style={{ borderTop: `1px solid ${T.border}`, marginTop: 12, paddingTop: 12, display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 250px', minWidth: 0 }}>
                <div style={{ fontSize: 13, color: T.text1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>“{item.quote}”</div>
                <div style={{ ...small, marginTop: 6 }}>Source: {item.title} · {item.provider} · revision {item.sourceRevision || 'unspecified'}</div>
              </div>
              <button style={quiet} type="button" onClick={() => { const saved = removeEvidence(item.id); if (saved) { refresh(); setMessage('Quote removed.') } else setMessage('⚠ Quote could not be deleted.') }}>Remove quote</button>
            </div>
          ))}
        </div>
      </section>
      <p style={small}>Security boundary: source text remains within this account’s local document library until you deliberately select it for retrieval. Provider authorization, server-side ACLs, scheduled sync, token revocation and real account switching require a separately secured connector gateway.</p>
    </div>
  )
}
