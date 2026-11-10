// PCM frames (including digital silence) indicate a live capture graph.
// A lack of Deepgram final transcripts does not prove audio failure.
export const AUDIO_FRAME_STALL_MS = 15_000

export function isAudioFrameStalled({ activeSocket = false, contextState = '',
  stopped = false, suspended = false, lastFrameAt = 0, now = Date.now() } = {}) {
  return Boolean(activeSocket) && contextState === 'running' && !stopped && !suspended &&
    Number.isFinite(lastFrameAt) && lastFrameAt > 0 &&
    now - lastFrameAt >= AUDIO_FRAME_STALL_MS
}
