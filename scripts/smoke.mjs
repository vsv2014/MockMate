// Smoke test — fire REAL model calls against your .env keys and print what the models produce.
// No server, no UI: it calls the same engine functions the app uses (interview.js), so you can
// confirm generation works end-to-end before launching Electron.
//
//   npm run smoke                         # default behavioral question
//   npm run smoke -- "your own question"  # try any question
//   PROVIDER=gemini npm run smoke         # force a specific model id (else auto)
//
// Add a key to .env first (GEMINI_API_KEY is free: https://aistudio.google.com/apikey).
import 'dotenv/config'
import { interviewerTurn, streamHint, evaluateSolo } from '../api/_lib/interview.js'
import { availableProviders, allProviders } from '../api/_lib/core.js'

const provider = process.env.PROVIDER || undefined   // undefined = auto-select/failover
const question = process.argv.slice(2).join(' ') || 'Tell me about a time you handled a production incident.'
const profile = { targetRole: 'Senior Backend Engineer', currentRole: 'Backend Engineer', yearsExp: '6' }

const configured = availableProviders()
if (!configured.length) {
  console.error('\n✗ No LLM key found. Add one to .env — e.g. GEMINI_API_KEY (free): https://aistudio.google.com/apikey\n')
  process.exit(1)
}
console.log('\nConfigured LLM providers:', configured.map(p => p.id).join(', '))
console.log('Using:', provider || 'auto (fast→strong failover)')

// ── 1) Solo: the model plays the interviewer and asks a question ──
console.log('\n──────── /api/interview  (Solo — model as interviewer) ────────')
const t0 = Date.now()
const turn = await interviewerTurn({
  config: { domainLabel: 'Software Engineering', roundLabel: 'Behavioral' },
  transcript: [], profile, provider,
})
console.log(`Interviewer (${Date.now() - t0}ms): ${turn.say}`)

// ── 2) Live: stream an answer suggestion token-by-token (what the overlay shows) ──
console.log('\n──────── /api/hint-stream  (Live — streamed answer) ────────')
console.log('Q:', question)
process.stdout.write('A: ')
let full = '', tStart = Date.now(), tFirst = null
const out = await streamHint({ question, profile, provider }, {
  onMeta: m => process.stdout.write(`\n  [meta: ${JSON.stringify(m)}]\n  `),
  onToken: t => { if (!tFirst) tFirst = Date.now(); full += t; process.stdout.write(t) },
  onUsage: u => { /* token counts */ },
})
console.log('\n')
if (out?.skipped) console.log('(model chose to skip — not a real question)')
else console.log(`✓ time-to-first-token: ${tFirst ? tFirst - tStart : '—'}ms · streamed ${full.length} chars`)

console.log('\n✓ Smoke test complete — the models answered end-to-end.\n')
