/**
 * Content-Security-Policy needs a separate WebSocket origin for managed STT.
 * An HTTPS API origin alone is not a portable allowance for wss:// requests.
 * Invalid or unsupported URLs fail closed.
 */
export function websocketOriginForApi(raw) {
  try {
    if (!raw) return null
    const url = new URL(String(raw))
    if (url.username || url.password) return null
    if (url.protocol === 'https:') url.protocol = 'wss:'
    else if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.protocol = 'ws:'
    else return null
    return url.origin
  } catch { return null }
}
