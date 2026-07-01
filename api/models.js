import { listModels } from './_lib/core.js'

// GET /api/models — the exact models each configured provider key can actually use,
// discovered live from the provider (always current, never 400s on a stale model id).
export default async function handler(req, res) {
  try { res.status(200).json({ models: await listModels() }) }
  catch (e) { res.status(200).json({ models: [] }) }
}
