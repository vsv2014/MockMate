import React, { useState, useEffect } from 'react'
import { T } from './auth/tokens'
import { activeAccountScope } from './lib/accountScope'
import { setDocSelected, setKitDocSelected } from './lib/docs'
import { loadInterviewKitState } from './lib/interviewKits'
import {
  SOURCE_TYPES, listApprovedImports, previewSelectedSource,
  approveSelectedSource, removeApprovedImport, applyApprovedRemoteUpdate,
} from './lib/connectedSources'
import {
  loadProfessionalState, updateProfessionalProfile, addEvidenceQuote,
  removeEvidence, removeEvidenceForImport, addProfessionalClaim,
  removeProfessionalClaim, recordProfessionalOutcome, removeProfessionalOutcome, buildProfessionalGraph,
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
const blank = () => ({ provider: 'github', title: '', sourceId: '', accountLabel: '', connectedAccountId: null, revision: '', text: '', selectedByUser: false, kitId: null })
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
  const [connections, setConnections] = useState({ accounts: [], active: {}, subscriptions: [] })
  const [oauthProvider, setOauthProvider] = useState('github')
  const [oauthClient, setOauthClient] = useState('')
  const [oauthSecret, setOauthSecret] = useState('')
  const [privateRepos, setPrivateRepos] = useState(false)
  const [oauthFlow, setOauthFlow] = useState(null)
  const [sourceQuery, setSourceQuery] = useState('')
  const [remoteSources, setRemoteSources] = useState([])
  const [claimKey, setClaimKey] = useState('')
  const [claimValue, setClaimValue] = useState('')
  const [claimEvidence, setClaimEvidence] = useState('')
  const [outcomeDraft, setOutcomeDraft] = useState('')
  const [graph, setGraph] = useState(() => buildProfessionalGraph())
  const [connectorBusy, setConnectorBusy] = useState(false)

  // Never show a Kit from a stale workspace/identity after account switching.
  const currentKit = loadInterviewKitState().kits.find(kit => kit.id === activeKit?.id) || null
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
    setGraph(buildProfessionalGraph())
  }
  async function connectorRequest(args) {
    if (!window.electronAPI?.connectors?.request)
      throw new Error('Desktop connector gateway unavailable; restart a connector-enabled build')
    const result = await window.electronAPI.connectors.request(args)
    if (!result?.ok) throw new Error(result?.error || 'Connector operation failed')
    return result.data
  }
  async function fetchConnections() {
    const state = await connectorRequest({ op: 'status' })
    setConnections(state)
    return state
  }
  useEffect(() => {
    fetchConnections().catch(error => setMessage('⚠ ' + readableError(error)))
    const onSynced = () => refresh()
    window.addEventListener('mm-connected-sync', onSynced)
    return () => window.removeEventListener('mm-connected-sync', onSynced)
  }, [])
  useEffect(() => {
    if (!oauthFlow?.flowId) return
    let disposed = false
    const check = async () => {
      try {
        const response = await connectorRequest({ op: 'flow-status', flowId: oauthFlow.flowId })
        if (disposed) return
        if (response.status === 'connected') {
          setOauthFlow(null); setOauthClient(''); setOauthSecret('')
          await fetchConnections()
          setMessage('Connected ' + (response.account?.label || 'account') + '. Select only the sources you want to import.')
        } else if (response.status === 'error') {
          setOauthFlow(null); setMessage('⚠ ' + response.error)
        }
      } catch (error) {
        if (!disposed) { setOauthFlow(null); setMessage('⚠ ' + readableError(error)) }
      }
    }
    const timer = setInterval(check, 5500)
    check()
    return () => { disposed = true; clearInterval(timer) }
  }, [oauthFlow?.flowId])

  async function startOAuth() {
    setConnectorBusy(true); setMessage('')
    try {
      const response = oauthProvider === 'github'
        ? await connectorRequest({ op: 'github-start', clientId: oauthClient, privateRepos })
        : await connectorRequest({ op: 'google-start', provider: oauthProvider,
          clientId: oauthClient, clientSecret: oauthSecret })
      setOauthFlow({ ...response, provider: oauthProvider })
      setMessage(oauthProvider === 'github'
        ? 'Enter the displayed one-time code on GitHub’s device authorization page.'
        : 'Complete Google’s authorization screen in your system browser.')
      if (oauthProvider === 'github') {
        const opened = await window.electronAPI?.openExternal?.('https://github.com/login/device')
        if (!opened?.ok) setMessage('Open https://github.com/login/device manually and enter the code shown below.')
      }
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
    finally { setConnectorBusy(false) }
  }
  async function changeActive(provider, accountId) {
    try {
      const state = await connectorRequest({ op: 'switch', provider, accountId })
      setConnections(state); setRemoteSources([]); setSourceQuery('')
      setMessage('Active ' + (SOURCE_TYPES[provider]?.label || provider) + ' account changed.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
  }
  async function disconnect(provider, accountId) {
    if (!window.confirm('Disconnect this external account from MockMate? Its automatic sync subscriptions will stop; imported local documents remain.')) return
    try {
      const state = await connectorRequest({ op: 'disconnect', provider, accountId })
      setConnections(state); setRemoteSources([])
      setMessage('Account disconnected locally. Revoke its upstream authorization in Google/GitHub settings if needed.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
  }
  async function browseRemote() {
    const provider = draft.provider, accountId = connections.active?.[provider]
    if (!accountId) { setMessage('⚠ Connect and select an account for this source type first.'); return }
    setConnectorBusy(true); setMessage('')
    try {
      const result = await connectorRequest({ op: 'list-sources', provider, accountId, query: sourceQuery })
      setRemoteSources(result.sources || [])
      setMessage('Select one source to preview. Listing is not consent to import.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
    finally { setConnectorBusy(false) }
  }
  async function selectRemote(source) {
    const provider = draft.provider, accountId = connections.active?.[provider]
    setConnectorBusy(true); setMessage('')
    try {
      const item = await connectorRequest({ op: 'read-source', provider, accountId, sourceId: source.sourceId })
      const acct = connections.accounts.find(x => x.id === accountId)
      setDraft(old => ({ ...old, provider, title: item.title, sourceId: item.sourceId,
        revision: item.revision, accountLabel: acct?.label || accountId,
        connectedAccountId: accountId, text: item.text, selectedByUser: true }))
      setPreview(null); setConfirmed(false)
      setMessage('Remote source loaded. Review the exact text and approve the local import.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
    finally { setConnectorBusy(false) }
  }
  async function handleSync(result) {
    const updates = result?.updates || []
    const failures = result?.failures || []
    let applied = 0
    for (const update of updates) {
      try {
        await applyApprovedRemoteUpdate(update)
        await connectorRequest({ op: 'sync-ack', importId: update.importId, sha256: update.sha256 })
        applied += 1
      } catch (error) {
        failures.push({ importId: update.importId, error: readableError(error) })
      }
    }
    refresh()
    await fetchConnections()
    setMessage(failures.length ? '⚠ Sync finished with ' + failures.length + ' issue(s): ' + failures[0].error
      : 'Source synchronization complete. ' + applied + ' source(s) updated.')
    window.dispatchEvent(new Event('mm-connected-sync'))
  }
  async function syncNow() {
    setConnectorBusy(true)
    try { await handleSync(await connectorRequest({ op: 'sync' })) }
    catch (error) { setMessage('⚠ ' + readableError(error)) }
    finally { setConnectorBusy(false) }
  }
  async function toggleAutoSync(record, enabled) {
    try {
      if (enabled && !window.confirm('Automatically fetch changes from this specific approved source every 15 minutes while MockMate is open and not in Live?')) return
      const status = await connectorRequest({ op: 'sync-enable', importId: record.id, enabled })
      setConnections(status)
      setMessage(enabled ? 'Automatic sync enabled for this selected source.' : 'Automatic sync paused.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
  }
  function createClaim() {
    try {
      addProfessionalClaim({ key: claimKey, value: claimValue,
        evidenceIds: claimEvidence ? [claimEvidence] : [] })
      setClaimKey(''); setClaimValue(''); setClaimEvidence('')
      refresh(); setMessage('Professional claim added with its evidence status.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
  }
  function createOutcome() {
    try {
      recordProfessionalOutcome({ description: outcomeDraft })
      setOutcomeDraft(''); refresh(); setMessage('Self-reported outcome recorded in ARCH history.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
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
      if (draft.connectedAccountId) {
        const remote = await connectorRequest({ op: 'read-source', provider: draft.provider,
          accountId: draft.connectedAccountId, sourceId: draft.sourceId })
        if (remote.sha256 !== preview.sha256 || remote.revision !== preview.revision
          || remote.title !== preview.title) {
          throw new Error('Remote source changed after preview; select and review it again before importing')
        }
      }
      const { record, existing } = await approveSelectedSource(preview, draft, { approved: confirmed })
      if (record.connectedAccountId) {
        try {
          const state = await connectorRequest({
            op: 'subscribe', importId: record.id, provider: record.provider,
            accountId: record.connectedAccountId, sourceId: record.sourceId, sha256: record.sha256,
          })
          setConnections(state)
        } catch (error) {
          setMessage('⚠ Imported locally, but automatic sync could not start: ' + readableError(error))
          refresh()
          return
        }
      }
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
  async function deleteImport(id) {
    if (!window.confirm('Remove this approved import and its local document? Linked ARCH quotes will also be removed.')) return
    try {
      const item = imports.find(x => x.id === id)
      if (item?.connectedAccountId) {
        await connectorRequest({ op: 'unsubscribe', importId: id })
      }
      if (!removeApprovedImport(id)) throw new Error('Import is no longer available')
      if (!removeEvidenceForImport(id)) throw new Error('Document removed but evidence cleanup could not be saved')
      refresh()
      setMessage('Approved import and linked quotes removed.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
  }
  function toggleRetrieval(row, selected) {
    if (!row.documentPresent) { setMessage('⚠ The imported document is missing. Import it again to enable retrieval.'); return }
    if (selected && !window.confirm('Include this imported source in selected-document AI retrieval? Relevant excerpts may be sent to your configured AI provider during practice or Live.')) return
    const result = row.kitId
      ? setKitDocSelected(row.kitId, row.documentId, selected)
      : setDocSelected(row.documentId, selected)
    if (!result) { setMessage('⚠ Could not update retrieval selection.'); return }
    refresh()
    setMessage(selected ? 'Source enabled for selected-document AI retrieval.' : 'Source excluded from AI retrieval.')
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
          Signed-in MockMate account: <strong style={{ color: T.text1 }}>{auth?.user?.email || auth?.user?.name || (auth?.guest ? 'Guest (local)' : 'Current account')}</strong>.
          Connected credentials are encrypted by your OS and bound to this MockMate account. The app never accesses entire accounts automatically.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 10 }}>
          {providerEntries.map(([id, meta]) => {
            const choices = connections.accounts.filter(row => row.provider === id)
            return <div key={id} style={{ padding: 12, border: `1px solid ${T.border}`, borderRadius: 10, background: T.surface2, minWidth: 0 }}>
              <strong style={{ fontSize: 13 }}>{meta.label}</strong>
              <div style={{ ...small, marginTop: 5 }}>{choices.length} authorized account(s)</div>
              {choices.length > 0 && <select aria-label={'Active ' + meta.label + ' account'} style={{ ...input, marginTop: 8 }}
                value={connections.active?.[id] || ''} onChange={e => changeActive(id, e.target.value)}>
                {choices.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
              </select>}
              {choices.map(row => <div key={row.id} style={{ ...small, marginTop: 7 }}>
                {row.label} <button type="button" style={{ ...quiet, padding: '3px 7px', marginLeft: 6 }} onClick={() => disconnect(id, row.id)}>Disconnect</button>
              </div>)}
            </div>
          })}
        </div>
        <div style={{ marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))' }}>
          <Field name="Connect provider">
            <select style={input} value={oauthProvider} onChange={e => { setOauthProvider(e.target.value); setOauthFlow(null) }}>
              <option value="github">GitHub</option><option value="googledrive">Google Drive</option>
              <option value="googlecalendar">Google Calendar</option>
            </select>
          </Field>
          <Field name={oauthProvider === 'github' ? 'GitHub OAuth App client ID' : 'Google Desktop OAuth client ID'}>
            <input style={input} value={oauthClient} onChange={e => setOauthClient(e.target.value)} maxLength={256}
              placeholder={oauthProvider === 'github' ? 'Iv1…' : '…apps.googleusercontent.com'} />
          </Field>
          {oauthProvider !== 'github' && <Field name="Google Desktop client secret (if issued)">
            <input style={input} type="password" autoComplete="off" value={oauthSecret} maxLength={300}
              onChange={e => setOauthSecret(e.target.value)} />
          </Field>}
        </div>
        {oauthProvider === 'github' && <label style={{ ...small, display: 'flex', gap: 7, alignItems: 'center', marginTop: 9 }}>
          <input type="checkbox" checked={privateRepos} onChange={e => setPrivateRepos(e.target.checked)} />
          Request broad GitHub repo permission to read private repositories (off by default; use only if needed).
        </label>}
        <p style={{ ...small, margin: '10px 0' }}>
          Register your own OAuth app client before connecting. GitHub requires Device Flow enabled.
          Google requires a Desktop client with consent and enabled Drive/Calendar APIs. Google read-only scopes
          can cover many files/events upstream; MockMate only imports the individual sources you approve.
        </p>
        <button style={action} disabled={connectorBusy || !oauthClient.trim() || !!oauthFlow} onClick={startOAuth}>
          {connectorBusy ? 'Connecting…' : 'Authorize external account'}
        </button>
        {oauthFlow && <div role="status" style={{ ...small, marginTop: 10, padding: 10, border: `1px solid ${T.accentBorder}`, borderRadius: 9 }}>
          {oauthFlow.provider === 'github'
            ? <>Open <strong>github.com/login/device</strong> and enter code <strong style={{ color: T.text1, fontSize: 17 }}>{oauthFlow.userCode}</strong>.</>
            : <>Complete Google authorization in your system browser.</>}
          <div>Waiting for provider authorization. No token is sent to the UI.</div>
          <button style={{ ...quiet, marginTop: 7 }} onClick={() => setOauthFlow(null)}>Stop checking</button>
        </div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <button style={quiet} disabled={connectorBusy} onClick={syncNow}>Synchronize approved sources</button>
          <span style={small}>15-minute background checks; automatically paused during Live.</span>
        </div>
      </section>

      <section style={panel} aria-label="Review and import source">
        <h3 style={{ fontSize: 17, margin: '0 0 6px' }}>Import one selected source</h3>
        <div style={{ margin: '12px 0', padding: 12, background: T.surface2, borderRadius: 9 }}>
          <strong style={{ fontSize: 13 }}>Browse your active connected account</strong>
          <div style={{ ...small, marginTop: 3 }}>
            GitHub: enter owner/repo. Drive: optional filename filter. Calendar: upcoming primary calendar events.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 10 }}>
            <input style={{ ...input, flex: '1 1 220px', width: 'auto' }} value={sourceQuery}
              onChange={e => setSourceQuery(e.target.value)} placeholder="Repository or name filter" />
            <button type="button" style={quiet} onClick={browseRemote} disabled={connectorBusy || !connections.active?.[draft.provider]}>
              Browse selected source
            </button>
          </div>
          {remoteSources.map(row => <div key={row.sourceId} style={{ display: 'flex', gap: 9, padding: '7px 0',
              borderBottom: `1px solid ${T.border}`, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere', fontSize: 13 }}>{row.title}</span>
            <button type="button" style={quiet} onClick={() => selectRemote(row)} disabled={connectorBusy}>Select &amp; review</button>
          </div>)}
        </div>

        <p style={{ ...small, margin: '0 0 14px' }}>Source text stays in this account's local document store. Imports begin unselected for Live and Solo. Automatic sync is opt-in per reviewed source. No LLM rewriting or bulk mailbox/Drive imports.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 245px), 1fr))', gap: 12 }}>
          <Field name="Source type">
            <select style={input} value={draft.provider} onChange={e => { change('provider', e.target.value); setRemoteSources([]) }}>
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
              {currentKit?.id && <option value={currentKit.id}>Active Kit: {currentKit.title}</option>}
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
          I deliberately selected this individual source and approve reviewing it before local import.
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
            <label style={{ ...small, display: 'flex', gap: 7, alignItems: 'center', cursor: row.documentPresent ? 'pointer' : 'not-allowed' }}>
              <input type="checkbox" disabled={!row.documentPresent} checked={row.selectedForLive} onChange={e => toggleRetrieval(row, e.target.checked)} />
              Allow AI retrieval
            </label>
            {row.connectedAccountId && <>
              <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={!!connections.subscriptions.find(s => s.importId === row.id && s.autoSync)}
                  onChange={e => toggleAutoSync(row, e.target.checked)} />
                Auto-sync
              </label>
              <span style={small}>{row.versions?.length || 0} previous revision(s)</span>
            </>}
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
      <section style={panel} aria-label="ARCH professional evidence graph">
        <h3 style={{ fontSize: 17, margin: '0 0 8px' }}>ARCH professional evidence graph</h3>
        <p style={small}>{graph.nodes.length} nodes · {graph.edges.length} relationships · {graph.conflicts.length} unresolved conflict(s)
          · {graph.staleEvidence} stale source quotation(s). Claims and outcomes are user-entered, never invented.</p>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))' }}>
          <Field name="Claim / skill / role">
            <input style={input} value={claimKey} onChange={e => setClaimKey(e.target.value)} placeholder="e.g. Angular" />
          </Field>
          <Field name="Claim value">
            <input style={input} value={claimValue} onChange={e => setClaimValue(e.target.value)} placeholder="e.g. 4 years" />
          </Field>
          <Field name="Supporting quotation (optional)">
            <select style={input} value={claimEvidence} onChange={e => setClaimEvidence(e.target.value)}>
              <option value="">Self-reported (unverified)</option>
              {professional.evidence.map(row => <option key={row.id} value={row.id}>{row.quote.slice(0, 65)}</option>)}
            </select>
          </Field>
        </div>
        <button style={{ ...action, marginTop: 10 }} disabled={!claimKey.trim() || !claimValue.trim()} onClick={createClaim}>
          Add professional claim
        </button>
        {professional.claims.map(row => <div key={row.id} style={{ display: 'flex', gap: 9, alignItems: 'center',
          borderTop: `1px solid ${T.border}`, padding: '8px 0', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 200px', fontSize: 13 }}>{row.key}: {row.value} <span style={small}>({row.status})</span></span>
          <button style={quiet} onClick={() => { if (removeProfessionalClaim(row.id)) refresh() }}>Remove</button>
        </div>)}
        {graph.conflicts.length > 0 && <div role="alert" style={{ ...small, color: '#fbbf24', marginTop: 8 }}>
          Conflicting claims detected: {graph.conflicts.map(row => row.key).join(', ')}. Review rather than silently picking one.
        </div>}
        <div style={{ marginTop: 17 }}>
          <Field name="Record an interview, project or career outcome (self-reported)">
            <textarea style={{ ...input, minHeight: 64 }} value={outcomeDraft} onChange={e => setOutcomeDraft(e.target.value)} />
          </Field>
          <button style={{ ...action, marginTop: 10 }} disabled={outcomeDraft.trim().length < 10} onClick={createOutcome}>Record outcome</button>
          {professional.outcomes.map(row => <div key={row.id} style={{ borderTop: `1px solid ${T.border}`,
            padding: '8px 0', fontSize: 13, display: 'flex', gap: 10 }}>
            <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{row.description}</span>
            <button style={quiet} onClick={() => { if (removeProfessionalOutcome(row.id)) refresh() }}>Remove</button>
          </div>)}
        </div>
      </section>
      <p style={small}>
        Remote OAuth credentials are held encrypted in the Electron main process. Only individually selected source content
        reaches the local document store; AI retrieval stays disabled until selected. Account disconnect removes local
        authorization but may require separate upstream revocation. Full autonomous career inference is not enabled.
      </p>
    </div>
  )
}
