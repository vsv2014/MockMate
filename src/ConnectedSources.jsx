import React, { useState, useEffect, useRef } from 'react'
import { T } from './auth/tokens'
import { activeAccountScope } from './lib/accountScope'
import { setDocSelected, setKitDocSelected, documentIndexStatus, prepareDocumentIndex } from './lib/docs'
import { loadInterviewKitState } from './lib/interviewKits'
import { loadSessionsAsync } from './history'
import {
  SOURCE_TYPES, listApprovedImports, previewSelectedSource,
  approveSelectedSource, removeApprovedImport, applyApprovedRemoteUpdate,
} from './lib/connectedSources'
import {
  loadProfessionalState, updateProfessionalProfile, addEvidenceQuote,
  removeEvidence, removeEvidenceForImport, addProfessionalClaim,
  removeProfessionalClaim, linkEvidenceToClaim, recordProfessionalOutcome, recordApprovedInterviewOutcome, removeProfessionalOutcome, linkOutcomeToClaim, unlinkOutcomeFromClaim, buildProfessionalGraph, buildProfessionalReviewQueue, evaluateProfessionalEvidence,
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
  maxWidth: '100%', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere',
  padding: '9px 14px', borderRadius: 9, color: T.text1,
  border: `1px solid ${T.accentBorder}`, background: T.accentSoft,
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
}
const quiet = { ...action, color: T.text2, border: `1px solid ${T.borderStrong}`, background: 'transparent' }
const label = { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, color: T.text2, fontSize: 12 }
const small = { color: T.text3, fontSize: 12, lineHeight: 1.5 }
const blank = () => ({ provider: 'github', title: '', sourceId: '', accountLabel: '', connectedAccountId: null, revision: '', text: '', selectedByUser: false, kitId: null })
const readableError = error => error?.message || 'Operation failed; no changes were made.'
export function sourceSyncHealth(subscription) {
  if (!subscription) return 'Not subscribed to background sync.'
  if (subscription.tombstone) return 'Remote source missing or permission revoked; local approved copy is retained. Reconnect or remove explicitly.'
  if (subscription.lastError) return 'Sync needs attention: ' + subscription.lastError
    + (subscription.autoSync && subscription.nextRetryAt ? ' · Automatic retry after ' + lastSyncTime(subscription.nextRetryAt) : ' · Use Check now to retry.')
  if (subscription.pendingSha) return 'New revision fetched; waiting for local apply.'
  if (!subscription.autoSync) return 'Automatic sync paused; manual refresh available.'
  if (subscription.lastSyncedAt) return subscription.indexStatus === 'rebuild_on_retrieval'
    ? 'Source updated locally. Retrieval-index readiness is not yet verified.'
    : 'Source checked; no outstanding remote updates known.'
  return 'Waiting for first background check.'
}
function lastSyncTime(value) {
  if (!value) return 'Not checked yet'
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Unknown'
}

function Field({ name, children }) {
  return <label style={label}>{name}{children}</label>
}

