// PCM frames (including digital silence) indicate a live capture graph.
// A lack of Deepgram final transcripts does not prove audio failure.
export const AUDIO_FRAME_STALL_MS = 15_000

export function isAudioFrameStalled({ activeSocket = false, contextState = '',
  stopped = false, suspended = false, lastFrameAt = 0, now = Date.now() } = {}) {
  return Boolean(activeSocket) && contextState === 'running' && !stopped && !suspended &&
    Number.isFinite(lastFrameAt) && lastFrameAt > 0 &&
    now - lastFrameAt >= AUDIO_FRAME_STALL_MS
}

/**
 * Sample at most 64 PCM16 values per callback; no speech samples are retained.
 * The derived RMS is only for capture-health telemetry, not voice activity
 * detection or speaker identification.
 */
export function samplePcmActivity(buffer, maxSamples = 64) {
  const samples = buffer instanceof ArrayBuffer ? new Int16Array(buffer)
    : ArrayBuffer.isView(buffer) && buffer.BYTES_PER_ELEMENT === 2 ? buffer : null
  if (!samples?.length) return { rms: 0, audible: false }
  const step = Math.max(1, Math.floor(samples.length / Math.max(1, maxSamples)))
  let squared = 0, taken = 0
  for (let i = 0; i < samples.length && taken < maxSamples; i += step) {
    const normalized = samples[i] / 32768
    squared += normalized * normalized
    taken++
  }
  const rms = Math.sqrt(squared / taken)
  return { rms: Number(rms.toFixed(5)), audible: rms >= 0.002 }
}
