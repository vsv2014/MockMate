import React, { useState } from 'react'
import { T } from '../auth/tokens'
import { readableTextSize } from '../lib/typography.js'

// Review is deliberately read-only. The desktop may use a hosted backend,
// whose policy cannot be changed by editing a renderer-side JSON blob.
const small = { fontSize: readableTextSize(12), color: T.text3, lineHeight: 1.55 }
const button = { border: `1px solid ${T.borderStrong}`, borderRadius: 8,
  background: T.surface2, color: T.text1, font: `600 ${readableTextSize(12)}px ${T.font}`,
  padding: '8px 12px', cursor: 'pointer' }

export default function PolicyProposalEditor() {
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState(null)
  const [reviewedText, setReviewedText] = useState(null)
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function request(operation) {
    const bridge = window.electronAPI?.ablPolicy?.request
    if (!bridge) throw new Error('The desktop policy validator is unavailable in this build.')
    const res = await bridge(operation)
    if (!res?.ok) throw new Error(res?.error || 'Local ABL policy review failed')
    return res.data
  }
  async function loadCurrent() {
    setBusy(true); setError('')
    try {
      const result = await request({ op: 'read' })
      setDraft(result.text); setSource(result.source)
      setPreview(null); setReviewedText(null)
    } catch (err) { setError(err?.message || 'Could not load local policy') }
    finally { setBusy(false) }
  }
  async function dryRun() {
    setBusy(true); setError(''); setPreview(null); setReviewedText(null)
    try {
      const result = await request({ op: 'preview', text: draft })
      setPreview(result)
      setReviewedText(draft)
    } catch (err) { setError(err?.message || 'Proposal rejected') }
    finally { setBusy(false) }
  }
  function downloadReviewed() {
    if (!preview || reviewedText !== draft || !preview.changed) return
    const blob = new Blob([draft], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'mockmate-abl-reviewed-proposal.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <details style={{ marginTop: 14, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
    <summary style={{ cursor: 'pointer', color: T.text1, fontSize: readableTextSize(13), fontWeight: 600 }}>
      Review a policy proposal (local dry-run)
    </summary>
    <p style={small}>Load the local validated ABL configuration, edit a copy, and inspect changed fields.
      No policy is published, reloaded or rolled back here. A hosted backend may have a different effective policy.
      Changes still require trusted operator approval, versioned rollback and a fresh Live test.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
      <button type="button" disabled={busy} onClick={loadCurrent} style={button}>Load local configuration</button>
      <button type="button" disabled={busy || !draft.trim()} onClick={dryRun} style={button}>
        {busy ? 'Validating…' : 'Validate and compare'}
      </button>
      <button type="button" disabled={!preview?.changed || reviewedText !== draft} onClick={downloadReviewed}
        style={button}>Export validated proposal</button>
    </div>
    {source && <p style={small}>Loaded source: {source === 'operator_override' ? 'Private local operator override' : 'Bundled validated default'}</p>}
    <label htmlFor="abl-local-draft" style={{ ...small, display: 'block', marginBottom: 6 }}>Proposed ABL JSON (maximum 128 KiB)</label>
    <textarea id="abl-local-draft" value={draft} rows={8} spellCheck={false} maxLength={128 * 1024}
      onChange={event => { setDraft(event.target.value); setPreview(null); setReviewedText(null) }}
      style={{ display: 'block', boxSizing: 'border-box', width: '100%', minWidth: 0, maxHeight: 320,
        resize: 'vertical', padding: 10, borderRadius: 8, border: `1px solid ${T.borderStrong}`,
        background: T.surface2, color: T.text1, fontSize: readableTextSize(12), fontFamily: 'monospace' }} />
    {error && <div role="alert" style={{ ...small, color: '#fca5a5', marginTop: 9 }}>Validation rejected: {error}</div>}
    {preview && <div role="status" style={{ ...small, padding: 10, marginTop: 10,
      border: `1px solid ${T.border}`, borderRadius: 8 }}>
      <strong style={{ color: T.text1 }}>{preview.changed ? 'Valid schema · proposal has changes' : 'Valid schema · no changes'}</strong>
      <div>Current revision: <code>{preview.currentDigest}</code> · Proposed: <code>{preview.proposedDigest}</code></div>
      <div>{preview.changedPaths.length} changed path(s) · Risk: {preview.risk}</div>
      {preview.requiresLiveRetest && <div>Live behavior changed: provider, audio or answer regression tests are required.</div>}
      {preview.requiresPrivacyReview && <div>Privacy policy changed: review consent and retention before approval.</div>}
      {preview.changedPaths.length > 0 && <ul style={{ margin: '5px 0', paddingLeft: 21 }}>
        {preview.changedPaths.map((path, index) => <li key={index} style={{ overflowWrap: 'anywhere' }}><code>{path}</code></li>)}
      </ul>}
      <div>No changes applied. To activate on a private operator-managed backend, use the
        reviewed file with the ABL CLI and <code>--approve {preview.currentDigest}</code>.</div>
    </div>}
  </details>
}
