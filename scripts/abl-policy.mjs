#!/usr/bin/env node
// Local operator-only ABL management; no remote mutation endpoint.
import fs from 'node:fs'
import { currentAblPolicyStatus, listAblRevisions, applyAblRevision, rollbackAblRevision, previewAblRevision } from '../backend/src/ablRevisions.js'

const [command, argument, flag, approvedDigest] = process.argv.slice(2)
const requireApproval = () => {
  if (flag !== '--approve' || !/^[a-f0-9]{16}$/.test(approvedDigest || ''))
    throw new Error('Review with dry-run first, then explicitly pass --approve <currentDigest>')
  return approvedDigest
}
try {
  let output
  switch (command) {
    case 'status': output = { ...currentAblPolicyStatus(), revisions: process.env.MOCKMATE_ABL_PATH ? listAblRevisions() : [] }; break
    case 'dry-run':
      if (!argument) throw new Error('Usage: abl-policy dry-run /path/to/proposal.json')
      output = previewAblRevision(fs.readFileSync(argument, 'utf8')); break
    case 'apply':
      if (!argument) throw new Error('Usage: abl-policy apply /path/to/proposal.json --approve <currentDigest>')
      output = applyAblRevision(fs.readFileSync(argument, 'utf8'), { expectedDigest: requireApproval() }); break
    case 'rollback':
      if (!argument) throw new Error('Usage: abl-policy rollback rev-... --approve <currentDigest>')
      output = rollbackAblRevision(argument, { expectedDigest: requireApproval() }); break
    default: throw new Error('Usage: MOCKMATE_ABL_PATH=/private/config.json node scripts/abl-policy.mjs status|dry-run <candidate.json>|apply <candidate.json> --approve <digest>|rollback <revision> --approve <digest>')
  }
  console.log(JSON.stringify(output, null, 2))
} catch (error) {
  console.error(error?.message || 'Invalid ABL operation')
  process.exitCode = 1
}
