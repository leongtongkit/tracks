import type { FxId } from '../../patch/schema'

export interface FxModule {
  readonly id: FxId
  readonly input: GainNode
  readonly output: GainNode
  setEnabled(on: boolean): void
  // key is the param name inside the fx config, e.g. 'mix', 'drive'
  apply(key: string, value: number, t: number): void
  applyAll(cfg: Record<string, number | boolean>, t: number): void
  dispose(): void
}

export type MixStyle = 'crossfade' | 'send'

// Shared dry/wet plumbing with true bypass: when disabled the wet path is
// fully disconnected so it costs no CPU (subgraphs with no route to the
// destination are not processed).
export abstract class BaseFx implements FxModule {
  abstract readonly id: FxId
  readonly input: GainNode
  readonly output: GainNode
  protected readonly ctx: BaseAudioContext
  protected readonly dry: GainNode
  protected readonly wetIn: GainNode // head of the wet path; subclass connects from here
  protected readonly wet: GainNode // tail of the wet path; subclass connects into this
  private enabled = false
  private mix: number
  private readonly style: MixStyle

  constructor(ctx: BaseAudioContext, mix: number, style: MixStyle) {
    this.ctx = ctx
    this.style = style
    this.mix = mix
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.dry = ctx.createGain()
    this.wetIn = ctx.createGain()
    this.wet = ctx.createGain()
    this.input.connect(this.dry)
    this.dry.connect(this.output)
    this.applyMixGains(ctx.currentTime)
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on
    if (on) {
      this.input.connect(this.wetIn)
      this.wet.connect(this.output)
    } else {
      this.input.disconnect(this.wetIn)
      this.wet.disconnect(this.output)
    }
    this.applyMixGains(this.ctx.currentTime)
  }

  apply(key: string, value: number, t: number): void {
    if (key === 'mix') {
      this.mix = value
      this.applyMixGains(t)
      return
    }
    this.applyOwn(key, value, t)
  }

  applyAll(cfg: Record<string, number | boolean>, t: number): void {
    for (const [key, value] of Object.entries(cfg)) {
      if (key === 'on') {
        this.setEnabled(value as boolean)
      } else if (typeof value === 'number') {
        this.apply(key, value, t)
      }
    }
  }

  protected abstract applyOwn(key: string, value: number, t: number): void

  private applyMixGains(t: number): void {
    const dry = !this.enabled ? 1 : this.style === 'send' ? 1 : 1 - this.mix
    const wet = this.mix
    this.dry.gain.setTargetAtTime(dry, t, 0.02)
    this.wet.gain.setTargetAtTime(wet, t, 0.02)
  }

  dispose(): void {
    this.input.disconnect()
    this.dry.disconnect()
    this.wetIn.disconnect()
    this.wet.disconnect()
    this.output.disconnect()
  }
}
