#!/usr/bin/env node
// Local operator-only ABL management; no remote mutation endpoint.
import fs from 'node:fs'
import { currentAblPolicyStatus, listAblRevisions, applyAblRevision, rollbackAblRevision } from '../backend/src/ablRevisions.js'

const [command, argument] = process.argv.slice(2)
try {
  let output
  switch (command) {
    case 'status': output = { ...currentAblPolicyStatus(), revisions: process.env.MOCKMATE_ABL_PATH ? listAblRevisions() : [] }; break
    case 'apply':
      if (!argument) throw new Error('Usage: abl-policy apply /path/to/new-policy.json')
      output = applyAblRevision(fs.readFileSync(argument, 'utf8')); break
    case 'rollback':
      if (!argument) throw new Error('Usage: abl-policy rollback rev-...')
      output = rollbackAblRevision(argument); break
    default: throw new Error('Usage: MOCKMATE_ABL_PATH=/private/config.json node scripts/abl-policy.mjs status|apply <candidate.json>|rollback <revision>')
  }
  console.log(JSON.stringify(output, null, 2))
} catch (error) {
  console.error(error?.message || 'Invalid ABL operation')
  process.exitCode = 1
}
