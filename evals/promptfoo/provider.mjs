// Promptfoo custom provider: invokes the real MockMate Node hint engine.
// This is post-ASR only. It is NOT a replacement for the Windows audio Gate 0.
const KEYS = ['OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','GROQ_API_KEY','CEREBRAS_API_KEY','OPENROUTER_API_KEY','LLM_API_KEY'];

export function validateEvalEnvironment(env = process.env) {
  if (env.MOCKMATE_RUN_LLM_EVALS !== '1') return 'Provider evaluation disabled. Set MOCKMATE_RUN_LLM_EVALS=1 deliberately.';
  if (!KEYS.some(key => String(env[key] || '').trim())) return 'No AI provider key configured.';
  return null;
}

export function buildHintArgs(prompt, vars = {}, env = process.env) {
  const question = String(vars.question || prompt || '').trim();
  if (!question) throw new Error('Nonempty interviewer question required');
  return {
    question,
    provider: env.MOCKMATE_EVAL_PROVIDER || 'auto',
    profile: {
      resume: String(vars.resume || ''),
      jobDescription: String(vars.jobDescription || ''),
      targetRole: String(vars.targetRole || 'Software Engineer'),
      company: String(vars.company || ''),
      codingLanguage: String(vars.codingLanguage || 'JavaScript'),
      modelStrategy: String(vars.modelStrategy || 'balanced')
    },
    conversationHistory: Array.isArray(vars.conversationHistory) ? vars.conversationHistory : [],
    extraContext: String(vars.extraContext || ''),
    style: String(vars.style || 'balanced'),
    mode: 'answer',
    autoSkip: true
  };
}

export default class MockMateHintProvider {
  id() { return 'mockmate:real-generateHint:post-asr'; }
  async callApi(prompt, context = {}) {
    const blocked = validateEvalEnvironment();
    if (blocked) return { error: blocked };
    try {
      const { generateHint } = await import('../../api/_lib/interview.js');
      const started = Date.now();
      const hint = await generateHint(buildHintArgs(prompt, context.vars));
      if (!hint) return { output: '[SKIP]', metadata: { skipped: true } };
      const answer = String(hint.fullAnswer || hint.sampleAnswer || hint.answer || '');
      if (!answer.trim()) return { error: 'No visible answer returned by production engine.' };
      return {
        output: answer,
        metadata: {
          elapsedMs: Date.now() - started,
          questionType: hint._routing?.questionType || hint.type || null,
          playbook: hint._routing?.playbook || null,
          requiresCode: hint._routing?.requiresCode ?? null,
          fidelity: 'post-asr-node-json-hint'
        }
      };
    } catch (e) {
      return { error: 'MockMate hint failed: ' + String(e?.message || e).slice(0, 300) };
    }
  }
}
