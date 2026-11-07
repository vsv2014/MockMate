import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { implementationIssue, requiresImplementation } from '../../shared/answerQuality.js';
import { stripHintMeta, ensureCodingCodeBlock, glanceLayers } from '../../shared/hintLayers.js';
import checkFixture from './assertions.mjs';
import MockMateHintProvider from './provider.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const fence = String.fromCharCode(96).repeat(3);

test('fixture manifest is synthetic, uniquely identified, and labelled', () => {
  assert.equal(fixtures.length, 12);
  assert.equal(new Set(fixtures.map(f => f.id)).size, fixtures.length);
  for (const f of fixtures) {
    assert.equal(f.origin, 'synthetic');
    assert.ok(f.question && f.category && f.expected);
  }
});
test('normal CI cannot trigger paid calls', async () => {
  const old = process.env.MOCKMATE_RUN_LLM_EVALS;
  delete process.env.MOCKMATE_RUN_LLM_EVALS;
  try {
    const r = await new MockMateHintProvider().callApi('dsa-array', {vars:{fixtureId:'dsa-array'}});
    assert.match(r.error, /disabled/);
  } finally {
    if (old === undefined) delete process.env.MOCKMATE_RUN_LLM_EVALS;
    else process.env.MOCKMATE_RUN_LLM_EVALS = old;
  }
});
test('complete code accepted, missing/unfinished implementation rejected', () => {
  assert.equal(implementationIssue(fence + 'typescript\nfunction f(){return 1}\n' + fence, true), null);
  assert.equal(implementationIssue('Only an explanation', true), 'code_missing');
  assert.equal(implementationIssue(fence + 'typescript\nfunction f(){', true), 'code_unfinished');
});
test('coding request requires real code unless explicitly excluded', () => {
  assert.equal(requiresImplementation('Write TypeScript code for two sum', {questionType:'dsa'}), true);
  assert.equal(requiresImplementation('Explain only, no code', {questionType:'dsa'}), false);
});
test('leading META is removed from spoken text', () => {
  const m = stripHintMeta('META: {"type":"technical","confidence":"general"}\nHash maps store keys.');
  assert.equal(m.meta.type, 'technical');
  assert.doesNotMatch(m.prose, /META:/);
});
test('loose code is fenced once', () => {
  const one = ensureCodingCodeBlock('function solve(){ return 1; }', 'coding');
  assert.ok(one.includes(fence));
  assert.equal(ensureCodingCodeBlock(one, 'coding'), one);
});
test('glance structure exists', () => {
  const view = glanceLayers('A queue is FIFO. It stores items in order.');
  assert.match(view.fullAnswer, /queue/i);
  assert.ok(view.opener);
});
test('seeded wrong language fails', () => {
  const r = checkFixture(fence + 'python\nprint(1)\n' + fence, {vars:{fixtureId:'dsa-array'}});
  assert.equal(r.pass, false);
  assert.match(r.reason, /language/i);
});
test('seeded incomplete code fails', () => {
  const r = checkFixture(fence + 'typescript\nfunction solve(){', {vars:{fixtureId:'dsa-array'}});
  assert.equal(r.pass, false);
  assert.match(r.reason, /code_unfinished/);
});
test('seeded fabricated ownership fails', () => {
  const r = checkFixture('I built the entire backend.', {vars:{fixtureId:'behavioral-ownership'}});
  assert.equal(r.pass, false);
});
