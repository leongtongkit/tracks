import type { Patch } from '../patch/schema'
import { midiToFreq, type VoiceState } from './allocator'
import { triggerAttack, triggerRelease, holdAt, releaseEndTime } from './envelope'
import { getNoiseBuffer } from './noise'

const VOICE_PEAK = 0.2 // per-voice ceiling so chords don't slam the master bus
const FILTER_ENV_CENTS = 4800 // envAmount = 1 sweeps the cutoff 4 octaves
const STEAL_FADE_TAU = 0.0015 // ~4 ms fade when a voice is stolen

interface SourceSlot {
  node: OscillatorNode | AudioBufferSourceNode
  gain: GainNode
  oscIndex: number
  ratio: number // frequency multiplier from octave/semi; 0 for noise
}

// One polyphony slot. The node graph is built per noteOn (idiomatic Web Audio)
// but this wrapper object is pooled by the engine, so the JS heap stays flat.
export class Voice {
  state: VoiceState = 'free'
  note = -1
  startTime = 0
  releaseEnd = 0

  private sources: SourceSlot[] = []
  private filter: BiquadFilterNode | null = null
  private vca: GainNode | null = null
  private filterBase = 0 // key-track detune offset in cents

  noteOn(ctx: BaseAudioContext, dest: AudioNode, patch: Patch, note: number, t: number): void {
    this.dispose()
    const freq = midiToFreq(note)

    const vca = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = patch.filter.type
    filter.frequency.value = patch.filter.cutoff
    filter.Q.value = patch.filter.resonance
    filter.connect(vca)
    vca.connect(dest)

    for (let i = 0; i < patch.osc.length; i++) {
      const cfg = patch.osc[i]
      if (!cfg.enabled || cfg.level === 0) continue
      const gain = ctx.createGain()
      gain.gain.value = cfg.level
      gain.connect(filter)

      if (cfg.wave === 'noise') {
        const node = ctx.createBufferSource()
        node.buffer = getNoiseBuffer(ctx)
        node.loop = true
        node.loopStart = Math.random()
        node.connect(gain)
        node.start(t, node.loopStart)
        this.sources.push({ node, gain, oscIndex: i, ratio: 0 })
      } else {
        const node = ctx.createOscillator()
        node.type = cfg.wave === 'saw' ? 'sawtooth' : cfg.wave
        const ratio = Math.pow(2, cfg.octave + cfg.semi / 12)
        node.frequency.value = freq * ratio
        node.detune.value = cfg.fine
        node.connect(gain)
        node.start(t)
        this.sources.push({ node, gain, oscIndex: i, ratio })
      }
    }

    // Filter envelope rides the detune param (cents = log-frequency domain),
    // on top of a key-tracking base offset.
    this.filterBase = patch.filter.keyTrack * (note - 60) * 100
    triggerAttack(filter.detune, patch.env.filter, t, this.filterBase, patch.filter.envAmount * FILTER_ENV_CENTS)
    triggerAttack(vca.gain, patch.env.amp, t, 0, VOICE_PEAK)

    this.filter = filter
    this.vca = vca
    this.state = 'active'
    this.note = note
    this.startTime = t
    this.releaseEnd = Infinity
  }

  noteOff(patch: Patch, t: number): void {
    if (this.state !== 'active' || !this.vca || !this.filter) return
    triggerRelease(this.vca.gain, patch.env.amp, t)
    triggerRelease(this.filter.detune, patch.env.filter, t, this.filterBase)
    this.releaseEnd = releaseEndTime(patch.env.amp, t)
    this.stopSourcesAt(this.releaseEnd)
    this.state = 'releasing'
  }

  // Fast inaudible fade so the slot can be reused immediately without a click.
  steal(t: number): void {
    if (this.state === 'free') return
    if (this.vca) {
      holdAt(this.vca.gain, t)
      this.vca.gain.setTargetAtTime(0, t, STEAL_FADE_TAU)
    }
    this.stopSourcesAt(t + 0.02)
    this.state = 'free'
  }

  // Mono/legato: move the sounding note without rebuilding the graph.
  glideTo(patch: Patch, note: number, glide: number, t: number, retrigger: boolean): void {
    if (!this.filter || !this.vca) return
    const freq = midiToFreq(note)
    const tau = Math.max(0.001, glide / 3)
    for (const s of this.sources) {
      if (s.ratio === 0) continue
      ;(s.node as OscillatorNode).frequency.setTargetAtTime(freq * s.ratio, t, tau)
    }
    const newBase = patch.filter.keyTrack * (note - 60) * 100
    if (retrigger) {
      triggerAttack(this.filter.detune, patch.env.filter, t, newBase, patch.filter.envAmount * FILTER_ENV_CENTS)
      triggerAttack(this.vca.gain, patch.env.amp, t, 0, VOICE_PEAK)
    } else {
      // shift key-tracking smoothly without restarting the envelope
      this.filter.detune.setTargetAtTime(
        newBase + patch.filter.envAmount * FILTER_ENV_CENTS * patch.env.filter.s, t, tau)
    }
    this.filterBase = newBase
    this.note = note
  }

  // Live updates from knobs to the sounding voice.
  applyParam(path: string, value: number | string, t: number): void {
    if (!this.filter || !this.vca || this.state === 'free') return
    if (path === 'filter.cutoff') {
      this.filter.frequency.setTargetAtTime(value as number, t, 0.015)
    } else if (path === 'filter.resonance') {
      this.filter.Q.setTargetAtTime(value as number, t, 0.02)
    } else if (path === 'filter.type') {
      this.filter.type = value as BiquadFilterType
    } else if (path.startsWith('osc.') && path.endsWith('.level')) {
      const idx = Number(path.split('.')[1])
      for (const s of this.sources) {
        if (s.oscIndex === idx) s.gain.gain.setTargetAtTime(value as number, t, 0.02)
      }
    }
  }

  // True when the slot can be reallocated.
  isReclaimable(now: number): boolean {
    return this.state === 'free' || (this.state === 'releasing' && now >= this.releaseEnd)
  }

  private stopSourcesAt(t: number): void {
    for (const s of this.sources) {
      try {
        s.node.stop(t)
      } catch {
        // already stopped
      }
    }
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.node.stop()
      } catch {
        // never started or already stopped
      }
      s.node.disconnect()
      s.gain.disconnect()
    }
    this.sources.length = 0
    this.filter?.disconnect()
    this.vca?.disconnect()
    this.filter = null
    this.vca = null
    this.state = 'free'
    this.note = -1
  }
}
