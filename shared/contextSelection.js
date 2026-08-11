/**
 * Explicit context source selection for Live (M1 observability + contamination guards).
 * Asserts *which* sources may enter the prompt — not the LLM prose.
 */

import { contextNeedsFor } from './interviewClassify.js'

/**
 * @returns {{
 *   allowed: string[],
 *   forbidden: string[],
 *   needs: object,
 * }}
 */
export function resolveContextSources({
  classification = null,
  screenRelevant = false,
  hasPriorTopicDiscussion = false,
} = {}) {
  const qt = classification?.questionType || 'unknown'
  const isFollowUp = !!classification?.isFollowUp
  const parentType = classification?.parentType || null
  const needs = classification?.contextNeeds
    || contextNeedsFor(qt, { isFollowUp, parentType })

  /** @type {string[]} */
  const allowed = []
  /** @type {string[]} */
  const forbidden = []

  if (needs.identity) allowed.push('identity')
  if (needs.resume === 'full') allowed.push('resume_full')
  else if (needs.resume === 'short') allowed.push('resume_short')
  else forbidden.push('resume')

  if (needs.jd === 'full') allowed.push('jd_full')
  else if (needs.jd === 'short') allowed.push('jd_short')
  else forbidden.push('jd')

  if (needs.rag) allowed.push('rag_docs')
  else forbidden.push('rag_docs')

  if (needs.codingLanguage) allowed.push('coding_language')
  if (needs.customPrompt) allowed.push('custom_prompt')

  if (needs.history) {
    allowed.push('conversation_history')
    if (hasPriorTopicDiscussion || isFollowUp) allowed.push('previous_topic_discussion')
  } else {
    forbidden.push('conversation_history')
  }

  if (screenRelevant) allowed.push('screen')
  else forbidden.push('screen')

  // Contamination fences — experience/behavioral must not pull HLD/DSA screen.
  const experienceish = new Set([
    'intro', 'experience', 'resume', 'behavioral', 'situational', 'leadership',
    'project', 'project_walkthrough', 'company',
  ])
  const effectiveType = isFollowUp && parentType ? parentType : qt
  if (experienceish.has(effectiveType) || experienceish.has(qt)) {
    forbidden.push('stale_system_design', 'stale_dsa', 'irctc_architecture')
    // Strip previous_topic if this is a fresh experience Q (not follow-up of experience)
    if (!isFollowUp || !experienceish.has(parentType || '')) {
      const i = allowed.indexOf('previous_topic_discussion')
      if (i >= 0) allowed.splice(i, 1)
      if (!forbidden.includes('previous_topic_discussion')) forbidden.push('previous_topic_discussion')
      if (!forbidden.includes('previous_hld')) forbidden.push('previous_hld')
    }
  }

  // System-design / DSA: HLD/DSA history OK; full resume dump forbidden (short fact card soft-allowed).
  if (effectiveType === 'system_design' || effectiveType === 'dsa' || effectiveType === 'coding' || effectiveType === 'screen_code') {
    if (needs.resume !== 'full') {
      if (!forbidden.includes('resume_dump')) forbidden.push('resume_dump')
    }
    if (isFollowUp || hasPriorTopicDiscussion) {
      if (!allowed.includes('previous_hld') && effectiveType === 'system_design') allowed.push('previous_hld')
      if (!allowed.includes('previous_dsa') && (effectiveType === 'dsa' || effectiveType === 'coding' || effectiveType === 'screen_code')) {
        allowed.push('previous_dsa')
      }
    }
  }

  return { allowed: [...new Set(allowed)], forbidden: [...new Set(forbidden)], needs }
}

/** Format one-line M1 debug trace. */
export function formatInterviewDevTrace(trace) {
  if (!trace) return '[mm-trace] empty'
  const c = trace.classification || {}
  return [
    `[mm-trace] ${trace.questionId || '?'}`,
    `type=${c.questionType || '?'}`,
    c.isFollowUp ? `follow_up parent=${trace.parent || '?'}` : 'root',
    c.parentType ? `parentType=${c.parentType}` : null,
    `context=[${(trace.contextSources || []).join(',')}]`,
    `screen=${trace.screen?.relevant ? 'attached' : 'ignored'}`,
    `generation=${trace.generationId || '-'}`,
    `status=${trace.generationStatus || '-'}`,
    trace.answerPreview ? `answer≈${JSON.stringify(trace.answerPreview)}` : null,
  ].filter(Boolean).join(' ')
}
