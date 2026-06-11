import { BaseFx } from './base'

const CURVE_LEN = 2048

export class Distortion extends BaseFx {
  readonly id = 'distortion' as const
  private readonly shaper: WaveShaperNode
  private readonly toneFilter: BiquadFilterNode
  private readonly preGain: GainNode
  private readonly makeup: GainNode

  constructor(ctx: BaseAudioContext, cfg: { drive: number; tone: number; mix: number }) {
    super(ctx, cfg.mix, 'crossfade')
    this.preGain = ctx.createGain()
    this.shaper = ctx.createWaveShaper()
    this.shaper.oversample = '2x'
    this.toneFilter = ctx.createBiquadFilter()
    this.toneFilter.type = 'lowpass'
    this.makeup = ctx.createGain()

    this.wetIn.connect(this.preGain)
    this.preGain.connect(this.shaper)
    this.shaper.connect(this.toneFilter)
    this.toneFilter.connect(this.makeup)
    this.makeup.connect(this.wet)

    this.applyOwn('drive', cfg.drive, ctx.currentTime)
    this.applyOwn('tone', cfg.tone, ctx.currentTime)
  }

  protected applyOwn(key: string, value: number, t: number): void {
    if (key === 'drive') {
      // drive 0..1 → input boost 1..16 into a tanh curve
      const boost = 1 + value * 15
      this.preGain.gain.setTargetAtTime(boost, t, 0.02)
      this.shaper.curve = makeTanhCurve()
      // compensate output level as drive rises
      this.makeup.gain.setTargetAtTime(Math.min(1, 1 / Math.sqrt(boost)) * 1.2, t, 0.02)
    } else if (key === 'tone') {
      // tone 0..1 → lowpass 400 Hz .. 14 kHz
      const freq = 400 * Math.pow(35, value)
      this.toneFilter.frequency.setTargetAtTime(freq, t, 0.02)
    }
  }
}

let cachedCurve: Float32Array<ArrayBuffer> | null = null
function makeTanhCurve(): Float32Array<ArrayBuffer> {
  if (!cachedCurve) {
    cachedCurve = new Float32Array(CURVE_LEN)
    for (let i = 0; i < CURVE_LEN; i++) {
      const x = (i / (CURVE_LEN - 1)) * 2 - 1
      cachedCurve[i] = Math.tanh(x * 3)
    }
  }
  return cachedCurve
}
