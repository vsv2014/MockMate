// Client-side product insights collector (the "ARCH Product Intelligence" engineering layer).
// Stores a bounded, redacted ring buffer of interaction & flow events in local storage.
// Events reach the local diagnostic store only when the user opts in to breadcrumbs.
import {
  redactInteractionEvent,
  summarizeProductIntelligence,
  sanitizeSlug,
} from '../../shared/productIntelligence.js'
import { diagnostic } from './diagnostics.js'
import { getScopedItem, setScopedItem, removeScopedItem } from './accountScope.js'

const STORAGE_KEY = 'mm-product-intel-v2'
// v1 rage-click events could hold a slug of a button's visible label, which can include
// a document name, a question, a session label or the account name. Never read it; delete it.
const LEGACY_STORAGE_KEYS = ['mm-product-intel-v1']
const REPLAY_OPTIN_KEY = 'mm-product-intel-replay-optin-v1'
const MAX_STORED_EVENTS = 600
const RAGE_CLICK_THRESHOLD = 3
const RAGE_CLICK_WINDOW_MS = 1500

let sessionId = `pi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
const listeners = new Set()

function purgeLegacyEvents() {
  for (const key of LEGACY_STORAGE_KEYS) {
    try { removeScopedItem(key) } catch {}
  }
}

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
  purgeLegacyEvents()
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
    // The opt-in decides whether usage breadcrumbs also go to the local diagnostics log
    // (and therefore into exported log bundles). Default OFF.
    if (getReplayOptIn()) diagnostic('product_intel', clean.action, clean)
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
  purgeLegacyEvents()
  notify()
}

// Long digit runs, or hex runs that contain digits, are dynamic values (room codes,
// generated ids, dates), never control names.
function looksDynamic(value) {
  if (/\d{4,}/.test(value)) return true
  return (value.match(/[0-9a-f]{6,}/gi) || []).some(run => /\d/.test(run))
}

/**
 * Fixed, content-free identifier for a clicked control: `data-pi-target`, else a clean `id`,
 * else a coarse "<section>:<role>" descriptor from the nearest `data-pi-section`.
 * Visible text, `aria-label`, `title` and `name` are never read: they can contain a
 * document name, an interview question, a session label or the account name.
 */
export function fixedControlTarget(el) {
  const explicit = sanitizeSlug(el?.getAttribute?.('data-pi-target') || '', 48)
  if (explicit) return explicit
  const id = sanitizeSlug(el?.getAttribute?.('id') || '', 48)
  if (id && !looksDynamic(id)) return id
  let section = ''
  try { section = sanitizeSlug(el?.closest?.('[data-pi-section]')?.getAttribute?.('data-pi-section') || '', 24) } catch {}
  const role = sanitizeSlug(el?.getAttribute?.('role') || String(el?.tagName || 'control').toLowerCase(), 16) || 'control'
  return section ? `${section}:${role}` : role
}

/**
 * Attaches a global click listener that detects repeated/rage clicks on buttons.
 * Bursts are detected per element in memory only; the stored event carries just the
 * fixed identifier from fixedControlTarget(), never user-typed input or visible content.
 */
export function attachRageClickObserver(root = typeof document !== 'undefined' ? document : null) {
  if (!root?.addEventListener) return () => {}
  const clicksByElement = new WeakMap()

  const handler = (e) => {
    try {
      const control = e.target?.closest?.('button, [role="button"], [data-pi-target]')
      if (!control) return
      const now = Date.now()
      const recent = (clicksByElement.get(control) || []).filter(t => now - t <= RAGE_CLICK_WINDOW_MS)
      recent.push(now)
      if (recent.length >= RAGE_CLICK_THRESHOLD) {
        clicksByElement.set(control, [])
        trackProductEvent('rage_click', { target: fixedControlTarget(control), clicks: recent.length })
      } else {
        clicksByElement.set(control, recent)
      }
    } catch {}
  }

  root.addEventListener('click', handler, true)
  return () => root.removeEventListener('click', handler, true)
}
