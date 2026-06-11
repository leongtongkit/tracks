import type { Patch } from '../patch/schema'
import { midiToFreq, type VoiceState } from './allocator'
import { triggerAttack, triggerRelease, holdAt, releaseEndTime } from './envelope'
import { getNoiseBuffer } from './noise'

const VOICE_PEAK = 0.2 // per-voice ceiling so chords don't slam the master bus
const FILTER_ENV_CENTS = 4800 // envAmount = 1 sweeps the cutoff 4 octaves
const STEAL_FADE_TAU = 0.0015 // ~4 ms fade when a voice is stolen
const FM_INDEX_SCALE = 6 // fm.depth = 1 → frequency deviation of 6 × f0

interface SourceSlot {
  node: OscillatorNode | AudioBufferSourceNode
  gain: GainNode
  panner: StereoPannerNode | null
  oscIndex: number
  ratio: number // frequency multiplier from octave/semi; 0 for noise
  fine: number // base detune in cents (incl. unison offset); bend adds on top
}

// External modulation sources (global LFO depth gains) a voice hooks into
// its params at noteOn; tracked so dispose() can sever them cleanly.
export interface VoiceMods {
  pitch: AudioNode[] // cents into oscillator detune
  filter: AudioNode[] // cents into filter detune
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
  private fmOsc: OscillatorNode | null = null
  private fmGain: GainNode | null = null
  private baseFreq = 0
  private velocity = 1
  private modTaps: { src: AudioNode; param: AudioParam }[] = []

