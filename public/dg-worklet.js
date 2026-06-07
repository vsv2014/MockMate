// Runs on the dedicated AudioWorklet thread (NOT the main thread), so audio
// capture can never be starved by React renders or answer streaming.
// It downsamples mic/system audio to 16 kHz mono PCM16 and posts ArrayBuffers
// to the main thread, which forwards them to the Deepgram WebSocket.
class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buf = []        // accumulated input samples (at the context sampleRate)
    this._target = 4096   // encode + post once we have this many samples (~matches old chunk size)
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true       // keep the node alive even with no input yet
    const ch = input[0]
    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i])
    if (this._buf.length >= this._target) {
      const chunk = Float32Array.from(this._buf)
      this._buf.length = 0
      const buf = this._encode(chunk, sampleRate)   // `sampleRate` is a global in the worklet scope
      this.port.postMessage(buf, [buf])             // transfer ownership — zero-copy
    }
    return true
  }

  _encode(input, inRate, outRate = 16000) {
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
}

registerProcessor('pcm-worklet', PCMWorklet)
