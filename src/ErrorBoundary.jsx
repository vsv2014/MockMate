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
      <div style={{ padding: 20, color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', maxWidth: 420 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>⚠ Something broke</div>
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, marginBottom: 14 }}>
          The overlay hit an unexpected error. Your API keys and saved sessions are safe — reloading usually fixes it.
        </div>
        <button onClick={() => this.setState({ err: null })}
          style={{ padding: '8px 14px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Reload
        </button>
      </div>
    )
  }
}
