/**
 * Live session orchestration helpers — keeps capture/GM/visionPolicy untouched.
 * LiveCompanion remains the React view; this module owns transport + cleanup helpers.
 */
import { streamLiveHint, fetchLiveHintFallback } from './hintTransport.js'

/**
 * @param {object} deps
 * @param {() => boolean} deps.isCurrent
 * @param {AbortSignal} deps.signal
 * @param {() => object} deps.getHintBody
 * @param {(ev: any) => any} deps.onStreamEvent
 * @param {(hint: object) => void} deps.onFallbackHint
 * @param {() => void} [deps.onMarkFallback]
 * @param {() => void} [deps.onSkip]
 */
export function createLiveSessionController(deps) {
  const {
    isCurrent,
    getSignal,
    getHintBody,
    onStreamEvent,
    onFallbackHint,
    onMarkFallback,
    onSkip,
  } = deps

  async function runFallback() {
    if (!isCurrent()) return
    const d = await fetchLiveHintFallback({
      body: getHintBody(),
      signal: getSignal?.(),
      isCurrent,
    })
    if (!d || !isCurrent()) return
    const h = d.hint
    if (!h || h.skip) { onSkip?.(); return }
    onFallbackHint?.(h)
  }

  async function generateViaTransport() {
    const mode = await streamLiveHint({
      body: getHintBody(),
      signal: getSignal?.(),
      isCurrent,
      onEvent: onStreamEvent,
      onFallback: async () => {
        onMarkFallback?.()
        await runFallback()
      },
    })
    return mode
  }

  return {
    generateViaTransport,
    runFallback,
  }
}
