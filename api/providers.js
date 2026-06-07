import { availableProviders, allProviders, deepgramConfigured, searchConfigured } from './_lib/core.js'

// GET /api/providers — configured providers (default + fallback), the full model
// catalog with a `configured` flag (for the dropdown), and capability flags.
export default async function handler(req, res) {
  res.status(200).json({ providers: availableProviders(), allProviders: allProviders(), deepgram: deepgramConfigured(), search: searchConfigured() })
}
