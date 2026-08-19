import React from 'react'

// Catches render-time crashes so a single bad render shows a recoverable panel instead of
// a blank overlay mid-interview. Reports to Sentry if it's initialized (no-op otherwise).
export default class ErrorBoundary extends React.Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) {
    try { window.Sentry?.captureException?.(err, { extra: { componentStack: info?.componentStack } }) } catch {}
    console.error('[MockMate] render crash:', err, info?.componentStack)
  }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div style={{ padding: 20, color: '#E8E8EC', fontFamily: "'Kanit', system-ui, -apple-system, sans-serif", maxWidth: 420, background: '#08080C' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>⚠ Something broke</div>
        <div style={{ fontSize: 12, color: '#8A8A8E', lineHeight: 1.6, marginBottom: 10 }}>
          The overlay hit an unexpected error. Your API keys and saved sessions are safe — reloading usually fixes it.
        </div>
        {this.state.err && (
          <pre style={{ fontSize: 11, color: '#fca5a5', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, maxWidth: 560, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
            {String(this.state.err?.message || this.state.err)}
            {this.state.err?.stack ? '\n\n' + this.state.err.stack.split('\n').slice(0, 6).join('\n') : ''}
          </pre>
        )}
        <button onClick={() => window.location.reload()}
          style={{ padding: '8px 14px', background: '#14B8A6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Reload
        </button>
      </div>
    )
  }
}
