import { availableProviders, allProviders, deepgramConfigured, searchConfigured, listModels } from './_lib/core.js'

function publicProxyDisabled(res) {
  if (process.env.VERCEL && process.env.MOCKMATE_ALLOW_PUBLIC_API !== '1') {
    res.status(403).json({
      error: 'Public API deploy disabled. Use the managed auth backend, or explicitly enable MOCKMATE_ALLOW_PUBLIC_API=1 for local/private testing.',
    })
    return true
  }
  return false
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  if (publicProxyDisabled(res)) return
  if (req.query?.only === 'models') {
    try { return res.status(200).json({ models: await listModels() }) }
    catch { return res.status(200).json({ models: [] }) }
  }
  res.status(200).json({ providers: availableProviders(), allProviders: allProviders(), deepgram: deepgramConfigured(), search: searchConfigured() })
}
