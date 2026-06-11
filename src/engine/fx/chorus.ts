import { BaseFx } from './base'

// Two modulated delay lines (~12/17 ms) panned-ish via slight gain offsets.
export class Chorus extends BaseFx {
  readonly id = 'chorus' as const
  private readonly lfo: OscillatorNode
  private readonly depthGains: GainNode[]

  constructor(ctx: BaseAudioContext, cfg: { rate: number; depth: number; mix: number }) {
    super(ctx, cfg.mix, 'crossfade')
    this.lfo = ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = cfg.rate
    this.depthGains = []

    const baseTimes = [0.012, 0.017]
    for (let i = 0; i < baseTimes.length; i++) {
      const delay = ctx.createDelay(0.06)
      delay.delayTime.value = baseTimes[i]
      const depth = ctx.createGain()
      // opposite-phase modulation on the second line widens the image
      depth.gain.value = (i === 0 ? 1 : -1) * this.depthSeconds(cfg.depth)
      this.lfo.connect(depth)
      depth.connect(delay.delayTime)
      this.wetIn.connect(delay)
      delay.connect(this.wet)
      this.depthGains.push(depth)
    }
    this.lfo.start()
  }

  private depthSeconds(depth: number): number {
    return depth * 0.004 // up to ±4 ms swing
  }

  protected applyOwn(key: string, value: number, t: number): void {
    if (key === 'rate') {
      this.lfo.frequency.setTargetAtTime(value, t, 0.05)
    } else if (key === 'depth') {
      const d = this.depthSeconds(value)
      this.depthGains[0].gain.setTargetAtTime(d, t, 0.05)
      this.depthGains[1].gain.setTargetAtTime(-d, t, 0.05)
    }
  }

  override dispose(): void {
    this.lfo.stop()
    this.lfo.disconnect()
    super.dispose()
  }
}
