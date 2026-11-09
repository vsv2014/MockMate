import fs from 'node:fs';
import { implementationIssue } from '../../shared/answerQuality.js';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const byId = new Map(fixtures.map(f => [f.id, f]));

export default function checkFixture(output, context = {}) {
  const f = byId.get(String(context.vars?.fixtureId || ''));
  if (!f) return { pass: false, score: 0, reason: 'Unknown fixture' };
  const text = String(output || '');
  const errors = [];
  if (!text.trim()) errors.push('Empty answer');
  if (f.expected.requiresCode) {
    const issue = implementationIssue(text, true);
    if (issue) errors.push(issue);
    const fence = String.fromCharCode(96).repeat(3);
    const opening = text.match(new RegExp('^\\s*' + fence + '([^\\n]*)', 'm'));
    const actual = String(opening?.[1] || '').toLowerCase().trim();
    const expected = f.expected.language;
    const langs = expected === 'typescript' ? ['ts','typescript']
      : expected === 'javascript' ? ['js','javascript']
      : expected === 'python' ? ['py','python'] : [expected];
    if (!langs.includes(actual)) errors.push('Wrong or missing code fence language');
  }
  for (const v of f.expected.requiredTerms || []) {
    if (!text.toLowerCase().includes(v.toLowerCase())) errors.push('Missing term: ' + v);
  }
  for (const v of f.expected.forbiddenTerms || []) {
    if (text.toLowerCase().includes(v.toLowerCase())) errors.push('Unsupported personal claim: ' + v);
  }
  return { pass: !errors.length, score: errors.length ? 0 : 1,
    reason: errors.join('; ') || 'Structural check passed; semantic accuracy not established' };
}
