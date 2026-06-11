import { BaseFx } from './base'

export class Delay extends BaseFx {
  readonly id = 'delay' as const
  private readonly delayNode: DelayNode
  private readonly feedback: GainNode
  private readonly damp: BiquadFilterNode

  constructor(ctx: BaseAudioContext, cfg: { time: number; feedback: number; mix: number }) {
    super(ctx, cfg.mix, 'send')
    this.delayNode = ctx.createDelay(2.5)
    this.delayNode.delayTime.value = cfg.time
    this.feedback = ctx.createGain()
    this.feedback.gain.value = cfg.feedback
    this.damp = ctx.createBiquadFilter()
    this.damp.type = 'lowpass'
    this.damp.frequency.value = 5000

    this.wetIn.connect(this.delayNode)
    this.delayNode.connect(this.damp)
    this.damp.connect(this.wet)
    this.damp.connect(this.feedback)
    this.feedback.connect(this.delayNode)
  }

  protected applyOwn(key: string, value: number, t: number): void {
    if (key === 'time') {
      this.delayNode.delayTime.setTargetAtTime(Math.min(2.5, value), t, 0.05)
    } else if (key === 'feedback') {
      this.feedback.gain.setTargetAtTime(Math.min(0.92, value), t, 0.02)
    }
  }
}
