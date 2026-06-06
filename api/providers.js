import { availableProviders, deepgramConfigured } from './_lib/core.js'

// GET /api/providers — which LLM providers are configured, and whether Deepgram
// (accurate speech-to-text) is available. Used by the UI pickers.
export default async function handler(req, res) {
  res.status(200).json({ providers: availableProviders(), deepgram: deepgramConfigured() })
}
