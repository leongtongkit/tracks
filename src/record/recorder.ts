import { encodeWav } from './wav'

// Taps an audio node (the master bus) through a worklet and produces a WAV.
export class Recorder {
  recording = false
  private node: AudioWorkletNode | null = null
  private source: AudioNode | null = null
  private chunks: [Float32Array, Float32Array][] = []
  private startedAt = 0

  async start(ctx: AudioContext, source: AudioNode): Promise<void> {
    if (this.recording) return
    await ctx.audioWorklet.addModule('/worklets/recorder.js')
    this.chunks = []
    this.node = new AudioWorkletNode(ctx, 'recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: 'explicit',
    })
    this.node.port.onmessage = e => {
      if (this.recording) this.chunks.push(e.data as [Float32Array, Float32Array])
    }
    source.connect(this.node)
    this.source = source
    this.recording = true
    this.startedAt = ctx.currentTime
  }

  elapsed(ctx: AudioContext): number {
    return this.recording ? ctx.currentTime - this.startedAt : 0
  }

  stop(ctx: AudioContext): Blob | null {
    if (!this.recording || !this.node) return null
    this.recording = false
    this.node.port.postMessage('stop')
    this.source?.disconnect(this.node)
    this.node = null
    this.source = null

    const frames = this.chunks.reduce((n, c) => n + c[0].length, 0)
    if (frames === 0) return null
    const left = new Float32Array(frames)
    const right = new Float32Array(frames)
    let offset = 0
    for (const [l, r] of this.chunks) {
      left.set(l, offset)
      right.set(r, offset)
      offset += l.length
    }
    this.chunks = []
    return new Blob([encodeWav(left, right, ctx.sampleRate)], { type: 'audio/wav' })
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
