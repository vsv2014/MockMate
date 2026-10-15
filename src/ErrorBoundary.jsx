import { readableTextSize } from './lib/typography.js'
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
      <div role="alert" aria-labelledby="mm-crash-title" style={{ padding: 20, color: '#E8E8EC', fontFamily: "'Kanit', system-ui, -apple-system, sans-serif", maxWidth: 420, background: '#08080C' }}>
        <h1 id="mm-crash-title" style={{ margin: '0 0 6px', fontWeight: 700, fontSize: readableTextSize(14) }}>⚠ Something broke</h1>
        <div style={{ fontSize: readableTextSize(12), color: '#8A8A8E', lineHeight: 1.6, marginBottom: 10 }}>
          The overlay hit an unexpected error. Your saved sessions and settings remain on this device. If an interview was still in progress, unsaved turns may be lost when you reload.
        </div>
        {this.state.err && (
          <details style={{ marginBottom: 14 }}>
            <summary style={{ color: '#fca5a5', fontSize: readableTextSize(11), cursor: 'pointer', marginBottom: 8 }}>Technical details (for support)</summary>
            <pre style={{ fontSize: readableTextSize(11), color: '#fca5a5', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 12px', margin: 0, maxWidth: 560, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
              {String(this.state.err?.message || this.state.err)}
              {this.state.err?.stack ? '\n\n' + this.state.err.stack.split('\n').slice(0, 6).join('\n') : ''}
            </pre>
          </details>
        )}
        <button type="button" onClick={() => window.location.reload()}
          style={{ padding: '8px 14px', background: '#14B8A6', color: '#fff', border: 'none', borderRadius: 8, fontSize: readableTextSize(12), fontWeight: 700, cursor: 'pointer' }}>
          Reload MockMate
        </button>
      </div>
    )
  }
}
