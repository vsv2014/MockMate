// ARCH Product Intelligence — Privacy-first behavioral & funnel engine.
// Captures structured, redacted product flows, friction signals (rage clicks, retries,
// high-latency abandonment), and sequence correlations WITHOUT ever recording resumes,
// interview transcripts, prompts, API keys, passwords, screenshots, or raw audio.

const FORBIDDEN_KEY_RE = /resume|transcript|prompt|full.?answer|answer|question|job.?description|api.?key|authorization|password|secret|token|cookie|credential|screenshot|image.?base64|audio|email|name|location|body|text|message|content|say/i
const SECRET_VALUE_RE = /(sk-[a-z0-9_-]{10,}|Bearer\s+\S+|Token\s+\S+|eyJ[a-zA-Z0-9_-]{8,}\.|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi

const ALLOWED_STRING_KEYS = new Set([
  'sessionId',
  'flow',
  'step',
  'action',
  'target',
  'view',
  'mode',
  'reason',
  'code',
  'templateId',
  'tab',
  'edge',
  'source',
])

const ALLOWED_NUMERIC_KEYS = new Set([
  'ts',
  'durationMs',
  'ttftMs',
  'count',
  'clicks',
  'retries',
  'captureCount',
  'score',
])

const ALLOWED_BOOLEAN_KEYS = new Set([
  'ok',
  'degraded',
  'continuation',
  'teleprompter',
  'optInReplay',
])

export const FLOW_DEFINITIONS = {
  live_interview: {
    id: 'live_interview',
    label: 'Live Interview Funnel',
    steps: [
      { id: 'login', label: 'Login / Auth' },
      { id: 'live_setup', label: 'Live Setup' },
      { id: 'preflight_verified', label: 'Preflight Verified' },
      { id: 'live_started', label: 'Live Started' },
      { id: 'first_hint_rendered', label: 'First Answer Rendered' },
      { id: 'live_ended', label: 'Live Completed' },
    ],
  },
  solo_practice: {
    id: 'solo_practice',
    label: 'Solo Practice Funnel',
    steps: [
      { id: 'login', label: 'Login / Auth' },
      { id: 'solo_setup', label: 'Solo Setup' },
      { id: 'solo_started', label: 'Solo Started' },
      { id: 'solo_evaluated', label: 'Report Evaluated' },
    ],
  },
  screen_solve: {
    id: 'screen_solve',
    label: 'F7 Screen Solve Funnel',
    steps: [
      { id: 'f7_captured', label: 'F7 Captured' },
      { id: 'screen_analyzed', label: 'Screen Analyzed' },
      { id: 'coding_tab_used', label: 'Code/Steps Tab Used' },
    ],
  },
}

export function sanitizeSlug(value, maxLen = 64) {
  if (typeof value !== 'string') return ''
  const cleaned = value
    .replace(SECRET_VALUE_RE, '[redacted]')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned.slice(0, maxLen)
}

/**
 * Aggressively redacts an interaction event so that only structural product
 * telemetry survives. Any resume, transcript, prompt, password, API key, email,
 * or freeform text field is stripped.
 */
export function redactInteractionEvent(raw = {}) {
  if (!raw || typeof raw !== 'object') return null
  const action = sanitizeSlug(raw.action || raw.event || raw.step || '')
  if (!action) return null

  const out = {
    ts: Number.isFinite(Number(raw.ts)) ? Number(raw.ts) : Date.now(),
    action,
  }

  for (const [key, val] of Object.entries(raw)) {
    if (key === 'action' || key === 'ts' || val == null) continue
    if (FORBIDDEN_KEY_RE.test(key)) continue

    if (ALLOWED_STRING_KEYS.has(key) && typeof val === 'string') {
      const slug = sanitizeSlug(val, 72)
      if (slug) out[key] = slug
    } else if (ALLOWED_NUMERIC_KEYS.has(key) && Number.isFinite(Number(val))) {
      out[key] = Math.round(Number(val) * 100) / 100
    } else if (ALLOWED_BOOLEAN_KEYS.has(key) && typeof val === 'boolean') {
      out[key] = val
    }
  }

  return out
}

/**
 * Detects rage clicks (3+ rapid clicks on the same control within windowMs).
 */
export function createRageClickDetector({ threshold = 3, windowMs = 1500 } = {}) {
  const recentByTarget = new Map()

  return function recordClick(target, now = Date.now()) {
    const cleanTarget = sanitizeSlug(target, 64)
    if (!cleanTarget) return null
    const list = (recentByTarget.get(cleanTarget) || []).filter(t => now - t <= windowMs)
    list.push(now)
    recentByTarget.set(cleanTarget, list)
    if (list.length >= threshold) {
      recentByTarget.set(cleanTarget, [])
      return {
        action: 'rage_click',
        target: cleanTarget,
        clicks: list.length,
        ts: now,
      }
    }
    return null
  }
}

/**
 * Groups events into logical user sessions (by explicit sessionId or 30-min inactivity gap).
 */
export function partitionSessions(events = [], gapMs = 30 * 60 * 1000) {
  const valid = (Array.isArray(events) ? events : [])
    .map(redactInteractionEvent)
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)

  if (!valid.length) return []

  const sessions = []
  let current = []

  for (const ev of valid) {
    if (!current.length) {
      current.push(ev)
      continue
    }
    const prev = current[current.length - 1]
    const hasExplicitIds = Boolean(ev.sessionId && prev.sessionId)
    const sameSession = hasExplicitIds
      ? ev.sessionId === prev.sessionId
      : (ev.ts - prev.ts <= gapMs)
    if (sameSession) {
      current.push(ev)
    } else {
      sessions.push(current)
      current = [ev]
    }
  }
  if (current.length) sessions.push(current)
  return sessions
}

