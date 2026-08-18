/**
 * Screen ↔ spoken fusion helpers (shared client/server).
 * Screen is CONTEXT for Live answers — never a replacement for the current question.
 */
import { classifyTurn, contextNeedsFor, inferRoleFamily, isCodingTransformFollowUp } from './interviewClassify.js'

export const SCREEN_CONTEXT_VERSION = 'screen_ctx_v1'

/** Freshness window — older captures are not auto-attached to new spoken questions. */
export const SCREEN_FRESH_MS = 3 * 60 * 1000

/** Map vision contentType / aliases → coarse screen family used for relevance. */
export function normalizeScreenContentType(raw) {
  const t = String(raw || '').toLowerCase().trim()
  if (!t) return 'screen_unknown'
  if (t === 'coding' || t === 'screen_code' || t === 'code') return 'screen_code'
  if (t === 'system_design' || t === 'screen_diagram' || t === 'diagram' || t === 'architecture') return 'screen_diagram'
  if (t === 'slide' || t === 'screen_slide' || t === 'presentation') return 'screen_slide'
  if (t === 'behavioral' || t === 'screen_text') return 'screen_text'
  if (t === 'screen_document' || t === 'document' || t === 'pdf') return 'screen_document'
  if (t === 'screen_spreadsheet' || t === 'spreadsheet' || t === 'table') return 'screen_spreadsheet'
  if (t === 'screen_ui' || t === 'ui' || t === 'mockup' || t === 'figma') return 'screen_ui'
  if (t === 'other') return 'screen_unknown'
  if (t.startsWith('screen_')) return t
  return 'screen_unknown'
}

/** Legacy vision enum for analyzeScreen JSON schema (backward compatible). */
export function toLegacyContentType(normalized) {
  switch (normalizeScreenContentType(normalized)) {
    case 'screen_code': return 'coding'
    case 'screen_diagram': return 'system_design'
    case 'screen_slide': return 'slide'
    case 'screen_text': return 'behavioral'
    default: return 'other'
  }
}

/**
 * Context for the standalone vision call (analyzeScreen).
 * Soft: keep selected-doc RAG eligible; avoid full resume dump on code/diagram screens.
 */
export function contextNeedsForScreenAnalysis({ spokenQuestion, profile, contentTypeHint } = {}) {
  if (spokenQuestion && String(spokenQuestion).trim()) {
    const c = classifyTurn({ question: spokenQuestion, profile })
    const n = normalizeScreenContentType(contentTypeHint)
    if (n === 'screen_code' || n === 'screen_diagram' || n === 'screen_document' || n === 'screen_spreadsheet') {
      return { ...c.contextNeeds, resume: 'none', jd: 'none', rag: true, codingLanguage: true }
    }
    return c.contextNeeds
  }
  const n = normalizeScreenContentType(contentTypeHint)
  if (n === 'screen_text' || n === 'behavioral') {
    return contextNeedsFor('behavioral')
  }
  // Standalone F7: no resume dump; knowledge banks still eligible.
  return {
    identity: true,
    resume: 'none',
    jd: 'none',
    rag: true,
    ragTypes: null,
    customPrompt: true,
    codingLanguage: true,
    history: false,
  }
}

