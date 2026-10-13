// Readable desktop sizing: body text matches Live's 24–28px, supporting text >=20px.
// This changes type, not browser zoom or native window coordinates.
export function readableTextSize(original) {
  if (!Number.isFinite(original) || original <= 0) return 26
  if (original <= 18) return Math.max(20, original * 2)
  if (original < 32) return Math.max(32, original)
  return original
}
