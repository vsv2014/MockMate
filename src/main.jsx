import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import './fonts.css'
import './styles.css'
import App from './App'
import ErrorBoundary from './ErrorBoundary'

// Renderer error reporting — connects to the main process's Sentry (inert if it has no DSN).
// Exposes window.Sentry for the ErrorBoundary. Guarded so it can never break startup.
try {
  Sentry.init({ beforeSend(e) { if (e.request) delete e.request.data; return e } })
  window.Sentry = Sentry
} catch {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
)
