/**
 * Offline annotation-only turn benchmark. NO microphone, STT, network or model calls.
 * All numbers come from independently labelled playback records; never infer
 * missed turns from merely absent transcripts without ground-truth annotations.
 */
const safeCount = (value, key) => {
  if (!Number.isInteger(value) || value < 0) throw new Error('Invalid ' + key);
  return value;
};
const percentile = (values, percentileRank) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((percentileRank / 100) * sorted.length) - 1];
};

export function scoreCapturePlayback(run) {
  if (!run || typeof run.recordingId !== 'string' || !run.recordingId.trim())
    throw new Error('A named recorded-playback ID is required');
  if (!Array.isArray(run.turns) || !run.turns.length)
    throw new Error('One or more annotated reference turns are required');
  const ids = new Set();
  let missed = 0, falseCommits = 0, corrections = 0, overrides = 0, affected = 0;
  const latencies = [];
  for (const turn of run.turns) {
    const id = String(turn?.referenceId || '');
    if (!id || ids.has(id)) throw new Error('Reference turns need unique nonempty IDs');
    ids.add(id);
    if (typeof turn.missed !== 'boolean') throw new Error('Each turn needs a labelled missed flag');
    const wrong = safeCount(turn.falseCommits, 'falseCommits');
    const corrected = safeCount(turn.correctionAttempts, 'correctionAttempts');
    const overridden = safeCount(turn.userOverrides, 'userOverrides');
    const currentMissed = turn.missed ? 1 : 0;
    missed += currentMissed; falseCommits += wrong; corrections += corrected; overrides += overridden;
    if (currentMissed || wrong || corrected || overridden) affected++;
    if (turn.firstUsefulAnswerMs != null) {
      if (turn.missed || !Number.isFinite(turn.firstUsefulAnswerMs) || turn.firstUsefulAnswerMs < 0)
        throw new Error('Latency must be nonnegative and absent for missed turns');
      latencies.push(turn.firstUsefulAnswerMs);
    }
  }
  const totalErrors = missed + falseCommits + corrections + overrides;
  return {
    recordingId: run.recordingId,
    referenceIds: [...ids].sort(),
    totalQuestions: run.turns.length,
    missed, falseCommits, correctionAttempts: corrections, userOverrides: overrides,
    affectedQuestions: affected,
    totalUserVisibleErrors: totalErrors,
    errorsPer100Questions: Number((100 * totalErrors / run.turns.length).toFixed(2)),
    affectedQuestionRate: Number((affected / run.turns.length).toFixed(4)),
    firstUsefulAnswerP50Ms: percentile(latencies, 50),
    firstUsefulAnswerP95Ms: percentile(latencies, 95),
    timedQuestions: latencies.length,
    missingLatencyQuestions: run.turns.length - missed - latencies.length,
  };
}

export function comparePlaybackRuns(baselineRun, candidateRun, { maxAddedP95Ms = 50 } = {}) {
  if (!Number.isFinite(maxAddedP95Ms) || maxAddedP95Ms < 0)
    throw new Error('Invalid latency tolerance');
  const baseline = scoreCapturePlayback(baselineRun);
  const candidate = scoreCapturePlayback(candidateRun);
  if (baseline.recordingId !== candidate.recordingId ||
      JSON.stringify(baseline.referenceIds) !== JSON.stringify(candidate.referenceIds))
    throw new Error('Not the same reference recording/questions');
  // A candidate may not silently omit slow successful turns to inflate its p95.
  // Missed turns are excluded from the timing denominator by construction.
  const latencyComparable = baseline.firstUsefulAnswerP95Ms !== null &&
    candidate.firstUsefulAnswerP95Ms !== null &&
    baseline.missingLatencyQuestions === 0 && candidate.missingLatencyQuestions === 0;
  const noLatencyRegression = latencyComparable &&
    candidate.firstUsefulAnswerP95Ms <= baseline.firstUsefulAnswerP95Ms + maxAddedP95Ms;
  const reducedBurden = candidate.totalUserVisibleErrors < baseline.totalUserVisibleErrors;
  const noFalseCommitRegression = candidate.falseCommits <= baseline.falseCommits;
  return {
    baseline, candidate,
    netErrorsDelta: candidate.totalUserVisibleErrors - baseline.totalUserVisibleErrors,
    latencyComparable, noLatencyRegression, reducedBurden, noFalseCommitRegression,
    decision: !latencyComparable ? 'INCONCLUSIVE_MISSING_LATENCY'
      : reducedBurden && noFalseCommitRegression && noLatencyRegression ? 'CANDIDATE_IMPROVED'
        : 'DO_NOT_ADOPT',
  };
}
