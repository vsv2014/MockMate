import { availableProviders, allProviders, deepgramConfigured, searchConfigured, listModels } from './_lib/core.js'

// GET /api/providers — configured providers (default + fallback), the full model
// catalog with a `configured` flag (for the dropdown), and capability flags.
//
// Also answers /api/models via a vercel.json rewrite (?only=models) so we serve two
// logical endpoints from ONE serverless function — keeps us under the Hobby-plan
// 12-function limit. The local server + hosted backend expose /api/models directly
// (apiRoutes.js); this consolidation only affects the Vercel serverless deployment.
export default async function handler(req, res) {
  if (req.query?.only === 'models') {
    try { return res.status(200).json({ models: await listModels() }) }
    catch { return res.status(200).json({ models: [] }) }
  }
  res.status(200).json({ providers: availableProviders(), allProviders: allProviders(), deepgram: deepgramConfigured(), search: searchConfigured() })
}
