import { embed } from './_lib/core.js'
import { postHandler } from './_handler.js'

export default postHandler(async body => {
  const raw = body?.input
  const input = (Array.isArray(raw) ? raw : [raw]).filter(Boolean)
  if (input.length > 64) { const e = new Error('Too many embedding inputs in one request.'); e.status = 413; throw e }
  return { vectors: await embed(input) }
})
