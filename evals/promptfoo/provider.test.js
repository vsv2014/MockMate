import { describe, it, expect } from 'vitest';
import MockMateHintProvider, { validateEvalEnvironment, buildHintArgs } from './provider.mjs';

describe('opt-in real-hint provider (no paid calls)', () => {
  it('fails closed when explicit opt-in is absent', () => {
    expect(validateEvalEnvironment({ OPENAI_API_KEY: 'some-key' })).toMatch(/disabled/i);
  });
  it('requires at least one model API key', () => {
    expect(validateEvalEnvironment({ MOCKMATE_RUN_LLM_EVALS: '1' })).toMatch(/No AI provider key/i);
  });
  it('maps fixture fields into the actual engine options without inventing candidate facts', () => {
    const args = buildHintArgs('Explain indexes', { targetRole: 'Backend Engineer', codingLanguage: 'TypeScript', conversationHistory: [{ role: 'interviewer', text: 'MongoDB?' }] }, { MOCKMATE_EVAL_PROVIDER: 'auto' });
    expect(args.question).toBe('Explain indexes');
    expect(args.profile.resume).toBe('');
    expect(args.profile.targetRole).toBe('Backend Engineer');
    expect(args.conversationHistory).toHaveLength(1);
    expect(args.extraContext).toBe('');
    expect(args.autoSkip).toBe(true);
  });
  it('rejects empty questions before any provider request', () => {
    expect(() => buildHintArgs('   ')).toThrow(/Nonempty/);
  });
  it('implements promptfoo custom provider interface', () => {
    const provider = new MockMateHintProvider();
    expect(provider.id()).toMatch(/post-asr/);
    expect(typeof provider.callApi).toBe('function');
  });
});
