import type { LfoConfig, Patch } from '../patch/schema'

// Two global free-running LFOs. Pitch/filter depths are exposed as gain nodes
// that voices connect to their detune params at noteOn; amp modulates a shared
// tremolo gain on the voice bus.

interface LfoUnit {
  osc: OscillatorNode
  pitch: GainNode // output in cents
  filter: GainNode // output in cents
  amp: GainNode // output 0..1 into tremolo.gain
}

export class LfoBank {
  readonly tremolo: GainNode
  private readonly units: [LfoUnit, LfoUnit]
  private ampDepths = [0, 0]

  constructor(ctx: BaseAudioContext, patch: Patch) {
    this.tremolo = ctx.createGain()
    this.units = [this.makeUnit(ctx, patch.lfo[0]), this.makeUnit(ctx, patch.lfo[1])]
    this.ampDepths = [patch.lfo[0].targets.amp, patch.lfo[1].targets.amp]
    this.updateTremoloBase(ctx.currentTime)
  }

  private makeUnit(ctx: BaseAudioContext, cfg: LfoConfig): LfoUnit {
    const osc = ctx.createOscillator()
    osc.type = cfg.wave
    osc.frequency.value = cfg.rate
    const pitch = ctx.createGain()
    pitch.gain.value = cfg.targets.pitch
    const filter = ctx.createGain()
    filter.gain.value = cfg.targets.filter
    const amp = ctx.createGain()
    amp.gain.value = cfg.targets.amp * 0.5
    osc.connect(pitch)
    osc.connect(filter)
    osc.connect(amp)
    amp.connect(this.tremolo.gain)
    osc.start()
    return { osc, pitch, filter, amp }
  }

  // Sources voices connect to their oscillator/filter detune at noteOn.
  pitchSources(): AudioNode[] {
    return [this.units[0].pitch, this.units[1].pitch]
  }

  filterSources(): AudioNode[] {
    return [this.units[0].filter, this.units[1].filter]
  }

  apply(path: string, value: number | string, t: number): void {
    // paths: lfo.<i>.rate | lfo.<i>.wave | lfo.<i>.targets.<pitch|filter|amp>
    const segs = path.split('.')
    const unit = this.units[Number(segs[1])]
    if (!unit) return
    const leaf = segs[segs.length - 1]
    if (leaf === 'rate') {
      unit.osc.frequency.setTargetAtTime(value as number, t, 0.05)
    } else if (leaf === 'wave') {
      unit.osc.type = value as OscillatorType
    } else if (leaf === 'pitch') {
      unit.pitch.gain.setTargetAtTime(value as number, t, 0.02)
    } else if (leaf === 'filter') {
      unit.filter.gain.setTargetAtTime(value as number, t, 0.02)
    } else if (leaf === 'amp') {
      this.ampDepths[Number(segs[1])] = value as number
      this.updateTremoloBase(t)
    }
  }

  applyAll(patch: Patch, t: number): void {
    for (let i = 0; i < 2; i++) {
      const cfg = patch.lfo[i]
      this.apply(`lfo.${i}.rate`, cfg.rate, t)
      this.apply(`lfo.${i}.wave`, cfg.wave, t)
      this.apply(`lfo.${i}.targets.pitch`, cfg.targets.pitch, t)
      this.apply(`lfo.${i}.targets.filter`, cfg.targets.filter, t)
      this.apply(`lfo.${i}.targets.amp`, cfg.targets.amp, t)
    }
  }

  // Tremolo sits at 1 with no amp modulation; with depth d the LFO swings
  // gain between 1-2d·scale and 1. When both LFOs run deep, their summed
  // swing is rescaled so the gain never crosses below zero (phase inversion).
  private updateTremoloBase(t: number): void {
    const half = (this.ampDepths[0] + this.ampDepths[1]) / 2
    const total = Math.min(1, half)
    const scale = half > 1 ? total / half : 1
    for (let i = 0; i < 2; i++) {
      this.units[i].amp.gain.setTargetAtTime(this.ampDepths[i] * 0.5 * scale, t, 0.02)
    }
    this.tremolo.gain.setTargetAtTime(Math.max(0, 1 - total), t, 0.02)
  }
}
