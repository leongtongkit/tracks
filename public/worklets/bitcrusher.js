// Bitcrusher AudioWorklet: bit-depth quantization + sample-rate reduction.
// Plain JS in public/ so it loads without a build step in dev and prod.
class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16 },
      { name: 'downsample', defaultValue: 4, minValue: 1, maxValue: 40 },
    ]
  }

  constructor() {
    super()
    this.phases = [0, 0]
    this.held = [0, 0]
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) return true
    const bits = parameters.bits[0]
    const down = Math.max(1, Math.round(parameters.downsample[0]))
    const steps = Math.pow(2, bits - 1)

    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0]
      const out = output[ch]
      let phase = this.phases[ch] || 0
      let held = this.held[ch] || 0
      for (let i = 0; i < out.length; i++) {
        if (phase === 0) {
          held = Math.round(inp[i] * steps) / steps
        }
        out[i] = held
        phase = (phase + 1) % down
      }
      this.phases[ch] = phase
      this.held[ch] = held
    }
    return true
  }
}

registerProcessor('bitcrusher', BitcrusherProcessor)
