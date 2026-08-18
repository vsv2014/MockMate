import { normalizeScreenContentType } from './screenContext.js'

export const CODING_SESSION_CONTEXT_VERSION = 'coding_session_ctx_v1'

const CODING_TURN = new Set(['coding', 'dsa', 'screen_code'])
const CODE_REFERENCE = /\b(this|that|the|my|above|previous|same)\s+(code|solution|algorithm|function|implementation|problem)\b|\b(convert|rewrite|write|implement|optimi[sz]e|debug|fix|explain)\s+(it|this|that)\b|\b(in|using)\s+(python|java(?:script)?|typescript|c\+\+|c#|go|golang|ruby)\b/i

export function isCodingScreen(screen) {
  if (!screen || screen.error) return false
  return normalizeScreenContentType(screen.contentType || screen.analysis?.contentType) === 'screen_code'
}

/** Keep the last real coding capture for this interview session. */
export function updateCodingSessionContext(previous, screen) {
  if (!isCodingScreen(screen)) return previous || null
  return {
    ...screen,
    codingSessionContextVersion: CODING_SESSION_CONTEXT_VERSION,
    capturedAt: screen.timestamp || Date.now(),
  }
}

/**
 * Prefer the current screen. Restore the session coding capture only for a coding
 * turn or an explicit transform/reference. Never leak it into career questions.
 */
export function selectScreenForTurn({ question = '', classification, recentScreen, codingScreen } = {}) {
  if (isCodingScreen(recentScreen)) return recentScreen
  if (!codingScreen) return recentScreen || null
  const type = classification?.questionType === 'follow_up'
    ? classification?.parentType
    : classification?.questionType
  const codingTurn = CODING_TURN.has(type) || CODE_REFERENCE.test(String(question || ''))
  if (!codingTurn) return recentScreen || null
  // Refresh only the relevance timestamp on the derived record. Preserve the true
  // capture time separately so diagnostics never claim a new screenshot occurred.
  return {
    ...codingScreen,
    timestamp: Date.now(),
    restoredFromCodingSession: true,
  }
}
