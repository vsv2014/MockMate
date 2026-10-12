#!/usr/bin/env node
/**
 * Gate 0 session report: summarizes an exported MockMate diagnostics bundle
 * (Settings → Export logs, format `mockmate-diagnostics-v1`) per Live/Solo session.
 *
 *   node scripts/session-report.mjs <bundle.jsonl> [--session <id>] [--json] [--scoresheet <out.csv>]
 *
 * Diagnostics are metadata only (no questions, answers, résumé or transcript text), so the
 * scoresheet lists committed questions by time; match them to your question script or to
 * the session in History, then fill in the rubric columns (docs/EVALS.md, Gate 0).
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { estimateCost } from '../src/cost.js'

// Provider rows come from the local server and carry no sessionId; they are assigned to
// the session whose time window contains them, plus this grace period for late completions.
const SESSION_GRACE_MS = 30_000
// The early answer start sends the request before the question commits (at most this long
// before, matching SPECULATIVE_HINT_MAX_AGE_MS), so attribution looks back this far.
const EARLY_START_WINDOW_MS = 8_000
const TERMINAL_EVENTS = new Set(['attempt_succeeded', 'attempt_failed', 'attempt_timed_out', 'attempt_cancelled'])

export function parseDiagnostics(text) {
  let header = null
  const rows = []
  let invalid = 0
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { invalid += 1; continue }
    if (!row || typeof row !== 'object') { invalid += 1; continue }
    if (row.type === 'bundle_header') { header = row; continue }
    const t = Date.parse(row.ts)
    if (!Number.isFinite(t)) { invalid += 1; continue }
    rows.push({ ...row, t })
  }
  rows.sort((a, b) => a.t - b.t)
  return { header, rows, invalid }
}

export function percentile(values, p) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (!sorted.length) return null
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]
}

const stats = values => {
  const v = values.filter(x => Number.isFinite(x))
  return {
    count: v.length,
    p50: percentile(v, 50),
    p95: percentile(v, 95),
    max: v.length ? Math.max(...v) : null,
  }
}
const countBy = (items, key) => items.reduce((acc, item) => {
  const k = String(item[key] ?? 'unknown')
  acc[k] = (acc[k] || 0) + 1
  return acc
}, {})

function sessionWindows(rows) {
  const sessions = new Map()
  for (const row of rows) {
    if (!row.sessionId || (row.component !== 'session' && row.component !== 'live')) continue
    const s = sessions.get(row.sessionId) || { sessionId: row.sessionId, kind: row.kind || row.sessionKind || null, start: row.t, end: row.t, ended: false }
    s.start = Math.min(s.start, row.t)
    s.end = Math.max(s.end, row.t)
    if (row.component === 'session' && row.event === 'session_end') s.ended = true
    if (!s.kind && (row.kind || row.sessionKind)) s.kind = row.kind || row.sessionKind
    sessions.set(row.sessionId, s)
  }
  return [...sessions.values()].sort((a, b) => a.start - b.start)
}

function summarizeSession(win, rows) {
  const own = rows.filter(r => r.sessionId === win.sessionId)
  const llm = rows.filter(r => r.component === 'llm' && r.t >= win.start && r.t <= win.end + SESSION_GRACE_MS)
  const session = own.filter(r => r.component === 'session')
  const ev = name => session.filter(r => r.event === name)

  const commits = ev('question_committed')
  const ttft = ev('ttft')
  const succeeded = llm.filter(r => r.event === 'attempt_succeeded')
  const started = llm.filter(r => r.event === 'attempt_started')
  const timedOut = llm.filter(r => r.event === 'attempt_timed_out')
  const usageRows = [
    ...succeeded.filter(r => r.operation === 'stream'),
    ...llm.filter(r => r.event === 'request_usage'),
  ]
  let inputTokens = 0, outputTokens = 0, unknownUsage = 0, costUsd = 0
  for (const r of usageRows) {
    if (Number.isFinite(r.inputTokens) && Number.isFinite(r.outputTokens)) {
      inputTokens += r.inputTokens
      outputTokens += r.outputTokens
      costUsd += estimateCost(r.model || '', r.inputTokens, r.outputTokens)
    } else {
      unknownUsage += 1
    }
  }
  const speculative = own.filter(r => r.component === 'live' && r.event === 'speculative_hint')
  const specStarted = speculative.filter(r => r.outcome === 'started').length
  const specClaimed = speculative.filter(r => r.outcome === 'claimed')
  const sttFinals = ev('stt_final')
  const end = ev('session_end').at(-1) || null

  // One scoresheet row per committed question, correlated by time with the next commit.
  // The answering attempt is the stream attempt that succeeded (else the primary one) and
  // started closest to the commit; early starts begin up to EARLY_START_WINDOW_MS before it.
  const outcomeById = new Map(llm.filter(r => r.attemptId && TERMINAL_EVENTS.has(r.event)).map(r => [r.attemptId, r.event]))
  const streamStarts = started.filter(r => r.operation === 'stream' && outcomeById.get(r.attemptId) !== 'attempt_cancelled')
  const questions = commits.map((c, i) => {
    const next = commits[i + 1]?.t ?? Infinity
    const within = r => r.t >= c.t && r.t < next
    const firstToken = ttft.find(within)
    const nearest = list => [...list].sort((a, b) => Math.abs(a.t - c.t) - Math.abs(b.t - c.t))[0]
    const candidates = streamStarts.filter(r => r.t >= c.t - EARLY_START_WINDOW_MS && r.t < next)
    const attempt = nearest(candidates.filter(r => outcomeById.get(r.attemptId) === 'attempt_succeeded'))
      || nearest(candidates.filter(r => Number(r.attemptIndex || 0) === 0))
    return {
      n: i + 1,
      committedAt: c.ts,
      captureLatencyMs: Number.isFinite(c.captureLatencyMs) ? c.captureLatencyMs : null,
      commitReason: c.reason || null,
      ttftMs: Number.isFinite(firstToken?.ms) ? firstToken.ms : null,
      provider: attempt?.provider || null,
      model: attempt?.model || null,
      providerFallbacks: started.filter(r => within(r) && Number(r.attemptIndex) > 0).length,
      earlyStartClaimed: speculative.some(r => r.outcome === 'claimed' && within(r)),
      incomplete: session.some(r => r.event === 'incomplete_stream' && within(r)),
      error: session.find(r => r.event === 'error' && within(r))?.code || null,
    }
  })

  return {
    sessionId: win.sessionId,
    kind: win.kind,
    startedAt: new Date(win.start).toISOString(),
    durationMin: Math.round(((end?.durationMs ?? (win.end - win.start)) / 60_000) * 10) / 10,
    ended: win.ended,
    questions: {
      committed: commits.length,
      rejectedByReason: countBy(ev('question_reject'), 'reason'),
      captureLatencyMs: stats(commits.map(r => r.captureLatencyMs)),
    },
    answers: {
      ttftFromCommitMs: stats(ttft.map(r => r.ms)),
      incompleteStreams: ev('incomplete_stream').length,
      streamFallbacks: ev('stream_fallback').length,
      skips: ev('skip').length,
      cancelledGenerations: ev('generation_cancelled').length,
      errorsByCode: countBy(ev('error'), 'code'),
    },
    providers: {
      attempts: started.length,
      byModel: countBy(started, 'model'),
      fallbacks: started.filter(r => Number(r.attemptIndex) > 0).length,
      succeeded: succeeded.length,
      failed: llm.filter(r => r.event === 'attempt_failed').length,
      cancelled: llm.filter(r => r.event === 'attempt_cancelled').length,
      timedOutByKind: countBy(timedOut, 'timeoutKind'),
      thinkingSettingRejected: llm.filter(r => r.event === 'thinking_setting_rejected').length,
      ttftMs: stats(succeeded.filter(r => r.operation === 'stream').map(r => r.ttftMs)),
      durationMs: stats(succeeded.map(r => r.durationMs)),
      contextChars: stats(started.map(r => r.contextChars)),
    },
    usage: {
      inputTokens,
      outputTokens,
      requestsWithoutUsage: unknownUsage,
      estimatedCostUsd: Math.round(costUsd * 10_000) / 10_000,
    },
    earlyStart: {
      started: specStarted,
      claimed: specClaimed.length,
      claimRate: specStarted ? Math.round((specClaimed.length / specStarted) * 100) / 100 : null,
      cancelledByReason: countBy(speculative.filter(r => r.outcome === 'cancelled'), 'reason'),
      leadMs: stats(specClaimed.map(r => r.leadMs)),
    },
    stt: {
      finals: sttFinals.length,
      avgConfidence: sttFinals.length
        ? Math.round((sttFinals.reduce((a, r) => a + (Number(r.confidence) || 0), 0) / sttFinals.length) * 1000) / 1000
        : null,
      degradedFinals: sttFinals.filter(r => r.degraded).length,
      reconnects: ev('stt_reconnect').length,
    },
    questionRows: questions,
  }
}

export function buildSessionReports(rows, { sessionId = null } = {}) {
  return sessionWindows(rows)
    .filter(win => !sessionId || win.sessionId === sessionId)
    .map(win => summarizeSession(win, rows))
}

const fmtStats = (s, unit = 'ms') => (s?.count ? `p50 ${s.p50}${unit} · p95 ${s.p95}${unit} · max ${s.max}${unit} (n=${s.count})` : 'n/a')
const fmtCounts = obj => (Object.keys(obj || {}).length ? Object.entries(obj).map(([k, v]) => `${k} ${v}`).join(', ') : 'none')

export function formatReport({ header, reports, invalid = 0 }) {
  const lines = []
  lines.push(`MockMate session report — build ${header?.appVersion || 'unknown'} (${header?.platform || '?'}/${header?.arch || '?'}), exported ${header?.exportedAt || 'unknown'}`)
  if (invalid) lines.push(`Skipped ${invalid} unreadable line(s).`)
  if (!reports.length) lines.push('No Live/Solo sessions found in this bundle.')
  for (const r of reports) {
    lines.push('', `Session ${r.sessionId} · ${r.kind || 'unknown'} · ${r.startedAt} · ${r.durationMin} min${r.ended ? '' : ' · no session_end (crashed or still running?)'}`)
    lines.push(`  Questions: ${r.questions.committed} committed; rejected: ${fmtCounts(r.questions.rejectedByReason)}`)
    lines.push(`  Capture wait (first words heard → commit): ${fmtStats(r.questions.captureLatencyMs)}`)
    lines.push(`  First answer token after commit: ${fmtStats(r.answers.ttftFromCommitMs)}`)
    lines.push(`  Incomplete answers ${r.answers.incompleteStreams} · stream fallbacks ${r.answers.streamFallbacks} · skips ${r.answers.skips} · cancelled ${r.answers.cancelledGenerations} · errors: ${fmtCounts(r.answers.errorsByCode)}`)
    lines.push(`  Provider attempts ${r.providers.attempts} (fallbacks ${r.providers.fallbacks}, failed ${r.providers.failed}, cancelled ${r.providers.cancelled}, timed out: ${fmtCounts(r.providers.timedOutByKind)}); models: ${fmtCounts(r.providers.byModel)}`)
    lines.push(`  Provider TTFT: ${fmtStats(r.providers.ttftMs)} · request size: ${fmtStats(r.providers.contextChars, ' chars')}`)
    if (r.providers.thinkingSettingRejected) lines.push(`  Claude thinking setting rejected ${r.providers.thinkingSettingRejected}×`)
    lines.push(`  Tokens in ${r.usage.inputTokens} / out ${r.usage.outputTokens}; ${r.usage.requestsWithoutUsage} request(s) without provider-reported usage; estimated $${r.usage.estimatedCostUsd} (approximate, reported usage only)`)
    lines.push(`  Early answer start: started ${r.earlyStart.started}, claimed ${r.earlyStart.claimed}${r.earlyStart.claimRate != null ? ` (${Math.round(r.earlyStart.claimRate * 100)}%)` : ''}, lead ${fmtStats(r.earlyStart.leadMs)}; cancelled: ${fmtCounts(r.earlyStart.cancelledByReason)}`)
    lines.push(`  Speech-to-text: ${r.stt.finals} finals, avg confidence ${r.stt.avgConfidence ?? 'n/a'}, degraded ${r.stt.degradedFinals}, reconnects ${r.stt.reconnects}`)
  }
  return lines.join('\n')
}

// Rubric columns are defined in docs/EVALS.md (Gate 0) and must stay fixed between builds.
export const RUBRIC_COLUMNS = ['question_text_or_script_id', 'A_answered_actual_question_0to2', 'B_complete_0to2', 'C_context_correct_0to2_or_NA', 'D_followup_continuity_0to2_or_NA', 'E_first_useful_words_seconds', 'F_usable_as_spoken_0to2', 'notes']

export function toScoresheetCsv(reports) {
  const cols = ['session', 'n', 'committed_at', 'capture_latency_ms', 'ttft_ms', 'provider', 'model', 'early_start_claimed', 'incomplete', 'error', ...RUBRIC_COLUMNS]
  const esc = v => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [cols.join(',')]
  for (const r of reports) {
    for (const q of r.questionRows) {
      lines.push([r.sessionId, q.n, q.committedAt, q.captureLatencyMs, q.ttftMs, q.provider, q.model, q.earlyStartClaimed, q.incomplete, q.error, ...RUBRIC_COLUMNS.map(() => '')].map(esc).join(','))
    }
  }
  return lines.join('\n') + '\n'
}

function parseArgs(argv) {
  const args = { file: null, session: null, json: false, scoresheet: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') args.json = true
    else if (a === '--session') args.session = argv[++i]
    else if (a === '--scoresheet') args.scoresheet = argv[++i]
    else if (!args.file) args.file = a
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.file) {
    console.error('Usage: node scripts/session-report.mjs <bundle.jsonl> [--session <id>] [--json] [--scoresheet <out.csv>]')
    process.exit(2)
  }
  const { header, rows, invalid } = parseDiagnostics(fs.readFileSync(args.file, 'utf8'))
  if (header && header.format !== 'mockmate-diagnostics-v1') console.error(`Warning: unexpected bundle format ${header.format}`)
  const reports = buildSessionReports(rows, { sessionId: args.session })
  if (args.scoresheet) fs.writeFileSync(args.scoresheet, toScoresheetCsv(reports))
  console.log(args.json ? JSON.stringify({ header, reports, invalid }, null, 2) : formatReport({ header, reports, invalid }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error?.message || error); process.exit(1) })
}
