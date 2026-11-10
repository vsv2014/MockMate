#!/usr/bin/env node
// Analyze *real* exported MockMate diagnostics after a supervised long-running
// Windows Live test. This tool does not simulate microphone, OS capture, or
// paid AI providers and cannot certify them without actual event evidence.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MIN_LIVE_SOAK_MS = 60 * 60 * 1000

export function analyzeLiveSession(rows, { minDurationMs = MIN_LIVE_SOAK_MS, sessionId = null } = {}) {
  const ends = rows.filter(r => r?.component === 'session' && r.event === 'session_end' &&
    (r.sessionKind === 'live' || r.kind === 'live') &&
    (!sessionId || r.sessionId === sessionId))
  const ending = ends.at(-1)
  if (!ending) {
    return { passed: false, failures: ['No completed Live session was found in this diagnostic bundle'],
      warnings: [], checks: {}, metrics: {} }
  }
  const session = rows.filter(r => r?.sessionId === ending.sessionId)
  const ordered = session.filter(r => Number.isFinite(Date.parse(r.ts))).sort((a,b) => Date.parse(a.ts)-Date.parse(b.ts))
  const start = ordered.find(r => r.component === 'session' && r.event === 'session_start')
  const captures = ordered.filter(r => r.component === 'stt' && r.event === 'candidate_microphone_final')
  const opens = ordered.filter(r => r.component === 'stt' && r.event === 'socket_open')
  const systemOpens = opens.filter(r => r.mode === 'system_audio' || r.source === 'system')
  const micOpens = opens.filter(r => r.mode === 'microphone')
  const speech = ordered.filter(r => r.component === 'session' && r.event === 'stt_final')
  const commits = ordered.filter(r => r.component === 'session' && r.event === 'question_committed')
  const ttfts = ordered.filter(r => r.component === 'session' && r.event === 'ttft')
  const stopFrames = ordered.filter(r => r.component === 'stt' && r.event === 'audio_frames_stalled')
  const resumedFrames = ordered.filter(r => r.component === 'stt' && r.event === 'audio_frames_resumed')
  const history = rows.filter(r => r.component === 'session' && r.runId === ending.sessionId && r.event === 'history_commit_succeeded')
  const latestHistory = history.at(-1)
  const duration = Number(ending.durationMs) || 0
  const failures = [], warnings = []
  const checks = {
    duration: duration >= minDurationMs,
    completeTelemetry: Boolean(start),
    systemAudioConnected: systemOpens.length > 0,
    candidateMicConnected: micOpens.length > 0,
    candidateResponses: captures.length >= 5,
    questionsCommitted: commits.length >= 10,
    hintsDelivered: (Number(ending.hints) || 0) >= 10 && ttfts.length >= 10,
    audioCaptureHealthy: stopFrames.length === 0 || resumedFrames.length >= stopFrames.length,
    userVisibleErrors: (Number(ending.errors) || 0) === 0,
    completedStreams: (Number(ending.incompleteStreams) || 0) === 0,
    historyPersisted: Boolean(latestHistory && latestHistory.captureStatus === 'captured'),
    evaluationScored: latestHistory?.evaluationStatus === 'scored',
  }
  const descriptions = {
    duration: 'Live recording shorter than 60 minutes',
    completeTelemetry: 'Session start record absent; logs may be rotated/incomplete',
    systemAudioConnected: 'No system-audio STT socket opened in the captured session',
    candidateMicConnected: 'No separate candidate microphone socket opened',
    candidateResponses: 'Fewer than five candidate speech segments captured',
    questionsCommitted: 'Fewer than ten interviewer questions committed',
    hintsDelivered: 'Fewer than ten completed hint first tokens recorded',
    audioCaptureHealthy: 'Audio PCM capture stalled and did not fully recover',
    userVisibleErrors: 'Session reported user-visible errors',
    completedStreams: 'Session reported incomplete AI streams',
    historyPersisted: 'No completed, preserved capture was confirmed in history',
    evaluationScored: 'Final saved evaluation is not scored (retry from Sessions)',
  }
  for (const [key, good] of Object.entries(checks)) if (!good) failures.push(descriptions[key])
  const times = speech.map(e => Date.parse(e.ts))
  const gaps = []
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i-1])
  const maxSpeechGapMs = gaps.length ? Math.max(...gaps) : null
  if (maxSpeechGapMs != null && maxSpeechGapMs > 3 * 60_000)
    warnings.push('Longest gap between transcribed speech events exceeds three minutes. Check audio level/PCM activity; genuine silence is possible.')
  const candidateFirstDelayMs = start && captures.length ?
    Math.max(0, Date.parse(captures[0].ts) - Date.parse(start.ts)) : null
  if (candidateFirstDelayMs != null && candidateFirstDelayMs > 10 * 60_000)
    warnings.push('First candidate speech detected more than ten minutes after session start; candidate coverage may be incomplete.')
  if ((Number(ending.cancelledGenerations) || 0) > 0)
    warnings.push('AI generations were cancelled; distinguish deliberate question supersedes from unexpected aborts.')
  if ((Number(ending.providerFallbacks) || 0) > 0)
    warnings.push('Provider fallbacks occurred; verify the resulting answers were delivered.')
  return {
    passed: failures.length === 0,
    sessionId: ending.sessionId,
    appVersion: ending.appVersion || 'unknown',
    platform: ending.platform || 'unknown',
    durationMinutes: Number((duration / 60000).toFixed(1)),
    failures, warnings, checks,
    metrics: {
      sessionSTTFinals: Number(ending.sttFinals) || 0,
      systemSpeechEvents: speech.length,
      candidateSpeechSegments: captures.length,
      questionsCommitted: commits.length,
      hintsDelivered: Number(ending.hints) || 0,
      providerFallbacks: Number(ending.providerFallbacks) || 0,
      cancelledGenerations: Number(ending.cancelledGenerations) || 0,
      incompleteStreams: Number(ending.incompleteStreams) || 0,
      userVisibleErrors: Number(ending.errors) || 0,
      captureStalls: stopFrames.length,
      recoveries: resumedFrames.length,
      maxSpeechGapMinutes: maxSpeechGapMs == null ? null : Number((maxSpeechGapMs / 60000).toFixed(1)),
      candidateFirstDelayMinutes: candidateFirstDelayMs == null ? null : Number((candidateFirstDelayMs / 60000).toFixed(1)),
      finalEvaluationStatus: latestHistory?.evaluationStatus || 'unknown',
    },
  }
}

function readRows(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    if (!line.trim()) return []
    try { return [JSON.parse(line)] } catch { return [] }
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node scripts/verify-live-60min.mjs <diagnostic-bundle.jsonl> [session-id]')
    process.exitCode = 2
  } else {
    try {
      const result = analyzeLiveSession(readRows(file), { sessionId: process.argv[3] || null })
      console.log(JSON.stringify(result, null, 2))
      if (!result.passed) process.exitCode = 1
    } catch (error) {
      console.error('Unable to analyze diagnostics:', error?.message || 'read_error')
      process.exitCode = 2
    }
  }
}