const DEICTIC_SCREEN = /\b(this|that|these|those|here|the screen|on (?:the |my )?screen|what(?:'s| is) (?:wrong |wrong with )?(?:this|that)|find the bug|optimize this|implement this|explain (?:this|the) (?:code|architecture|diagram|design|mockup|ui|page|table|slide))\b/i
const CODE_SCREEN_Q = /\b(code|bug|complexity|leetcode|algorithm|function|implement|compile|runtime|optimize this|data structures?|in[- ]?place|o\(1\)\s*space|without (?:using )?(?:any )?(?:extra )?space)\b/i
const DIAGRAM_SCREEN_Q = /\b(architecture|diagram|design|component|service|schema|erd|flow)\b/i
const UI_SCREEN_Q = /\b(ui|ux|mockup|wireframe|layout|screen design|figma|prototype)\b/i
const DOC_SCREEN_Q = /\b(document|slide|spreadsheet|table|chart|this number|this metric)\b/i

function codingScreenFamily(screen) {
  if (!screen || screen.error) return false
  const t = normalizeScreenContentType(screen.contentType || screen.analysis?.contentType)
  return t === 'screen_code'
}

function codingParentType(classification) {
  const t = classification?.questionType === 'follow_up'
    ? classification?.parentType
    : classification?.questionType
  return t === 'dsa' || t === 'coding' || t === 'screen_code'
}

/**
 * Deterministic relevance: should this recent screen be attached to the spoken question?
 * @returns {{ attach: boolean, reason: string, score: number }}
 */
export function evaluateScreenRelevance({
  question = '',
  classification = null,
  screen = null,
  now = Date.now(),
} = {}) {
  if (!screen || screen.error) {
    return { attach: false, reason: 'no_usable_screen', score: 0 }
  }
  const q = String(question || '').trim()
  if (!q) return { attach: false, reason: 'empty_question', score: 0 }

  const age = now - (screen.timestamp || 0)
  if (!screen.timestamp || age < 0 || age > SCREEN_FRESH_MS) {
    return { attach: false, reason: 'stale_screen', score: 0 }
  }

  const c = classification || classifyTurn({ question: q })
  const qt = c.questionType
  const screenType = normalizeScreenContentType(screen.contentType || screen.analysis?.contentType)

  // Never attach screen to pure experience / intro / company / sales objections, etc.
  const neverAttach = new Set([
    'intro', 'experience', 'resume', 'behavioral', 'situational', 'leadership',
    'company', 'candidate_questions', 'sales_roleplay', 'customer_scenario',
  ])
  if (neverAttach.has(qt) && !DEICTIC_SCREEN.test(q)) {
    return { attach: false, reason: `question_type_${qt}`, score: 0 }
  }

  // Coding transform follow-ups after F7 / DSA — MUST keep the visible problem + prior solution.
  if (codingScreenFamily(screen) && (
    isCodingTransformFollowUp(q)
    || (c.isFollowUp && codingParentType(c))
    || (codingParentType(c) && CODE_SCREEN_Q.test(q))
  )) {
    return { attach: true, reason: 'coding_transform_or_followup', score: 0.92 }
  }

  // Explicit deictic reference to visible content.
  if (DEICTIC_SCREEN.test(q) || qt === 'screen_code' || qt === 'screen_diagram') {
    if (qt === 'screen_code' || CODE_SCREEN_Q.test(q)) {
      if (screenType === 'screen_code') return { attach: true, reason: 'deictic_code', score: 0.95 }
      return { attach: screenType !== 'screen_unknown', reason: 'deictic_prefer_any', score: 0.7 }
    }
    if (qt === 'screen_diagram' || DIAGRAM_SCREEN_Q.test(q)) {
      if (screenType === 'screen_diagram') return { attach: true, reason: 'deictic_diagram', score: 0.95 }
      return { attach: true, reason: 'deictic_any_diagram_ask', score: 0.75 }
    }
    if (UI_SCREEN_Q.test(q) && (screenType === 'screen_ui' || screenType === 'screen_slide')) {
      return { attach: true, reason: 'deictic_ui', score: 0.9 }
    }
    if (DOC_SCREEN_Q.test(q) && (screenType === 'screen_document' || screenType === 'screen_spreadsheet' || screenType === 'screen_slide')) {
      return { attach: true, reason: 'deictic_doc', score: 0.85 }
    }
    // "What is wrong with this?" with fresh screen
    return { attach: true, reason: 'deictic_generic', score: 0.8 }
  }

  // Product case + UI mockup
  if (qt === 'product_case' && screenType === 'screen_ui') {
    return { attach: true, reason: 'pm_ui_mockup', score: 0.8 }
  }

  // DSA/coding spoken with coding screen visible — useful but only if question is coding-shaped
  if ((qt === 'dsa' || qt === 'coding') && screenType === 'screen_code' && CODE_SCREEN_Q.test(q)) {
    return { attach: true, reason: 'dsa_with_code_screen', score: 0.75 }
  }

  // Follow-ups of coding/screen_code with fresh code screen — keep thread even without "this".
  if (qt === 'follow_up' && codingParentType(c) && screenType === 'screen_code') {
    return { attach: true, reason: 'followup_coding_parent', score: 0.88 }
  }

  // Soft: fresh code/diagram is eligible for non-career turns — classifier must not delete evidence.
  // Unknown/unrelated desktop still skipped (screen_unknown / UI without signals already handled).
  if (screenType === 'screen_code' || screenType === 'screen_diagram') {
    return { attach: true, reason: 'soft_fresh_screen', score: 0.55 }
  }

  return { attach: false, reason: 'default_no_attach', score: 0 }
}

/** Compact block for Live LLM user message (no raw image). */
export function buildScreenContextBlock(screen, { maxChars = 1800 } = {}) {
  if (!screen || screen.error) return ''
  const a = screen.analysis || screen
  const type = normalizeScreenContentType(a.contentType || screen.contentType)
  const parts = [
    `RELEVANT SCREEN CONTEXT (${SCREEN_CONTEXT_VERSION}) — evidence for the CURRENT question only; do not invent pixels not described here:`,
    `contentType: ${type}`,
  ]
  if (a.detectedText) parts.push(`visibleText: ${String(a.detectedText).slice(0, 400)}`)
  if (a.pattern) parts.push(`pattern: ${a.pattern}`)
  if (a.complexity) parts.push(`complexity: ${a.complexity}`)
  if (a.language) parts.push(`codeLanguage: ${a.language}`)
  if (Array.isArray(a.approach) && a.approach.length) parts.push(`approach: ${a.approach.slice(0, 6).join(' | ')}`)
  if (a.code) parts.push(`codeExcerpt:\n${String(a.code).slice(0, 900)}`)
  if (Array.isArray(a.keyPoints) && a.keyPoints.length) parts.push(`keyPoints: ${a.keyPoints.slice(0, 5).join('; ')}`)
  if (a.fullAnswer) parts.push(`screenSummary: ${String(a.fullAnswer).slice(0, 500)}`)
  if (a.watchOut) parts.push(`watchOut: ${a.watchOut}`)
  const out = parts.join('\n')
  return out.length > maxChars ? out.slice(0, maxChars) + '…' : out
}

/** Cheap fingerprint for analysis cache (not cryptographic). */
export function screenFingerprint(base64, { language = '', style = '', context = '' } = {}) {
  const s = String(base64 || '')
  if (!s) return ''
  const mid = Math.max(0, Math.floor(s.length / 2) - 20)
  const ctx = String(context || '')
  // Keep the key small while invalidating cached answers when candidate/session
  // instructions change. This is a cache discriminator, not a security hash.
  let ctxHash = 2166136261
  for (let i = 0; i < ctx.length; i++) ctxHash = Math.imul(ctxHash ^ ctx.charCodeAt(i), 16777619)
  return `${s.length}:${s.slice(0, 48)}:${s.slice(mid, mid + 48)}:${s.slice(-48)}:${language}:${style}:${(ctxHash >>> 0).toString(36)}`
}

export function createScreenContextRecord({
  analysis,
  displayId = null,
  displayName = null,
  fingerprint = '',
  mime = 'image/jpeg',
  error = null,
  status = 'analyzed',
} = {}) {
  const id = `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  if (error) {
    return {
      screenContextId: id,
      timestamp: Date.now(),
      contentType: 'screen_unknown',
      analysis: null,
      error: String(error),
      status: status || 'failed',
      displayId,
      displayName,
      fingerprint,
      mime,
      version: SCREEN_CONTEXT_VERSION,
    }
  }
  const contentType = normalizeScreenContentType(analysis?.contentType)
  return {
    screenContextId: id,
    timestamp: Date.now(),
    contentType,
    analysis: {
      ...analysis,
      contentType: toLegacyContentType(contentType),
      screenFamily: contentType,
    },
    error: null,
    status: status || 'analyzed',
    displayId,
    displayName,
    fingerprint,
    mime,
    version: SCREEN_CONTEXT_VERSION,
  }
}

/** Dev-only structured trace (no secrets / no image bytes). */
export function formatScreenDebugTrace({
  capture,
  classification,
  relevance,
  playbook,
  attached,
} = {}) {
  return {
    v: SCREEN_CONTEXT_VERSION,
    capture: capture ? {
      id: capture.screenContextId,
      type: capture.contentType,
      ageMs: capture.timestamp ? Date.now() - capture.timestamp : null,
      status: capture.status,
      displayId: capture.displayId || null,
      error: capture.error || null,
    } : null,
    spoken: classification ? {
      questionType: classification.questionType,
      playbook: classification.playbookKey,
      roleFamily: classification.roleFamily,
      isFollowUp: classification.isFollowUp,
    } : null,
    relevance: relevance || null,
    playbook: playbook || classification?.playbookKey || null,
    attached: !!attached,
  }
}

export { inferRoleFamily, classifyTurn }
