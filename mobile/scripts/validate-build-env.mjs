const raw = String(process.env.EXPO_PUBLIC_API_BASE || '').trim()
if (!raw) throw new Error('EXPO_PUBLIC_API_BASE is required for every signed MockMate mobile build.')
const url = new URL(raw)
if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
  throw new Error('EXPO_PUBLIC_API_BASE must be a public HTTPS URL without embedded credentials or a fragment.')
}
console.log(`[mobile-build] API base validated: ${url.origin}`)