export default function ConnectedSources({ auth, activeKit } = {}) {
  const [draft, setDraft] = useState(blank)
  const [preview, setPreview] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [importAutoSync, setImportAutoSync] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [imports, setImports] = useState(() => listApprovedImports())
  const [professional, setProfessional] = useState(() => loadProfessionalState())
  const [profileDraft, setProfileDraft] = useState(() => loadProfessionalState().profile)
  const [quote, setQuote] = useState('')
  const [quoteImportId, setQuoteImportId] = useState('')
  const [connections, setConnections] = useState({ accounts: [], active: {}, subscriptions: [], syncRuns: [] })
  const [oauthProvider, setOauthProvider] = useState('github')
  const [oauthClient, setOauthClient] = useState('')
  const [oauthSecret, setOauthSecret] = useState('')
  const [privateRepos, setPrivateRepos] = useState(false)
  const [oauthFlow, setOauthFlow] = useState(null)
  const [sourceQuery, setSourceQuery] = useState('')
  const [remoteSources, setRemoteSources] = useState([])
  const [remoteCursor, setRemoteCursor] = useState(null)
  const [remotePartial, setRemotePartial] = useState(false)
  const sourceBrowseSerialRef = useRef(0)
  const [claimKey, setClaimKey] = useState('')
  const [claimValue, setClaimValue] = useState('')
  const [claimEvidence, setClaimEvidence] = useState('')
  const [claimLinkChoice, setClaimLinkChoice] = useState({})
  const [outcomeClaimChoice, setOutcomeClaimChoice] = useState({})
  const [outcomeDraft, setOutcomeDraft] = useState('')
  const [historySessions, setHistorySessions] = useState([])
  const [historyOutcomeId, setHistoryOutcomeId] = useState('')
  const [graph, setGraph] = useState(() => buildProfessionalGraph())
  const [connectorBusy, setConnectorBusy] = useState(false)
  const [indexBusyId, setIndexBusyId] = useState(null)
  const indexAbortRef = useRef(null)
  useEffect(() => () => indexAbortRef.current?.abort(), [])

  // Never show a Kit from a stale workspace/identity after account switching.
  const currentKit = loadInterviewKitState().kits.find(kit => kit.id === activeKit?.id) || null
  const providerEntries = Object.entries(SOURCE_TYPES)
  const pendingCount = imports.filter(x => x.selectedForLive === false).length
  const reviewQueue = buildProfessionalReviewQueue(professional, imports)
  const evidenceEvaluation = evaluateProfessionalEvidence(professional, imports)

  useEffect(() => {
    let current = true
    const scope = activeAccountScope()
    loadSessionsAsync().then(result => {
      if (current && activeAccountScope() === scope) setHistorySessions((result.sessions || []).filter(row => row?.id))
    }).catch(() => { if (current) setHistorySessions([]) })
    return () => { current = false }
  }, [auth?.user?.id, auth?.guest])

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
    const onSynced = () => {
      refresh()
      fetchConnections().catch(error => setMessage('⚠ Could not refresh connection status: ' + readableError(error)))
    }
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
      sourceBrowseSerialRef.current += 1
      setConnections(state); setRemoteSources([]); setRemoteCursor(null); setRemotePartial(false); setSourceQuery('')
      setMessage('Active ' + (SOURCE_TYPES[provider]?.label || provider) + ' account changed.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
  }
  async function verifyConnectedAccount(provider, accountId) {
    setConnectorBusy(true); setMessage('')
    try {
      const result = await connectorRequest({ op: 'verify-account', provider, accountId })
      await fetchConnections()
      setMessage('✓ Verified connected ' + (result.account?.label || provider) + ' account. Access is current.')
    } catch (error) { setMessage('⚠ Account verification failed: ' + readableError(error)) }
    finally { setConnectorBusy(false) }
  }
  async function disconnect(provider, accountId) {
    if (!window.confirm('Disconnect this external account from MockMate? Its automatic sync subscriptions will stop; imported local documents remain.')) return
    try {
      const state = await connectorRequest({ op: 'disconnect', provider, accountId })
      sourceBrowseSerialRef.current += 1
      setConnections(state); setRemoteSources([]); setRemoteCursor(null); setRemotePartial(false)
      setMessage('Account disconnected locally. Revoke its upstream authorization in Google/GitHub settings if needed.')
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
  }
  async function browseRemote(more = false) {
    const provider = draft.provider, accountId = connections.active?.[provider]
    if (!accountId) { setMessage('⚠ Connect and select an account for this source type first.'); return }
    if (more && !remoteCursor) return
    const serial = ++sourceBrowseSerialRef.current
    setConnectorBusy(true); setMessage('')
    try {
      const result = await connectorRequest({ op: 'list-sources', provider, accountId, query: sourceQuery,
        ...(more ? { cursor: remoteCursor } : {}) })
      if (serial !== sourceBrowseSerialRef.current) return
      setRemoteSources(previous => more ? [...previous, ...(result.sources || [])] : (result.sources || []))
      setRemoteCursor(result.nextCursor || null)
      setRemotePartial(result.partial === true)
      setMessage(result.partial ? '⚠ Source list is partial (provider limit/truncated GitHub tree). Narrow the repository or filter.'
        : 'Select one source to preview. More results can be loaded when available; listing is not consent to import.')
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
    if (result?.paused) {
      setMessage('Synchronization is paused during Live. No source check was started.')
      return
    }
    if (result?.busy) {
      setMessage('A synchronization pass is already in progress.')
      return
    }
    const updates = result?.updates || []
    const failures = [...(result?.failures || [])]
    let applied = 0
    for (const update of updates) {
      try {
        await applyApprovedRemoteUpdate(update)
        await connectorRequest({ op: 'sync-ack', importId: update.importId, sha256: update.sha256 })
        applied += 1
      } catch (error) {
        failures.push({ importId: update.importId, error: readableError(error) })
        // Report a sanitized, actionable failure instead of silently leaving
        // the connector marked healthy after a failed local apply.
        await connectorRequest({ op: 'sync-apply-failed', importId: update.importId }).catch(() => {})
      }
    }
    refresh()
    await fetchConnections()
    const inspected = Number.isFinite(result?.checked) ? result.checked : null
    const deferred = Number.isFinite(result?.deferred) ? result.deferred : 0
    const progress = inspected == null ? '' : ` Checked ${inspected} source(s).`
    const nextPass = deferred ? ` ${deferred} deferred to a future pass.` : ''
    setMessage(failures.length
      ? '⚠ Sync completed with ' + failures.length + ' issue(s): ' + failures[0].error + progress + nextPass
      : 'Sync check completed. ' + applied + ' source(s) updated.' + progress + nextPass
        + ' Retrieval indexing may still be pending.')
    window.dispatchEvent(new Event('mm-connected-sync'))
  }
  async function syncNow(importId = null) {
    setConnectorBusy(true)
    try {
      // Explicit user action: include an approved source even when background
      // auto-sync is disabled. Per-source retry never scans unrelated sources.
      await handleSync(await connectorRequest({ op: 'sync', manual: true, ...(importId ? { importId } : {}) }))
    } catch (error) { setMessage('⚠ ' + readableError(error)) }
    finally { setConnectorBusy(false) }
  }
  async function buildIndexFor(row) {
    if (indexBusyId || connectorBusy || connections.paused) return
    if (!window.confirm('Build this document\'s retrieval index now? Selected text will be sent to your configured embedding provider. This action may use provider credits.')) return
    const controller = new AbortController()
    indexAbortRef.current = controller
    setIndexBusyId(row.id)
    setMessage('')
    try {
      const result = await prepareDocumentIndex(row.documentId, { kitId: row.kitId || null, signal: controller.signal })
      refresh()
      setMessage('Retrieval index verified for ' + row.title + ' (' + result.chunkCount + ' chunks, ' + result.embeddingModel + ').')
    } catch (error) {
      if (!controller.signal.aborted) setMessage('⚠ Could not verify retrieval index for ' + row.title + ': ' + readableError(error))
    } finally {
      if (indexAbortRef.current === controller) indexAbortRef.current = null
      setIndexBusyId(null)
    }
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
            enabled: importAutoSync,
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
      setImportAutoSync(false)
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
  function downloadProfessionalGraph() {
    // Only after an explicit click, and only into a local file. No external sync.
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(),
      schemaVersion: professional.schemaVersion, professional, graph, reviewQueue }, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'mockmate-professional-evidence.json'
    document.body.appendChild(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Local evidence export created. It contains personal claims and source quotations; store securely.')
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
        <p style={{ ...small, margin: 0 }}>Connect accounts, approve individual source imports, and build professional evidence — outside the Live response path.</p>
        <div role="status" aria-label="Sources and ARCH overview"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, fontSize: 12 }}>
          <span style={{ ...quiet, cursor: 'default' }}>{connections.accounts.length} connected account(s)</span>
          <span style={{ ...quiet, cursor: 'default' }}>{imports.length} approved import(s)</span>
          <span style={{ ...quiet, cursor: 'default' }}>{graph.nodes.length} ARCH node(s)</span>
        </div>
        <nav aria-label="Sources and ARCH sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {[
            ['mm-sources-connections', 'Accounts & OAuth'],
            ['mm-sources-review', 'Review & import'],
            ['mm-sources-approved', 'Approved sources'],
            ['mm-sources-sync', 'Sync & indexing'],
            ['mm-sources-profile', 'Professional profile'],
            ['mm-sources-graph', 'ARCH graph'],
          ].map(([id, title]) => <button key={id} type="button" style={quiet}
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{title}</button>)}
        </nav>
        <p style={{ ...small, margin: '10px 0 0' }}>GitHub / Google use native read-only OAuth flows. Composio SDK and Activepieces workflow automation are not connected to this desktop build.</p>
      </div>
      {auth?.guest && <div role="status" style={{ ...panel, background: 'rgba(20,184,166,0.07)', borderColor: 'rgba(20,184,166,0.3)' }}>
        <strong style={{ color: T.text1 }}>Local profile active</strong>
        <p style={{ ...small, margin: '5px 0 12px' }}>You can create local ARCH evidence and reviewed imports as a guest. Connecting GitHub or Google accounts requires signing in to a MockMate account first so credentials remain isolated per user.</p>
        <button type="button" style={action} onClick={() => auth?.signIn?.()}>Sign in to connect accounts</button>
      </div>}
      {message && <div role="status" aria-live="polite" style={{ ...panel, padding: '10px 14px', color: message.startsWith('⚠') ? '#fda4af' : '#5eead4' }}>{message}</div>}
      <section id="mm-sources-connections" style={panel} aria-label="Connection status">
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
              {choices.map(row => <div key={row.id} style={{ ...small, marginTop: 7, overflowWrap: 'anywhere' }}>
                {row.label}
                <span style={{ display: 'block' }}>Last checked: {row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString() : 'Not verified in this session'}</span>
                <details style={{ margin: '5px 0' }}>
                  <summary style={{ cursor: 'pointer' }}>Review upstream permissions</summary>
                  <div style={{ overflowWrap: 'anywhere', marginTop: 5 }}>{row.scopes || 'Provider did not report its granted scopes.'}</div>
                  <div>Provider authorization may cover more data than the individual files you approve.
                    MockMate imports only explicitly reviewed sources. Revoke upstream access in the provider settings.</div>
                </details>
                <button type="button" disabled={connectorBusy} style={{ ...quiet, padding: '3px 7px', marginLeft: 6 }}
                  onClick={() => verifyConnectedAccount(id, row.id)}>Check access</button>
                <button type="button" style={{ ...quiet, padding: '3px 7px', marginLeft: 6 }} onClick={() => disconnect(id, row.id)}>Disconnect</button>
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
        <button style={action} disabled={auth?.guest || connectorBusy || !oauthClient.trim() || !!oauthFlow} onClick={startOAuth}>
          {connectorBusy ? 'Connecting…' : 'Authorize external account'}
        </button>
        {oauthFlow && <div role="status" style={{ ...small, marginTop: 10, padding: 10, border: `1px solid ${T.accentBorder}`, borderRadius: 9 }}>
          {oauthFlow.provider === 'github'
            ? <>Open <strong>github.com/login/device</strong> and enter code <strong style={{ color: T.text1, fontSize: 17 }}>{oauthFlow.userCode}</strong>.</>
            : <>Complete Google authorization in your system browser.</>}
          <div>Waiting for provider authorization. No token is sent to the UI.</div>
          <button style={{ ...quiet, marginTop: 7 }} onClick={() => setOauthFlow(null)}>Stop checking</button>
        </div>}
      </section>

      <section id="mm-sources-review" style={panel} aria-label="Review and import source">
        <h3 style={{ fontSize: 17, margin: '0 0 6px' }}>Import one selected source</h3>
        <div style={{ margin: '12px 0', padding: 12, background: T.surface2, borderRadius: 9 }}>
          <strong style={{ fontSize: 13 }}>Browse your active connected account</strong>
          <div style={{ ...small, marginTop: 3 }}>
            GitHub: enter owner/repo. Drive: optional filename filter. Calendar: upcoming primary calendar events.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 10 }}>
            <input style={{ ...input, flex: '1 1 220px', width: 'auto' }} value={sourceQuery}
              onChange={e => { sourceBrowseSerialRef.current += 1; setSourceQuery(e.target.value);
                setRemoteSources([]); setRemoteCursor(null); setRemotePartial(false) }} placeholder="Repository or name filter" />
            <button type="button" style={quiet} onClick={() => browseRemote(false)} disabled={connectorBusy || !connections.active?.[draft.provider]}>
              Browse selected source
            </button>
          </div>
          {remoteSources.map(row => <div key={row.sourceId} style={{ display: 'flex', gap: 9, padding: '7px 0',
              borderBottom: `1px solid ${T.border}`, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere', fontSize: 13 }}>{row.title}</span>
            <button type="button" style={quiet} onClick={() => selectRemote(row)} disabled={connectorBusy}>Select &amp; review</button>
          </div>)}
          {remoteCursor && <button type="button" style={quiet} onClick={() => browseRemote(true)}
            disabled={connectorBusy} aria-label="Load more approved source choices">{connectorBusy ? 'Loading…' : 'Load more sources'}</button>}
          {remotePartial && <p role="status" style={small}>This repository listing was truncated. Search a narrower repository or select a specific supported source.</p>}
        </div>

        <p style={{ ...small, margin: '0 0 14px' }}>Source text stays in this account's local document store. Imports begin unselected for Live and Solo. Automatic sync is opt-in per reviewed source. No LLM rewriting or bulk mailbox/Drive imports.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 245px), 1fr))', gap: 12 }}>
          <Field name="Source type">
            <select style={input} value={draft.provider} onChange={e => {
                setDraft({ ...blank(), provider: e.target.value, kitId: draft.kitId })
                sourceBrowseSerialRef.current += 1
                setPreview(null); setConfirmed(false); setImportAutoSync(false)
                setRemoteSources([]); setRemoteCursor(null); setRemotePartial(false)
              }}>
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
            {draft.connectedAccountId && <label style={{ ...small, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input type="checkbox" checked={importAutoSync} onChange={e => setImportAutoSync(e.target.checked)} />
              Enable 15-minute background sync only for this selected source (paused during Live).
            </label>}
            <button style={action} disabled={busy || !confirmed} type="button" onClick={importApproved}>Approve &amp; import</button>
          </div>
        )}
      </section>

      <section id="mm-sources-sync" style={panel} aria-label="Synchronization and retrieval indexing">
        <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>Synchronization &amp; indexing</h3>
        <p style={{ ...small, margin: '0 0 12px' }}>
          Choose individual approved sources to refresh, even if automatic sync is off. Background
          checks run every 15 minutes while the desktop app is open, and pause during Live.
          A source update is not considered retrieval-ready until its current embedding index
          has been stored and verified.
        </p>
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginBottom: 12 }}>
          <span style={quiet}>{connections.subscriptions.length} approved connection(s)</span>
          <span style={quiet}>{connections.subscriptions.filter(row => row.autoSync).length} on auto-sync</span>
          <span style={quiet}>{connections.subscriptions.filter(row => row.lastError).length} need attention</span>
          <span style={quiet}>{connections.subscriptions.filter(row => row.tombstone).length} missing/revoked</span>
          <span style={quiet}>{imports.filter(row => documentIndexStatus(row.documentId, { kitId: row.kitId || null }).state === 'ready').length} indexed</span>
        </div>
        <button type="button" style={action} disabled={connectorBusy || !!indexBusyId || !!connections.paused || !connections.subscriptions.length}
          onClick={() => syncNow()}>
          {connectorBusy ? 'Checking sources…' : 'Check approved sources now'}
        </button>
        {connections.paused && <p role="status" style={{ ...small, marginTop: 8 }}>Background work is paused during Live.</p>}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Recent sync runs</h4>
          {!(connections.syncRuns || []).length && <p style={small}>No synchronization runs recorded for this account yet.</p>}
          {(connections.syncRuns || []).slice(0, 5).map(run => (
            <div key={run.id} role="status" style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center',
              gap: 9, background: T.surface2, borderRadius: 7, padding: '8px 10px', marginBottom: 6,
            }}>
              <strong style={{ ...small, color: run.status === 'completed' ? '#5eead4' : '#fcd34d' }}>
                {run.status.replace(/_/g, ' ')}
              </strong>
              <span style={small}>{run.trigger === 'manual' ? 'Manual' : 'Scheduled'} · {lastSyncTime(run.startedAt)}</span>
              <span style={small}>{run.checked} checked · {run.changed} changed · {run.applied} applied · {run.pending} pending · {run.failures} errors</span>
              {['interrupted', 'needs_attention', 'partial', 'paused'].includes(run.status) &&
                <span style={small}>Retry the approved source above after resolving the issue.</span>}
            </div>
          ))}
          <p style={small}>
            A run marked awaiting apply is not complete; retrieval indexing has its own separate readiness state.
            If the app restarts during a check, the unfinished run is recorded as interrupted.
          </p>
        </div>
      </section>

      <section id="mm-sources-approved" style={panel} aria-label="Approved imports">
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
              <button type="button" style={quiet} disabled={connectorBusy || !!indexBusyId || !!connections.paused}
                onClick={() => syncNow(row.id)} aria-label={`Check ${row.title} now`}>
                {connectorBusy ? 'Checking…' : 'Check now'}
              </button>
            </>}
            {row.connectedAccountId && <div role="status"
              aria-label={`Synchronization status for ${row.title}`}
              style={{ ...small, flexBasis: '100%', padding: '7px 10px', border: `1px solid ${T.border}`, borderRadius: 7 }}>
              <strong style={{ color: T.text1 }}>Sync:</strong>{' '}
              {sourceSyncHealth(connections.subscriptions.find(s => s.importId === row.id))}
              <span style={{ display: 'block' }}>Last checked: {lastSyncTime(connections.subscriptions.find(s => s.importId === row.id)?.lastCheckedAt)}</span>
            </div>}
            <div role="status" aria-label={`Retrieval index for ${row.title}`}
              style={{ ...small, flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>Retrieval index: {documentIndexStatus(row.documentId, { kitId: row.kitId || null }).state === 'ready'
                ? 'Verified for current document revision'
                : 'Not indexed or out of date (lexical fallback remains available)'}</span>
              <button type="button" style={quiet}
                disabled={!row.documentPresent || connectorBusy || !!indexBusyId || !!connections.paused}
                onClick={() => buildIndexFor(row)} aria-label={`Build retrieval index for ${row.title}`}>
                {indexBusyId === row.id ? 'Building index…' : 'Build / verify index'}
              </button>
            </div>
            <button style={quiet} type="button" onClick={() => deleteImport(row.id)}>Remove import</button>
          </div>
        ))}
      </section>

      <section id="mm-sources-profile" style={panel} aria-label="Professional profile and evidence">
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
      <section id="mm-sources-graph" style={panel} aria-label="ARCH professional evidence graph">
        <h3 style={{ fontSize: 17, margin: '0 0 8px' }}>ARCH professional evidence graph</h3>
        <p style={small}>{graph.nodes.length} nodes · {graph.edges.length} relationships · {graph.conflicts.length} unresolved conflict(s)
          · {graph.staleEvidence} stale source quotation(s). Claims and outcomes are user-entered, never invented.</p>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 9, marginBottom: 14 }}>
          <span role="status" style={small}>{reviewQueue.length} evidence-review action(s)</span>
          <span role="status" style={{ ...small, overflowWrap: 'anywhere' }}>{evidenceEvaluation.supportedClaims}/{evidenceEvaluation.claims} claims supported · {evidenceEvaluation.conflictingClaims} conflicting · {evidenceEvaluation.staleEvidence} stale · {evidenceEvaluation.reviewReady ? 'Review ready' : 'Review incomplete'}</span>
          <button type="button" style={quiet} onClick={downloadProfessionalGraph}>Export evidence graph JSON</button>
        </div>
        {reviewQueue.length > 0 && <div role="region" aria-label="Professional evidence review queue"
          style={{ border: `1px solid ${T.border}`, borderRadius: 9, padding: 12, marginBottom: 14, background: T.surface2 }}>
          <strong style={{ fontSize: 13 }}>Evidence review queue</strong>
          <p style={{ ...small, margin: '5px 0' }}>Only deterministic gaps and conflicts are shown. Nothing is rewritten or verified automatically.</p>
          {reviewQueue.slice(0, 20).map(row => <div key={row.id} style={{ padding: '7px 0', borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 12, color: row.severity === 'warning' ? '#fbbf24' : T.text1 }}><strong>{row.title}</strong> · {row.detail}</div>
            <div style={small}>{row.action}</div>
          </div>)}
          {reviewQueue.length > 20 && <p style={small}>{reviewQueue.length - 20} more review actions are included in the JSON export.</p>}
        </div>}
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
          {!!professional.evidence.length && <>
            <select aria-label={`Evidence for ${row.key}`} style={{ ...input, width: 'auto', flex: '1 1 150px' }}
              value={claimLinkChoice[row.id] || ''} onChange={e => setClaimLinkChoice(old => ({ ...old, [row.id]: e.target.value }))}>
              <option value="">Choose approved quote</option>
              {professional.evidence.filter(ev => !row.evidenceIds.includes(ev.id)).map(ev =>
                <option key={ev.id} value={ev.id}>{ev.quote.slice(0, 65)}</option>)}
            </select>
            <button style={quiet} disabled={!claimLinkChoice[row.id]} onClick={() => {
              try { linkEvidenceToClaim(row.id, claimLinkChoice[row.id]); setClaimLinkChoice(old => ({ ...old, [row.id]: '' })); refresh() }
              catch (error) { setMessage('⚠ ' + readableError(error)) }
            }}>Link evidence</button>
          </>}
          <button style={quiet} onClick={() => { if (removeProfessionalClaim(row.id)) refresh() }}>Remove</button>
        </div>)}
        {graph.conflicts.length > 0 && <div role="alert" style={{ ...small, color: '#fbbf24', marginTop: 8 }}>
          Conflicting claims detected: {graph.conflicts.map(row => row.key).join(', ')}. Review rather than silently picking one.
        </div>}
        <div style={{ marginTop: 17 }}>
          <h4 style={{ fontSize: 15, margin: '0 0 7px' }}>Link a saved MockMate interview</h4>
          <p style={small}>Only after your approval. Stores the existing session's label, summary and recorded score (or “Unscored”) with a link to its local history ID. No transcript or AI hint is copied into the evidence graph.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '9px 0' }}>
            <select aria-label="Saved interview outcome" style={{ ...input, width: 'auto', flex: '1 1 230px' }}
              value={historyOutcomeId} onChange={e => setHistoryOutcomeId(e.target.value)}>
              <option value="">Choose saved interview</option>
              {historySessions.map(session => <option key={session.id} value={session.id}>
                {session.label || session.role || 'Interview'} · {session.score == null ? 'unscored' : session.score + '/100'}
              </option>)}
            </select>
            <button type="button" style={action} disabled={!historyOutcomeId} onClick={async () => {
              try {
                const result = await recordApprovedInterviewOutcome(historyOutcomeId)
                refresh()
                setMessage(result.existing ? 'This interview is already linked.' : 'Saved interview outcome linked to ARCH with its local provenance.')
              } catch (error) { setMessage('⚠ ' + readableError(error)) }
            }}>Import selected outcome</button>
          </div>
          {!historySessions.length && <p style={small}>No locally saved interview history found for this account.</p>}
          <Field name="Record an interview, project or career outcome (self-reported)">
            <textarea style={{ ...input, minHeight: 64 }} value={outcomeDraft} onChange={e => setOutcomeDraft(e.target.value)} />
          </Field>
          <button style={{ ...action, marginTop: 10 }} disabled={outcomeDraft.trim().length < 10} onClick={createOutcome}>Record outcome</button>
          {professional.outcomes.map(row => <div key={row.id} style={{ borderTop: `1px solid ${T.border}`,
            padding: '10px 0', fontSize: 13, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ flex: '1 1 240px', overflowWrap: 'anywhere' }}>{row.description}
              <span style={{ ...small, display: 'block' }}>Related claims: {row.claimIds.length ? row.claimIds.map(id => professional.claims.find(c => c.id === id)?.key || 'Removed claim').join(', ') : 'None'}</span>
            </span>
            {!!professional.claims.length && <>
              <select aria-label={`Link a claim to outcome ${row.id}`} style={{ ...input, width: 'auto', flex: '1 1 145px' }}
                value={outcomeClaimChoice[row.id] || ''} onChange={e => setOutcomeClaimChoice(old => ({ ...old, [row.id]: e.target.value }))}>
                <option value="">Select a claim</option>
                {professional.claims.map(claim => <option key={claim.id} value={claim.id}>{claim.key}</option>)}
              </select>
              <button style={quiet} disabled={!outcomeClaimChoice[row.id]} onClick={() => {
                try { linkOutcomeToClaim(row.id, outcomeClaimChoice[row.id]); refresh() }
                catch (error) { setMessage('⚠ ' + readableError(error)) }
              }}>Link</button>
              <button style={quiet} disabled={!row.claimIds.includes(outcomeClaimChoice[row.id])} onClick={() => {
                try { unlinkOutcomeFromClaim(row.id, outcomeClaimChoice[row.id]); refresh() }
                catch (error) { setMessage('⚠ ' + readableError(error)) }
              }}>Unlink</button>
            </>}
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
