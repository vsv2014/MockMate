// Standalone serverless proxies have no managed authentication. Opt-in stays exact "1".
export function publicProxyDisabled(res) {
  if (!process.env.VERCEL || process.env.MOCKMATE_ALLOW_PUBLIC_API === '1') return false
  res.status(403).json({ error: 'Public API deploy disabled. Use the managed auth backend, or explicitly enable MOCKMATE_ALLOW_PUBLIC_API=1 for local/private testing.' })
  return true
}
