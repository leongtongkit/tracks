import type { FxId, Patch } from '../../patch/schema'
import type { FxModule } from './base'
import { Bitcrusher } from './bitcrusher'
import { Chorus } from './chorus'
import { Delay } from './delay'
import { Distortion } from './distortion'
import { Phaser } from './phaser'
import { Reverb } from './reverb'

// Ordered, reorderable effects rack between the voice bus and the master.
export class FxChain {
  readonly input: GainNode
  readonly output: GainNode
  readonly ready: Promise<void>
  private readonly modules: Map<FxId, FxModule>
  private order: FxId[]

  constructor(ctx: BaseAudioContext, patch: Patch) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    const fx = patch.fx
    const bitcrusher = new Bitcrusher(ctx, fx.bitcrusher)
    this.modules = new Map<FxId, FxModule>([
      ['distortion', new Distortion(ctx, fx.distortion)],
      ['bitcrusher', bitcrusher],
      ['chorus', new Chorus(ctx, fx.chorus)],
      ['phaser', new Phaser(ctx, fx.phaser)],
      ['delay', new Delay(ctx, fx.delay)],
      ['reverb', new Reverb(ctx, fx.reverb)],
    ])
    this.ready = bitcrusher.ready
    this.order = [...fx.order]
    this.wire()
    this.applyAll(patch, ctx.currentTime)
  }

  setOrder(order: FxId[]): void {
    this.order = [...new Set(order)].filter(id => this.modules.has(id))
    this.wire()
  }

  setEnabled(id: FxId, on: boolean): void {
    this.modules.get(id)?.setEnabled(on)
  }

  apply(id: FxId, key: string, value: number, t: number): void {
    this.modules.get(id)?.apply(key, value, t)
  }

  applyAll(patch: Patch, t: number): void {
    for (const [id, mod] of this.modules) {
      mod.applyAll(patch.fx[id] as unknown as Record<string, number | boolean>, t)
    }
    if (patch.fx.order.join() !== this.order.join()) {
      this.setOrder([...patch.fx.order])
    }
  }

  private wire(): void {
    this.input.disconnect()
    for (const mod of this.modules.values()) mod.output.disconnect()
    let prev: AudioNode = this.input
    for (const id of this.order) {
      const mod = this.modules.get(id)!
      prev.connect(mod.input)
      prev = mod.output
    }
    prev.connect(this.output)
  }
}
