// Client-side ARCH Product Intelligence collector.
// Stores a bounded, redacted ring buffer of interaction & flow events in local storage
// and forwards metadata-only breadcrumbs to the local diagnostic store.
import {
  redactInteractionEvent,
  createRageClickDetector,
  summarizeProductIntelligence,
  sanitizeSlug,
} from '../../shared/productIntelligence.js'
import { diagnostic } from './diagnostics.js'
import { getScopedItem, setScopedItem, removeScopedItem } from './accountScope.js'

const STORAGE_KEY = 'mm-product-intel-v1'
const REPLAY_OPTIN_KEY = 'mm-product-intel-replay-optin-v1'
const MAX_STORED_EVENTS = 600

let sessionId = `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
const rageDetector = createRageClickDetector({ threshold: 3, windowMs: 1500 })
const listeners = new Set()

function notify() {
  for (const fn of listeners) {
    try { fn() } catch {}
  }
}

export function subscribeProductIntelligence(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getReplayOptIn() {
  try {
    return getScopedItem(REPLAY_OPTIN_KEY) === '1'
  } catch {
    return false
  }
}

export function setReplayOptIn(enabled) {
  const next = Boolean(enabled)
  try {
    setScopedItem(REPLAY_OPTIN_KEY, next ? '1' : '0')
  } catch {}
  trackProductEvent(next ? 'replay_opt_in_enabled' : 'replay_opt_in_disabled', { optInReplay: next })
  notify()
  return next
}

export function readProductEvents() {
  try {
    const raw = getScopedItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(redactInteractionEvent).filter(Boolean) : []
  } catch {
    return []
  }
}

function writeProductEvents(events) {
  try {
    const bounded = events.slice(-MAX_STORED_EVENTS)
    setScopedItem(STORAGE_KEY, JSON.stringify(bounded))
  } catch {}
}

export function trackProductEvent(action, fields = {}) {
  try {
    const clean = redactInteractionEvent({
      ts: Date.now(),
      sessionId,
      action,
      ...fields,
    })
    if (!clean) return null
    const events = readProductEvents()
    events.push(clean)
    writeProductEvents(events)
    diagnostic('product_intel', clean.action, clean)
    notify()
    return clean
  } catch {
    return null
  }
}

export function getProductIntelligenceReport(runtimePerformance = null) {
  const events = readProductEvents()
  return summarizeProductIntelligence(events, {
    optInReplay: getReplayOptIn(),
    runtimePerformance: runtimePerformance || undefined,
  })
}

export function clearProductIntelligenceEvents() {
  try {
    removeScopedItem(STORAGE_KEY)
  } catch {}
  notify()
}

/**
 * Attaches a global click listener that detects repeated/rage clicks on buttons
 * using only structural attributes (`data-pi-target`, `id`, `aria-label`, `name`) —
 * never user-typed input values or freeform content.
 */
export function attachRageClickObserver(root = typeof document !== 'undefined' ? document : null) {
  if (!root?.addEventListener) return () => {}

  const handler = (e) => {
    try {
      const btn = e.target?.closest?.('button, [role="button"], [data-pi-target]')
      if (!btn) return
      const rawTarget =
        btn.getAttribute?.('data-pi-target') ||
        btn.getAttribute?.('id') ||
        btn.getAttribute?.('aria-label') ||
        btn.getAttribute?.('title') ||
        btn.getAttribute?.('name') ||
        ''
      const slug = sanitizeSlug(rawTarget, 48)
      if (!slug) return
      const burst = rageDetector(slug, Date.now())
      if (burst) {
        trackProductEvent('rage_click', { target: burst.target, clicks: burst.clicks })
      }
    } catch {}
  }

  root.addEventListener('click', handler, true)
  return () => root.removeEventListener('click', handler, true)
}
