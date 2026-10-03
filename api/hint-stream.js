import { streamHint } from './_lib/interview.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (process.env.VERCEL && process.env.MOCKMATE_ALLOW_PUBLIC_API !== '1') {
    return res.status(403).json({ error: 'Public API deploy disabled. Use the managed auth backend.' })
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const ac = new AbortController()
  req.on?.('close', () => ac.abort())
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
  try {
    const out = await streamHint(body, {
      onMeta: m => send('meta', m), onToken: t => send('token', t), onUsage: u => send('usage', u),
      onProviderEvent: e => send('provider', e), signal: ac.signal,
    })
    send(out?.skipped ? 'skip' : 'done', {})
  } catch (e) {
    if (!ac.signal.aborted) send('error', { error: e?.message || 'Hint stream failed' })
  } finally {
    if (!res.writableEnded) res.end()
  }
}
