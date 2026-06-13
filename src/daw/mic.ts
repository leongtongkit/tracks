// Microphone capture into an AudioBuffer, via the same worklet the master
// recorder uses. Music settings: echo cancellation / noise suppression /
// auto gain all off.

export class MicRecorder {
  recording = false
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private chunks: [Float32Array, Float32Array][] = []
  private ctx: AudioContext | null = null

  // resolves once audio is actually flowing; throws if the mic is denied.
  // processing=true enables echo cancellation/noise suppression (voice memos);
  // false records raw (music).
  async start(ctx: AudioContext, processing = false): Promise<void> {
    if (this.recording) return
    this.ctx = ctx
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: processing, noiseSuppression: processing, autoGainControl: processing },
    })
    await ctx.audioWorklet.addModule('/worklets/recorder.js')
    this.chunks = []
    this.source = ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(ctx, 'recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: 'explicit',
    })
    this.node.port.onmessage = e => {
      if (this.recording) this.chunks.push(e.data as [Float32Array, Float32Array])
    }
    this.source.connect(this.node)
    this.recording = true
  }

  stop(): AudioBuffer | null {
    if (!this.recording) return null
    this.recording = false
    this.node?.port.postMessage('stop')
    this.source?.disconnect()
    for (const t of this.stream?.getTracks() ?? []) t.stop()
    this.node = null
    this.source = null
    this.stream = null

    const ctx = this.ctx
    const frames = this.chunks.reduce((n, c) => n + c[0].length, 0)
    if (!ctx || frames === 0) return null
    const buffer = new AudioBuffer({ length: frames, numberOfChannels: 2, sampleRate: ctx.sampleRate })
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)
    let offset = 0
    for (const [l, r] of this.chunks) {
      left.set(l, offset)
      right.set(r, offset)
      offset += l.length
    }
    this.chunks = []
    return buffer
  }
}
