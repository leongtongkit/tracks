// Recorder AudioWorklet: forwards raw input blocks to the main thread,
// which accumulates them and encodes a WAV on stop.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.active = true
    this.port.onmessage = e => {
      if (e.data === 'stop') this.active = false
    }
  }

  process(inputs) {
    if (!this.active) return false
    const input = inputs[0]
    if (input && input.length > 0) {
      const l = input[0]
      const r = input[1] || input[0]
      // copy: the engine reuses these buffers between blocks
      this.port.postMessage([l.slice(0), r.slice(0)])
    }
    return true
  }
}

registerProcessor('recorder', RecorderProcessor)
