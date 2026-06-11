import { BaseFx } from './base'

// Worklet-based bitcrusher with a WaveShaper quantize fallback if the
// worklet module fails to load (no downsample in fallback mode).

const moduleLoaded = new WeakMap<BaseAudioContext, Promise<boolean>>()

function ensureModule(ctx: BaseAudioContext): Promise<boolean> {
  let p = moduleLoaded.get(ctx)
  if (!p) {
    p = ctx.audioWorklet
      .addModule('/worklets/bitcrusher.js')
      .then(() => true)
      .catch(() => false)
    moduleLoaded.set(ctx, p)
  }
  return p
}

export class Bitcrusher extends BaseFx {
  readonly id = 'bitcrusher' as const
  readonly ready: Promise<void>
  private worklet: AudioWorkletNode | null = null
  private fallback: WaveShaperNode | null = null
  private pending: { bits: number; downsample: number }

  constructor(ctx: BaseAudioContext, cfg: { bits: number; downsample: number; mix: number }) {
    super(ctx, cfg.mix, 'crossfade')
    this.pending = { bits: cfg.bits, downsample: cfg.downsample }
    this.ready = ensureModule(ctx).then(ok => {
      if (ok) {
        this.worklet = new AudioWorkletNode(ctx, 'bitcrusher', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        })
        this.setParam('bits', this.pending.bits, ctx.currentTime)
        this.setParam('downsample', this.pending.downsample, ctx.currentTime)
        this.wetIn.connect(this.worklet)
        this.worklet.connect(this.wet)
      } else {
        this.fallback = ctx.createWaveShaper()
        this.fallback.curve = quantizeCurve(this.pending.bits)
        this.wetIn.connect(this.fallback)
        this.fallback.connect(this.wet)
      }
    })
  }

  protected applyOwn(key: string, value: number, t: number): void {
    if (key !== 'bits' && key !== 'downsample') return
    this.pending[key] = value
    if (this.worklet) {
      this.setParam(key, value, t)
    } else if (this.fallback && key === 'bits') {
      this.fallback.curve = quantizeCurve(value)
    }
  }

  private setParam(name: 'bits' | 'downsample', value: number, t: number): void {
    const param = this.worklet?.parameters.get(name)
    param?.setTargetAtTime(value, t, 0.02)
  }

  override dispose(): void {
    this.worklet?.disconnect()
    this.fallback?.disconnect()
    super.dispose()
  }
}

function quantizeCurve(bits: number): Float32Array<ArrayBuffer> {
  const len = 4096
  const curve = new Float32Array(len)
  const steps = Math.pow(2, bits - 1)
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * 2 - 1
    curve[i] = Math.round(x * steps) / steps
  }
  return curve
}