/**
 * Analyzes canonical funnels & behavioral patterns across recorded sessions.
 */
export function summarizeProductIntelligence(events = [], options = {}) {
  const redactedEvents = (Array.isArray(events) ? events : [])
    .map(redactInteractionEvent)
    .filter(Boolean)
  const sessions = partitionSessions(redactedEvents)

  // 1. Funnel step reach & drop-off calculation
  const funnels = {}
  for (const [flowId, def] of Object.entries(FLOW_DEFINITIONS)) {
    const stepCounts = def.steps.map(s => ({ ...s, count: 0, conversionPct: 0, dropOffPct: 0 }))
    for (const session of sessions) {
      const actionsInSession = new Set(session.map(e => e.action))
      // A step counts as reached in this session if the action occurred (or a downstream step in the same flow occurred for login)
      const reachedIndices = new Set()
      def.steps.forEach((step, idx) => {
        if (actionsInSession.has(step.id)) reachedIndices.add(idx)
      })
      if (stepCounts[0]?.id === 'login' && reachedIndices.size > 0) {
        reachedIndices.add(0)
      }
      for (const idx of reachedIndices) {
        stepCounts[idx].count += 1
      }
    }

    const entryCount = Math.max(stepCounts[1]?.count || 0, stepCounts[0]?.count || 0)
    stepCounts.forEach((step, idx) => {
      const prevCount = idx === 0 ? step.count : (stepCounts[idx - 1].count || entryCount)
      step.conversionPct = entryCount > 0 ? Math.round((step.count / entryCount) * 100) : 0
      step.dropOffPct = idx > 0 && prevCount > 0
        ? Math.max(0, Math.round(((prevCount - step.count) / prevCount) * 100))
        : 0
    })

    funnels[flowId] = {
      id: flowId,
      label: def.label,
      entryCount,
      steps: stepCounts,
    }
  }

  // 2. Sequence & behavioral pattern correlations
  let liveSetupSessions = 0
  let preflightFailSessions = 0
  let teleprompterSessions = 0
  let resizeBeforeTeleprompterSessions = 0
  let highTtftSessions = 0
  let highTtftAbandonSessions = 0
  let playbookBeforeLiveSessions = 0
  let liveStartedSessions = 0

  for (const session of sessions) {
    const actions = session.map(e => e.action)
    const hasSetup = actions.includes('live_setup')
    const hasPreflightVerified = actions.includes('preflight_verified')
    const hasPreflightFailed = actions.includes('preflight_failed') || actions.includes('preflight_blocked')
    const hasLiveStarted = actions.includes('live_started')

    if (hasSetup || hasPreflightFailed || hasLiveStarted) {
      liveSetupSessions += 1
      if (hasPreflightFailed || (hasSetup && !hasPreflightVerified && !hasLiveStarted)) {
        preflightFailSessions += 1
      }
    }

    if (hasLiveStarted) {
      liveStartedSessions += 1
      if (actions.includes('playbook_template_applied') || actions.includes('playbook_saved')) {
        playbookBeforeLiveSessions += 1
      }
    }

    const firstTeleIdx = actions.indexOf('teleprompter_toggle')
    if (firstTeleIdx !== -1) {
      teleprompterSessions += 1
      const firstResizeIdx = actions.indexOf('overlay_resize')
      if (firstResizeIdx !== -1 && firstResizeIdx < firstTeleIdx) {
        resizeBeforeTeleprompterSessions += 1
      }
    }

    const slowHint = session.find(e => e.action === 'first_hint_rendered' && Number(e.ttftMs) >= 3500)
    if (slowHint) {
      highTtftSessions += 1
      const endEv = session.find(e => e.action === 'live_ended')
      const abandonedEarly = !endEv || (Number.isFinite(endEv.durationMs) && endEv.durationMs < 90_000)
      if (abandonedEarly) highTtftAbandonSessions += 1
    }
  }

  // 3. Friction aggregation (rage clicks, retries, errors)
  const rageTargets = new Map()
  const errorReasons = new Map()
  let retryEvents = 0

  for (const ev of redactedEvents) {
    if (ev.action === 'rage_click' && ev.target) {
      rageTargets.set(ev.target, (rageTargets.get(ev.target) || 0) + 1)
    }
    if (ev.action.endsWith('_retry') || (Number(ev.retries) || 0) > 0) {
      retryEvents += 1
    }
    if (ev.action.endsWith('_failed') || ev.action === 'error' || ev.action === 'preflight_blocked') {
      const key = ev.reason || ev.code || ev.action
      errorReasons.set(key, (errorReasons.get(key) || 0) + 1)
    }
  }

  // 4. Feature adoption counters
  const countAction = name => redactedEvents.filter(e => e.action === name).length
  const featureAdoption = {
    liveSessions: countAction('live_started'),
    soloSessions: countAction('solo_started'),
    teleprompterUses: countAction('teleprompter_toggle'),
    f7Captures: countAction('f7_captured'),
    codingTabSwitches: countAction('coding_tab_used'),
    playbookTemplatesApplied: countAction('playbook_template_applied'),
    answerNowTriggers: countAction('alt_r_answer_now'),
  }

  // 5. Synthesize plain-English "Human Behavior" insights
  const headlineInsights = []

  if (liveSetupSessions > 0) {
    const preflightFailPct = Math.round((preflightFailSessions / liveSetupSessions) * 100)
    if (preflightFailPct > 0) {
      headlineInsights.push({
        id: 'preflight_dropoff',
        severity: preflightFailPct >= 25 ? 'warn' : 'info',
        metric: `${preflightFailPct}%`,
        text: `${preflightFailPct}% of Live setup attempts stall or fail at Live preflight (${preflightFailSessions}/${liveSetupSessions} sessions).`,
      })
    } else {
      headlineInsights.push({
        id: 'preflight_healthy',
        severity: 'ok',
        metric: '100%',
        text: `100% of Live setup sessions passed preflight verification (${liveSetupSessions}/${liveSetupSessions} sessions).`,
      })
    }
  }

  if (teleprompterSessions > 0) {
    const resizeBeforePct = Math.round((resizeBeforeTeleprompterSessions / teleprompterSessions) * 100)
    if (resizeBeforePct > 0) {
      headlineInsights.push({
        id: 'resize_before_teleprompter',
        severity: 'info',
        metric: `${resizeBeforePct}%`,
        text: `Users resize the overlay before using Alt+T teleprompter in ${resizeBeforePct}% of teleprompter sessions (${resizeBeforeTeleprompterSessions}/${teleprompterSessions}).`,
      })
    }
  }

  if (highTtftSessions > 0) {
    const abandonPct = Math.round((highTtftAbandonSessions / highTtftSessions) * 100)
    if (abandonPct > 0) {
      headlineInsights.push({
        id: 'slow_ttft_abandon',
        severity: abandonPct >= 40 ? 'warn' : 'info',
        metric: `${abandonPct}%`,
        text: `${abandonPct}% of sessions with slow first-token latency (>3.5s) ended within 90s (${highTtftAbandonSessions}/${highTtftSessions}).`,
      })
    }
  }

  if (liveStartedSessions > 0 && playbookBeforeLiveSessions > 0) {
    const playbookPct = Math.round((playbookBeforeLiveSessions / liveStartedSessions) * 100)
    headlineInsights.push({
      id: 'playbook_adoption',
      severity: 'ok',
      metric: `${playbookPct}%`,
      text: `${playbookPct}% of Live sessions configured a Custom Prompt Playbook before starting (${playbookBeforeLiveSessions}/${liveStartedSessions}).`,
    })
  }

  for (const [target, count] of [...rageTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
    headlineInsights.push({
      id: `rage_${target}`,
      severity: 'warn',
      metric: `${count}×`,
      text: `Repeated click friction detected on "${target}" (${count} rage-click burst${count === 1 ? '' : 's'}).`,
    })
  }

  return {
    totalEvents: redactedEvents.length,
    totalSessions: sessions.length,
    headlineInsights,
    funnels,
    featureAdoption,
    friction: {
      rageClicks: [...rageTargets.entries()].map(([target, count]) => ({ target, count })),
      retryEvents,
      topErrors: [...errorReasons.entries()].map(([reason, count]) => ({ reason, count })),
    },
    patterns: {
      liveSetupSessions,
      preflightFailSessions,
      teleprompterSessions,
      resizeBeforeTeleprompterSessions,
      highTtftSessions,
      highTtftAbandonSessions,
      playbookBeforeLiveSessions,
    },
    privacyContract: {
      mode: 'structured_redacted',
      optInReplay: Boolean(options.optInReplay),
      excludedData: [
        'resumes',
        'interview_transcripts',
        'prompts',
        'api_keys',
        'passwords',
        'screenshots',
        'raw_meeting_audio',
      ],
    },
  }
}
