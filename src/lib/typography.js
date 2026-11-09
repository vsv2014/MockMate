// Readable desktop sizing: body text matches Live's 24–28px, supporting text >=20px.
// This changes type, not browser zoom or native window coordinates.
export function readableTextSize(original) {
  if (!Number.isFinite(original) || original <= 0) return 26
  if (original <= 18) return Math.max(20, original * 2)
  if (original < 32) return Math.max(32, original)
  return original
}

// Compact, accessible management-workspace scale. Do not change Live's larger
// speaker-facing type: its typography deliberately uses readableTextSize().
// 26px labels inside 18px sidebar icon slots caused collisions on Windows.
export function workspaceTextSize(original) {
  if (!Number.isFinite(original) || original <= 0) return 16
  if (original <= 10) return 13
  if (original <= 12) return 14
  if (original <= 14) return 16
  if (original <= 18) return 18
  if (original <= 24) return 22
  return Math.min(30, original)
}
