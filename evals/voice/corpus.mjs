// Offline, human-annotated, same-audio corpus benchmark. No STT/LLM SDK,
// network, microphone or model is loaded on the Live critical path.
import { scoreCapturePlayback, comparePlaybackRuns } from './score.mjs'

export const REQUIRED_VOICE_SCENARIOS = Object.freeze([
  'first_question', 'silence_gap', 'interruption', 'source_switch',
])
const p95 = values => values.length
  ? [...values].sort((a, b) => a - b)[Math.ceil(.95 * values.length) - 1] : null

function inspectCorpus(corpus, label) {
  if (corpus?.schemaVersion !== 1 || !Array.isArray(corpus.runs) || !corpus.runs.length)
    throw new Error(label + ' requires schemaVersion 1 and annotated runs')
  const seen = new Set()
  return corpus.runs.map(run => {
    if (!REQUIRED_VOICE_SCENARIOS.includes(run.scenario)) throw new Error('Unknown voice scenario')
    if (!/^[a-f0-9]{64}$/.test(String(run.recordingSha256 || '')))
      throw new Error('A SHA-256 fingerprint of the consented or synthetic reference audio is required')
    if (seen.has(run.recordingId)) throw new Error('Recording IDs must be unique per corpus')
    seen.add(run.recordingId)
    const score = scoreCapturePlayback(run)
    return { run, score }
  })
}

/**
 * Candidate acceptance requires independent evidence across many recordings,
 * not a tiny fixture with two questions or a synthetic "performance" claim.
 */
export function compareVoiceCorpus(baselineCorpus, candidateCorpus, {
  minQuestions = 30, minRecordings = 4, maxAddedP95Ms = 50,
} = {}) {
  const baseline = inspectCorpus(baselineCorpus, 'Baseline')
  const candidate = inspectCorpus(candidateCorpus, 'Candidate')
  if (baseline.length !== candidate.length) throw new Error('Corpora must contain the same recordings')
  const baselineById = new Map(baseline.map(record => [record.run.recordingId, record]))
  const perRecording = []
  const scenarios = new Set()
  let questions = 0, baselineErrors = 0, candidateErrors = 0,
    baselineFalseCommits = 0, candidateFalseCommits = 0, baselineMissed = 0, candidateMissed = 0
  const baselineLatencies = [], candidateLatencies = []
  for (const item of candidate) {
    const old = baselineById.get(item.run.recordingId)
    if (!old || old.run.scenario !== item.run.scenario ||
      old.run.recordingSha256 !== item.run.recordingSha256)
      throw new Error('Candidate must use the identical recording, scenario and reference-audio SHA-256')
    const result = comparePlaybackRuns(old.run, item.run, { maxAddedP95Ms })
    scenarios.add(item.run.scenario)
    questions += result.baseline.totalQuestions
    baselineErrors += result.baseline.totalUserVisibleErrors
    candidateErrors += result.candidate.totalUserVisibleErrors
    baselineFalseCommits += result.baseline.falseCommits
    candidateFalseCommits += result.candidate.falseCommits
    baselineMissed += result.baseline.missed
    candidateMissed += result.candidate.missed
    for (const turn of old.run.turns) if (turn.firstUsefulAnswerMs != null) baselineLatencies.push(turn.firstUsefulAnswerMs)
    for (const turn of item.run.turns) if (turn.firstUsefulAnswerMs != null) candidateLatencies.push(turn.firstUsefulAnswerMs)
    perRecording.push({
      recordingId: item.run.recordingId, scenario: item.run.scenario,
      baselineErrors: result.baseline.totalUserVisibleErrors,
      candidateErrors: result.candidate.totalUserVisibleErrors,
      baselineFalseCommits: result.baseline.falseCommits,
      candidateFalseCommits: result.candidate.falseCommits,
      baselineMissed: result.baseline.missed,
      candidateMissed: result.candidate.missed,
      latencyComparable: result.latencyComparable,
      noLatencyRegression: result.noLatencyRegression,
      decision: result.decision,
    })
  }
  const missingScenarios = REQUIRED_VOICE_SCENARIOS.filter(name => !scenarios.has(name))
  const coverageSufficient = questions >= minQuestions &&
    candidate.length >= minRecordings && !missingScenarios.length
  const completeLatency = perRecording.every(r => r.latencyComparable)
  const baselineP95 = p95(baselineLatencies), candidateP95 = p95(candidateLatencies)
  const noAddedP95 = completeLatency && candidateP95 <= baselineP95 + maxAddedP95Ms &&
    perRecording.every(record => record.noLatencyRegression)
  const noFalseRegressions = perRecording.every(r =>
    r.candidateFalseCommits <= r.baselineFalseCommits &&
    r.candidateMissed <= r.baselineMissed)
  const improved = candidateErrors < baselineErrors && noFalseRegressions && noAddedP95
  return {
    decision: !coverageSufficient ? 'INCONCLUSIVE_INSUFFICIENT_COVERAGE'
      : !completeLatency ? 'INCONCLUSIVE_MISSING_LATENCY'
        : improved ? 'CANDIDATE_IMPROVED' : 'DO_NOT_ADOPT',
    recordingCount: candidate.length, referenceQuestions: questions,
    missingScenarios, coverageSufficient, completeLatency, noAddedP95,
    noFalseRegressions, baselineErrors, candidateErrors, errorDelta: candidateErrors - baselineErrors,
    baselineFalseCommits, candidateFalseCommits, baselineMissed, candidateMissed,
    baselineP95Ms: baselineP95, candidateP95Ms: candidateP95,
    maxAddedP95Ms, perRecording,
    evidenceNote: 'Offline annotation score only. Actual Windows playback, hardware and consented source audio still require independent verification.',
  }
}
