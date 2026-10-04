import React from 'react'
import ReactDOM from 'react-dom/client'
import './fonts.css'
import './styles.css'
import App from './App'
import ErrorBoundary from './ErrorBoundary'

// Renderer error reporting — connects to the main process's Sentry (inert if it has no DSN).
// Loaded asynchronously so the 460 KB Sentry bundle never blocks initial UI paint.
if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
  import('@sentry/electron/renderer').then(Sentry => {
    try {
      Sentry.init({ beforeSend(e) { if (e.request) delete e.request.data; return e } })
      window.Sentry = Sentry
    } catch {}
  }).catch(() => {})
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
)
