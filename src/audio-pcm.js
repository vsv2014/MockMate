// Downsample Float32 audio to 16 kHz PCM16 for Deepgram. Shared by both capture hooks
// (useSystemAudio + useDeepgram) — was byte-for-byte duplicated in each.
export function toPCM16(input, inRate, outRate = 16000) {
  let data = input
  if (outRate < inRate) {
    const ratio = inRate / outRate
    const len = Math.round(input.length / ratio)
    const out = new Float32Array(len)
    let pos = 0
    for (let i = 0; i < len; i++) {
      const next = Math.round((i + 1) * ratio)
      let sum = 0, c = 0
      for (let j = pos; j < next && j < input.length; j++) { sum += input[j]; c++ }
      out[i] = c ? sum / c : 0
      pos = next
    }
    data = out
  }
  const pcm = new Int16Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return pcm.buffer
}
