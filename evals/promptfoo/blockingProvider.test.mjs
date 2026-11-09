import { test } from 'vitest';
import assert from 'node:assert/strict';
import MockMateBlockingHintProvider from './blockingProvider.mjs';

test('blocking JSON eval provider refuses to spend money in default CI', async () => {
  const original = process.env.MOCKMATE_RUN_LLM_EVALS;
  delete process.env.MOCKMATE_RUN_LLM_EVALS;
  try {
    const r = await new MockMateBlockingHintProvider().callApi('dsa-array', {vars:{fixtureId:'dsa-array'}});
    assert.match(r.error, /disabled/);
  } finally {
    if (original === undefined) delete process.env.MOCKMATE_RUN_LLM_EVALS;
    else process.env.MOCKMATE_RUN_LLM_EVALS = original;
  }
});

test('blocking JSON eval provider requires an explicit provider', async () => {
  const oldRun = process.env.MOCKMATE_RUN_LLM_EVALS;
  const oldProvider = process.env.MOCKMATE_EVAL_PROVIDER;
  process.env.MOCKMATE_RUN_LLM_EVALS = '1';
  delete process.env.MOCKMATE_EVAL_PROVIDER;
  try {
    const r = await new MockMateBlockingHintProvider().callApi('dsa-array', {vars:{fixtureId:'dsa-array'}});
    assert.match(r.error, /Explicit/);
  } finally {
    if (oldRun === undefined) delete process.env.MOCKMATE_RUN_LLM_EVALS;
    else process.env.MOCKMATE_RUN_LLM_EVALS = oldRun;
    if (oldProvider === undefined) delete process.env.MOCKMATE_EVAL_PROVIDER;
    else process.env.MOCKMATE_EVAL_PROVIDER = oldProvider;
  }
});

test('blocking JSON provider refuses arbitrary content even if paid eval is enabled', async () => {
  const oldRun = process.env.MOCKMATE_RUN_LLM_EVALS;
  const oldProvider = process.env.MOCKMATE_EVAL_PROVIDER;
  process.env.MOCKMATE_RUN_LLM_EVALS = '1';
  process.env.MOCKMATE_EVAL_PROVIDER = 'openai';
  try {
    const r = await new MockMateBlockingHintProvider().callApi('secret private question', {vars:{fixtureId:'not-in-synthetic-manifest'}});
    assert.match(r.error, /Unknown fixture/);
  } finally {
    if (oldRun === undefined) delete process.env.MOCKMATE_RUN_LLM_EVALS;
    else process.env.MOCKMATE_RUN_LLM_EVALS = oldRun;
    if (oldProvider === undefined) delete process.env.MOCKMATE_EVAL_PROVIDER;
    else process.env.MOCKMATE_EVAL_PROVIDER = oldProvider;
  }
});
