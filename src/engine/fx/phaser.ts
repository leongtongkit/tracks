import { BaseFx } from './base'

const STAGES = 4
const BASE_FREQ = 700 // center of the allpass sweep

export class Phaser extends BaseFx {
  readonly id = 'phaser' as const
  private readonly lfo: OscillatorNode
  private readonly depthGain: GainNode
  private readonly stages: BiquadFilterNode[] = []

  constructor(ctx: BaseAudioContext, cfg: { rate: number; depth: number; mix: number }) {
    super(ctx, cfg.mix, 'crossfade')
    this.lfo = ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = cfg.rate
    this.depthGain = ctx.createGain()
    this.depthGain.gain.value = this.depthCents(cfg.depth)
    this.lfo.connect(this.depthGain)

    let prev: AudioNode = this.wetIn
    for (let i = 0; i < STAGES; i++) {
      const ap = ctx.createBiquadFilter()
      ap.type = 'allpass'
      ap.frequency.value = BASE_FREQ * (1 + i * 0.6)
      ap.Q.value = 0.6
      // sweep all stages together in the log domain via detune (cents)
      this.depthGain.connect(ap.detune)
      prev.connect(ap)
      prev = ap
      this.stages.push(ap)
    }
    prev.connect(this.wet)
    this.lfo.start()
  }

  private depthCents(depth: number): number {
    return depth * 2400 // ±2 octaves of sweep at full depth
  }

  protected applyOwn(key: string, value: number, t: number): void {
    if (key === 'rate') {
      this.lfo.frequency.setTargetAtTime(value, t, 0.05)
    } else if (key === 'depth') {
      this.depthGain.gain.setTargetAtTime(this.depthCents(value), t, 0.05)
    }
  }

  override dispose(): void {
    this.lfo.stop()
    this.lfo.disconnect()
    this.depthGain.disconnect()
    super.dispose()
  }
}
