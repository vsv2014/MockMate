import React, { useEffect, useState } from 'react'
import { T } from './auth/tokens'
import { readableTextSize } from './lib/typography.js'
import { apiFetch } from './lib/apiClient.js'

// Only receives an allowlisted, on-device read model from Electron; no raw
// diagnostic bundle, session text, prompts or credentials are exposed here.
const panel = { padding: 16, border: `1px solid ${T.borderStrong}`, borderRadius: T.rCard,
  background: T.surface1, minWidth: 0 }
const button = { font: `600 ${readableTextSize(12)}px ${T.font}`,
  borderRadius: 7, padding: '7px 10px', border: `1px solid ${T.borderStrong}`,
  background: T.surface2, color: T.text1, cursor: 'pointer' }
const label = { color: T.text3, fontSize: readableTextSize(11.5), lineHeight: 1.5 }
const format = n => Number.isFinite(n) ? n.toLocaleString() : '—'

export default function OperationsConsole() {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [policy, setPolicy] = useState(null)
  async function refresh() {
    setLoading(true); setError('')
    try {
      const res = await window.electronAPI?.readOperationsSummary?.()
      if (!res?.ok || !res.data) throw new Error(res?.error || 'This build does not expose operational data')
      setSnapshot(res.data)
      try {
        const response = await apiFetch('/api/arch', { timeoutMs: 8000 })
        if (response.ok) setPolicy((await response.json())?.policyRevision || null)
      } catch { setPolicy(null) }
    } catch (err) { setError(err?.message || 'Operational history could not be loaded') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])
  const requests = snapshot?.requests || []
  const modules = snapshot?.modules || []
  const usage = snapshot?.usage || []
  const focused = requests.find(x => x.requestId === selected)
  return (
    <div style={{ maxWidth: 1080, width: '100%', margin: '0 auto', color: T.text1, fontFamily: T.font, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: readableTextSize(22) }}>ARCH Operations</h1>
          <p style={{ ...label, maxWidth: 780, margin: '6px 0 0' }}>Request timelines, module latency, provider retries and recorded usage. Local metadata only; no prompts, transcripts, screenshots or API keys.</p>
        </div>
        <button type="button" style={button} onClick={refresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </header>
      <div role="note" style={{ ...label, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10 }}>
        Device-wide operational metadata may include activity from multiple local accounts. Unlinked legacy provider attempts are shown as uncorrelated rather than attached to a guessed request. Unknown token counts are never presented as zero.
      </div>
      {error && <div role="alert" style={{ ...panel, color: '#fca5a5' }}>{error}</div>}
      <section aria-label="Module health and latency" style={panel}>
        <h2 style={{ fontSize: readableTextSize(16), margin: '0 0 10px' }}>Module health &amp; latency</h2>
        {!modules.length && <p style={label}>No module events recorded yet. Use the application and refresh.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%, 190px),1fr))', gap: 8 }}>
          {modules.map(m => <div key={m.component} style={{ borderRadius: 8, padding: 12, background: T.surface2, minWidth: 0 }}>
            <strong style={{ textTransform: 'capitalize', fontSize: readableTextSize(13) }}>{m.component}</strong>
            <div style={label}>{format(m.events)} events · {format(m.failures)} failures</div>
            <div style={label}>p50 {format(m.p50Ms)} ms · p95 {format(m.p95Ms)} ms</div>
          </div>)}
        </div>
      </section>
      <section aria-label="Execution explorer" style={panel}>
        <h2 style={{ fontSize: readableTextSize(16), margin: '0 0 5px' }}>Execution explorer</h2>
        <p style={{ ...label, margin: '0 0 10px' }}>Latest 50 correlated requests. Select a row to inspect the known sequence of stages; missing links are explicitly left uncorrelated.</p>
        <div style={label}>{format(snapshot?.uncorrelatedProviderEvents)} provider events without a request ID</div>
        {!requests.length && <p style={label}>No request traces found.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {requests.map(req => <button type="button" key={req.requestId}
            aria-expanded={selected === req.requestId} onClick={() => setSelected(id => id === req.requestId ? null : req.requestId)}
            style={{ ...button, display: 'flex', alignItems: 'center', textAlign: 'left', flexWrap: 'wrap', gap: 10,
              background: selected === req.requestId ? T.accentSoft : T.surface2 }}>
            <span style={{ flex: '1 1 185px', minWidth: 0, overflowWrap: 'anywhere' }}>{req.route || 'Provider-only request'}</span>
            <span style={label}>{req.status}</span>
            <span style={label}>{format(req.durationMs)} ms</span>
            <span style={label}>{req.providerAttempts} provider attempt(s)</span>
          </button>)}
        </div>
        {focused && <div style={{ marginTop: 12, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
          <h3 style={{ fontSize: readableTextSize(12.5), margin: '0 0 8px' }}>Trace {focused.requestId}</h3>
          <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {focused.stages.map((stage, i) => <li key={i} style={{ ...label, overflowWrap: 'anywhere' }}>
              <strong style={{ color: T.text1 }}>{stage.component} · {stage.event}</strong>
              {stage.provider ? ` · ${stage.provider}` : ''}
              {stage.durationMs != null ? ` · ${stage.durationMs} ms` : ''}
              {stage.status != null ? ` · HTTP ${stage.status}` : ''}
            </li>)}
          </ol>
        </div>}
      </section>
      <section aria-label="Cross-module resource activity" style={panel}>
        <h2 style={{ fontSize: readableTextSize(16), margin: '0 0 8px' }}>Cross-module activity</h2>
        <p style={{ ...label, margin: '0 0 10px' }}>
          Embedding inputs, finalized speech segments and approved-source checks are measured activity—not
          provider-confirmed billed minutes, token charges, or external API invoice units.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%, 195px),1fr))', gap: 8 }}>
          {(snapshot?.moduleActivity || []).map(activity => <div key={activity.module}
            style={{ padding: 12, borderRadius: 8, background: T.surface2 }}>
            <strong style={{ fontSize: readableTextSize(13), textTransform: 'capitalize' }}>{activity.module}</strong>
            <div style={label}>{format(activity.processedUnits)} {activity.unit}</div>
            <div style={label}>{format(activity.completedCalls)} completed event(s) · {format(activity.failedCalls)} failure event(s)</div>
            {activity.elapsedMs != null && <div style={label}>{format(activity.elapsedMs)} ms measured duration</div>}
          </div>)}
        </div>
      </section>
      <section aria-label="Effective ABL configuration" style={panel}>
        <h2 style={{ fontSize: readableTextSize(16), margin: '0 0 8px' }}>Effective ABL configuration</h2>
        {policy
          ? <div style={label}>
              <div>Schema version: <strong>{policy.ablVersion}</strong></div>
              <div>Current revision: <code>{policy.revisionDigest}</code></div>
              <div>Configuration source: {policy.source === 'operator_override' ? 'Private operator override' : 'Bundled validated default'}</div>
              <div>Archived revisions available for rollback: {policy.availableRollbackRevisions}</div>
            </div>
          : <p style={label}>Effective policy metadata isn't available from this backend.</p>}
        <p style={{ ...label, marginTop: 10 }}>
          For safety, applying or rolling back a policy requires trusted local operator access.
          Use the versioned ABL CLI with a private MOCKMATE_ABL_PATH. No remote configuration-write API is exposed.
        </p>
      </section>
      <section aria-label="Module consumption ledger" style={panel}>
        <h2 style={{ fontSize: readableTextSize(16), margin: '0 0 5px' }}>Module consumption ledger</h2>
        <p style={{ ...label, margin: '0 0 12px' }}>Provider-confirmed tokens only. Attempts without usage metadata remain unmeasured; credits/costs are not fabricated. Local ledger retains a bounded on-device history.</p>
        {!usage.length && <p style={label}>No provider usage records yet.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {usage.map((u, i) => <div key={u.module + ':' + u.provider + ':' + i} style={{ borderRadius: 9, padding: 12, background: T.surface2 }}>
            <strong style={{ fontSize: readableTextSize(12.5) }}>{u.module} · {u.provider}</strong>
            <div style={{ ...label, marginTop: 4 }}>{format(u.attempts)} attempts · {format(u.fallbacks)} fallback(s) · {format(u.failed)} failed · {format(u.cancelled)} cancelled</div>
            <div style={label}>Known tokens: {format(u.confirmedInputTokens)} input / {format(u.confirmedOutputTokens)} output</div>
            <div style={label}>{format(u.measuredRequests)} measured provider response(s) · {format(u.unmeasuredAttempts)} attempts with unknown usage</div>
          </div>)}
        </div>
        {snapshot?.accountingStatus === 'storage_unavailable' && <p role="alert" style={{ ...label, color: '#fca5a5' }}>Usage history could not be persisted. Check device storage; totals may be incomplete.</p>}
      </section>
    </div>
  )
}
