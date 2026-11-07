import fs from 'node:fs';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const byId = new Map(fixtures.map(f => [f.id, f]));

/** Calls the actual streaming hint engine, but synthetic text replaces the ASR stage. */
export default class MockMateHintProvider {
  id() { return 'mockmate:streamHint'; }
  async callApi(prompt, context = {}, options = {}) {
    if (process.env.MOCKMATE_RUN_LLM_EVALS !== '1')
      return { error: 'Paid eval disabled (MOCKMATE_RUN_LLM_EVALS != 1).' };
    const selected = String(process.env.MOCKMATE_EVAL_PROVIDER || '').trim();
    if (!selected || selected === 'auto')
      return { error: 'Explicit MOCKMATE_EVAL_PROVIDER is required (not auto).' };
    const fixtureId = String(context.vars?.fixtureId ?? prompt).trim();
    const fixture = byId.get(fixtureId);
    if (!fixture) return { error: 'Unknown fixture; arbitrary/private prompts prohibited.' };
    let meta = {}, answer = '', events = 0;
    try {
      // Importing/normal CI never makes an LLM request. No duplicated prompts here.
      const { streamHint } = await import('../../api/_lib/interview.js');
      const outcome = await streamHint({
        question: fixture.question, profile: fixture.profile || {},
        conversationHistory: fixture.conversationHistory || [],
        provider: selected, language: 'English', extraContext: fixture.extraContext || '',
        mode: 'answer', style: 'balanced', autoSkip: false,
      }, {
        onMeta: value => { meta = value || {}; },
        onToken: chunk => { answer += chunk; },
        onProviderEvent: () => { events++; },
        signal: options.abortSignal,
      });
      if (outcome?.skipped || !answer.trim()) return { error: 'Skipped or empty visible answer.' };
      return { output: answer, metadata: {
        fixtureId, category: fixture.category, routing: meta?._routing || {},
        reportedMetaType: meta?.type || null, providerEvents: events,
        fidelity: 'synthetic-post-ASR-streamHint-only',
      }};
    } catch (e) { return { error: String(e?.message || 'streamHint failed').slice(0, 240) }; }
  }
}
