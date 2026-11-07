// Independent JSON (nonstreaming) hint path smoke adapter.
// Uses the same synthetic-only fixtures as the streaming provider.
// Not an audio-to-overlay test and NOT a duplicate production prompt.
import fs from 'node:fs';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const byId = new Map(fixtures.map(f => [f.id, f]));

export default class MockMateBlockingHintProvider {
  id() { return 'mockmate:generateHint:blocking-post-asr'; }
  async callApi(prompt, context = {}) {
    if (process.env.MOCKMATE_RUN_LLM_EVALS !== '1')
      return { error: 'Paid eval disabled (MOCKMATE_RUN_LLM_EVALS != 1).' };
    const selected = String(process.env.MOCKMATE_EVAL_PROVIDER || '').trim();
    if (!selected || selected === 'auto')
      return { error: 'Explicit MOCKMATE_EVAL_PROVIDER is required (not auto).' };
    const fixtureId = String(context.vars?.fixtureId ?? prompt).trim();
    const fixture = byId.get(fixtureId);
    if (!fixture) return { error: 'Unknown fixture; arbitrary/private prompts prohibited.' };
    try {
      const { generateHint } = await import('../../api/_lib/interview.js');
      const hint = await generateHint({
        question: fixture.question, profile: fixture.profile || {},
        conversationHistory: fixture.conversationHistory || [],
        provider: selected, language: 'English',
        extraContext: fixture.extraContext || '',
        mode: 'answer', style: 'balanced', autoSkip: false,
      });
      const output = String(hint?.fullAnswer || hint?.sampleAnswer || hint?.answer || '');
      if (!output.trim()) return { error: 'Skipped or empty blocking JSON hint.' };
      return { output, metadata: {
        fixtureId, category: fixture.category, routing: hint?._routing || {},
        reportedMetaType: hint?.type || null,
        fidelity: 'synthetic-post-ASR-generateHint-only',
      }};
    } catch (e) {
      return { error: String(e?.message || 'generateHint failed').slice(0, 240) };
    }
  }
}
