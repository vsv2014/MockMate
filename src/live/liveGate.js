// Pure helpers for Live Companion start preflight gating and Alt+R (answer-now)
// question resolution so renderer behavior is deterministically unit-testable.

export function computeLiveCanStart({
  dgAvailable = false,
  noLLM = true,
  inElectron = false,
  isLinux = false,
  linuxAck = false,
  protectionStatus = 'idle',
  shareVerified = false,
  isDevLocal = false,
} = {}) {
  if (!dgAvailable || noLLM) return false
  if (isDevLocal) return true
  if (!inElectron) return false
  if (isLinux) return Boolean(linuxAck)
  return protectionStatus === 'passed' && Boolean(shareVerified)
}

export function resolveAnswerNowCandidate({
  liveCaptureText = '',
  manualQ = '',
  pendingManualText = '',
  lastHintText = '',
} = {}) {
  return String(
    liveCaptureText
    || manualQ
    || pendingManualText
    || lastHintText
    || '',
  ).trim()
}
