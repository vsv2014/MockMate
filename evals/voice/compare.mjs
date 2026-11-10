#!/usr/bin/env node
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compareVoiceCorpus } from './corpus.mjs'
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [baseFile, candidateFile] = process.argv.slice(2)
  if (!baseFile || !candidateFile) {
    console.error('Usage: node evals/voice/compare.mjs baseline-annotations.json candidate-annotations.json')
    process.exitCode = 2
  } else {
    try {
      const baseline = JSON.parse(fs.readFileSync(baseFile, 'utf8'))
      const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'))
      const result = compareVoiceCorpus(baseline, candidate)
      console.log(JSON.stringify(result, null, 2))
      if (result.decision !== 'CANDIDATE_IMPROVED') process.exitCode = 1
    } catch (e) {
      console.error(e?.message || 'Cannot compare the supplied annotations')
      process.exitCode = 2
    }
  }
}