  noteOn(
    ctx: BaseAudioContext,
    dest: AudioNode,
    patch: Patch,
    note: number,
    t: number,
    mods?: VoiceMods,
    velocity = 1,
  ): void {
    this.dispose()
    const freq = midiToFreq(note)
    this.baseFreq = freq
    this.velocity = velocity

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
        this.sources.push({ node, gain, panner: null, oscIndex: i, ratio: 0, fine: 0 })
      } else {
        const ratio = Math.pow(2, cfg.octave + cfg.semi / 12)
        const count = Math.max(1, cfg.unison.count)
        // normalize summed level so 7 unison voices don't get 7x loud
        gain.gain.value = cfg.level / Math.sqrt(count)
        for (let u = 0; u < count; u++) {
          const node = ctx.createOscillator()
          node.type = cfg.wave === 'saw' ? 'sawtooth' : cfg.wave
          node.frequency.value = freq * ratio
          // spread sub-oscillators evenly across ±detune/2 cents and the stereo field
          const pos = count === 1 ? 0 : u / (count - 1) - 0.5
          const fine = cfg.fine + pos * cfg.unison.detune
          node.detune.value = fine
          let panner: StereoPannerNode | null = null
          if (count > 1 && typeof ctx.createStereoPanner === 'function') {
            panner = ctx.createStereoPanner()
            panner.pan.value = pos * 2 * cfg.unison.spread
            node.connect(panner)
            panner.connect(gain)
          } else {
            node.connect(gain)
          }
          node.start(t)
          this.sources.push({ node, gain, panner, oscIndex: i, ratio, fine })
        }
      }
    }

    // FM: dedicated sine modulator into the first pitched oscillator's
    // frequency; deviation scales with f0 so timbre is pitch-consistent.
    const carrier = this.sources.find(s => s.ratio !== 0)
    if (patch.fm.enabled && carrier) {
      const fmOsc = ctx.createOscillator()
      fmOsc.type = 'sine'
      fmOsc.frequency.value = freq * patch.fm.ratio
      const fmGain = ctx.createGain()
      fmGain.gain.value = patch.fm.depth * freq * FM_INDEX_SCALE
      fmOsc.connect(fmGain)
      fmGain.connect((carrier.node as OscillatorNode).frequency)
      fmOsc.start(t)
      this.fmOsc = fmOsc
      this.fmGain = fmGain
    }

    // Global LFO depth gains feed every voice's detune params (cents domain).
    if (mods) {
      for (const src of mods.pitch) {
        for (const s of this.sources) {
          if (s.ratio === 0) continue
          src.connect((s.node as OscillatorNode).detune)
          this.modTaps.push({ src, param: (s.node as OscillatorNode).detune })
        }
      }
      for (const src of mods.filter) {
        src.connect(filter.detune)
        this.modTaps.push({ src, param: filter.detune })
      }
    }

    // Filter envelope rides the detune param (cents = log-frequency domain),
    // on top of a key-tracking base offset.
    this.filterBase = patch.filter.keyTrack * (note - 60) * 100
    triggerAttack(filter.detune, patch.env.filter, t, this.filterBase, patch.filter.envAmount * FILTER_ENV_CENTS)
    triggerAttack(vca.gain, patch.env.amp, t, 0, VOICE_PEAK * (0.3 + 0.7 * velocity))

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
  // The old graph is detached from this voice and cleans itself up when its
  // sources end, so the immediately-following noteOn cannot cut the fade short.
  steal(t: number): void {
    if (this.state === 'free') return
    if (this.vca) {
      holdAt(this.vca.gain, t)
      this.vca.gain.setTargetAtTime(0, t, STEAL_FADE_TAU)
    }
    this.stopSourcesAt(t + 0.02)
    const orphans = this.sources.slice()
    const filter = this.filter
    const vca = this.vca
    const fmOsc = this.fmOsc
    const fmGain = this.fmGain
    const taps = this.modTaps.slice()
    const last = orphans[orphans.length - 1]?.node
    if (last) {
      last.onended = () => {
        for (const tap of taps) {
          try {
            tap.src.disconnect(tap.param)
          } catch {
            // already severed
          }
        }
        for (const s of orphans) {
          s.node.disconnect()
          s.panner?.disconnect()
          s.gain.disconnect()
        }
        fmOsc?.disconnect()
        fmGain?.disconnect()
        filter?.disconnect()
        vca?.disconnect()
      }
    }
    // detach without stopping: the scheduled fade/stop finishes on its own
    this.sources = []
    this.modTaps = []
    this.filter = null
    this.vca = null
    this.fmOsc = null
    this.fmGain = null
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
      triggerAttack(this.vca.gain, patch.env.amp, t, 0, VOICE_PEAK * (0.3 + 0.7 * this.velocity))
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
    } else if (path === 'fm.depth' && this.fmGain) {
      this.fmGain.gain.setTargetAtTime((value as number) * this.baseFreq * FM_INDEX_SCALE, t, 0.02)
    } else if (path === 'fm.ratio' && this.fmOsc) {
      this.fmOsc.frequency.setTargetAtTime(this.baseFreq * (value as number), t, 0.02)
    }
  }

  // Pitch bend in cents, applied on top of each oscillator's fine detune.
  // (Global LFO pitch modulation also sums into detune via its connection.)
  setBend(cents: number, t: number): void {
    for (const s of this.sources) {
      if (s.ratio === 0) continue
      ;(s.node as OscillatorNode).detune.setTargetAtTime(s.fine + cents, t, 0.03)
    }
    this.fmOsc?.detune.setTargetAtTime(cents, t, 0.03)
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
    if (this.fmOsc) {
      try {
        this.fmOsc.stop(t)
      } catch {
        // already stopped
      }
    }
  }

  dispose(): void {
    for (const tap of this.modTaps) {
      try {
        tap.src.disconnect(tap.param)
      } catch {
        // already severed with the node graph
      }
    }
    this.modTaps.length = 0
    for (const s of this.sources) {
      try {
        s.node.stop()
      } catch {
        // never started or already stopped
      }
      s.node.disconnect()
      s.panner?.disconnect()
      s.gain.disconnect()
    }
    this.sources.length = 0
    if (this.fmOsc) {
      try {
        this.fmOsc.stop()
      } catch {
        // already stopped
      }
      this.fmOsc.disconnect()
      this.fmGain?.disconnect()
      this.fmOsc = null
      this.fmGain = null
    }
    this.filter?.disconnect()
    this.vca?.disconnect()
    this.filter = null
    this.vca = null
    this.state = 'free'
    this.note = -1
  }
}
