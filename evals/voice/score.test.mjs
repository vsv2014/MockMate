import { describe, it, expect } from 'vitest';
import { scoreCapturePlayback, comparePlaybackRuns } from './score.mjs';
const turn = (referenceId, patch = {}) => ({
  referenceId, missed: false, falseCommits: 0, correctionAttempts: 0,
  userOverrides: 0, firstUsefulAnswerMs: 800, ...patch,
});
const run = (turns, recordingId = 'consented-test-track-01') => ({recordingId,turns});

describe('net voice error benchmark', () => {
  it('counts missed, false, corrected and overridden events together', () => {
    const r=scoreCapturePlayback(run([
      turn('q1',{missed:true,firstUsefulAnswerMs:null}),
      turn('q2',{falseCommits:2,correctionAttempts:1}),
      turn('q3',{userOverrides:1}),
      turn('q4'),
    ]));
    expect(r.totalUserVisibleErrors).toBe(5);
    expect(r.affectedQuestions).toBe(3);
    expect(r.missed).toBe(1);
    expect(r.falseCommits).toBe(2);
    expect(r.errorsPer100Questions).toBe(125);
    expect(r.firstUsefulAnswerP95Ms).toBe(800);
  });
  it('rejects missing labels and duplicate reference turns', () => {
    expect(() => scoreCapturePlayback(run([turn('q1'),turn('q1')]))).toThrow(/unique/);
    expect(() => scoreCapturePlayback(run([{referenceId:'q1',missed:false}]))).toThrow(/falseCommits/);
  });
  it('does not count a missed turn as a response latency datapoint', () => {
    expect(() => scoreCapturePlayback(run([turn('q1',{missed:true})]))).toThrow(/Latency/);
  });
  it('compares exactly the same fixed reference IDs', () => {
    expect(() => comparePlaybackRuns(run([turn('q1')]),run([turn('q2')]))).toThrow(/same reference/);
  });
  it('does not adopt a result that improves misses by increasing false commits', () => {
    const original=run([turn('q1',{missed:true,firstUsefulAnswerMs:null}),turn('q2')]);
    const newer=run([turn('q1',{falseCommits:2}),turn('q2')]);
    expect(comparePlaybackRuns(original,newer).decision).toBe('DO_NOT_ADOPT');
  });
  it('does not adopt a result with unacceptable added p95 latency', () => {
    const original=run([turn('q1',{correctionAttempts:1,firstUsefulAnswerMs:800}),turn('q2')]);
    const newer=run([turn('q1',{firstUsefulAnswerMs:860}),turn('q2')]);
    expect(comparePlaybackRuns(original,newer).decision).toBe('DO_NOT_ADOPT');
  });
  it('accepts a net improvement with stable false commits and latency', () => {
    const original=run([turn('q1',{correctionAttempts:1}),turn('q2')]);
    const newer=run([turn('q1'),turn('q2')]);
    expect(comparePlaybackRuns(original,newer).decision).toBe('CANDIDATE_IMPROVED');
  });
  it('rejects artificially improved latency when successful turns omit timing', () => {
    const original = run([
      turn('q1', { correctionAttempts: 1, firstUsefulAnswerMs: 800 }),
      turn('q2', { firstUsefulAnswerMs: 850 }),
    ]);
    const candidate = run([
      turn('q1', { firstUsefulAnswerMs: 790 }),
      turn('q2', { firstUsefulAnswerMs: null }),
    ]);
    const compared = comparePlaybackRuns(original, candidate);
    expect(compared.candidate.missingLatencyQuestions).toBe(1);
    expect(compared.latencyComparable).toBe(false);
    expect(compared.decision).toBe('INCONCLUSIVE_MISSING_LATENCY');
  });
  it('returns inconclusive without enough timing evidence', () => {
    const original=run([turn('q1',{missed:true,firstUsefulAnswerMs:null}),turn('q2',{missed:true,firstUsefulAnswerMs:null})]);
    const newer=run([turn('q1',{missed:true,firstUsefulAnswerMs:null}),turn('q2')]);
    expect(comparePlaybackRuns(original,newer).decision).toBe('INCONCLUSIVE_MISSING_LATENCY');
  });
});
