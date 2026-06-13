// Multi-track audio graph. Each track gets a channel whose instrument depends
// on the track kind (synth Engine / drum machine / sampler / none for audio
// clips), feeding a full channel strip:
//
//   input → 3-band EQ → compressor → makeup → pan → volume → mute → master
//                                                            └→ send A (reverb bus)
//                                                            └→ send B (delay bus)
//
// Channels rebind to fresh TrackData objects on every sync so undo/redo
// (which replaces the project object) keeps working graphs.

import { Engine } from '../engine/engine'
import { FxChain } from '../engine/fx/chain'
import { makeImpulse } from '../engine/fx/reverb'
import type { FxId } from '../patch/schema'
import { Store } from '../state/store'
import { autoValueAt } from './automation'
import { timeStretch } from './dsp/stretch'
import { DrumMachine } from './instruments/drums'
import { PadsInstrument } from './instruments/pads'
import { SamplerInstrument } from './instruments/sampler'
import type { Instrument } from './instruments/types'
import { eqUsesGain, MAX_EQ_BANDS, type AudioRegion, type AutoTarget, type EqBand, type Project, type TrackData, type TrackKind } from './project'
import { sampleStore, type SampleStore } from './samples'

// every channel-strip param that can be automated (order is display order)
const AUTOMATABLE: AutoTarget[] = ['volume', 'pan', 'sendA', 'sendB', 'eqLow', 'eqMid', 'eqHigh']
// automation targets that map to EQ band gains, by slot index
const EQ_SLOT_TARGETS: AutoTarget[] = ['eqLow', 'eqMid', 'eqHigh']

// Maps a (non-negative) envelope level → gate gain: ~floor below threshold,
// ramping smoothly to 1 above it. Used as a WaveShaper curve on the control path.
function gateCurve(threshold: number, floor: number): Float32Array<ArrayBuffer> {
  const N = 1024
  const c = new Float32Array(N)
  const w = Math.max(0.006, threshold * 0.6) // soft knee half-width
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1 // waveshaper input domain
    if (x <= 0) {
      c[i] = floor
      continue
    }
    const tt = Math.min(1, Math.max(0, (x - (threshold - w)) / (2 * w)))
    c[i] = floor + (1 - floor) * (tt * tt * (3 - 2 * tt)) // smoothstep
  }
  return c
}

// Maps the high-band envelope → a bounded high-shelf cut (dB). Engages above a
// low threshold and caps at -amount*18 dB so loud sibilance is tamed without
// the cut running away on louder material.
function deEssCurve(amount: number): Float32Array<ArrayBuffer> {
  const N = 1024
  const c = new Float32Array(N)
  const maxCut = amount * 18
  const lo = 0.012
  const hi = 0.08
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1 // envelope domain (non-negative in practice)
    if (x <= lo) {
      c[i] = 0
      continue
    }
    const tt = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
    c[i] = -maxCut * (tt * tt * (3 - 2 * tt))
  }
  return c
}

export interface SendBuses {
  a: AudioNode
  b: AudioNode
}

export class TrackChannel {
  readonly kind: TrackKind
  readonly input: GainNode // audio-clip sources and instruments both feed this
  readonly store: Store | null
  readonly engine: Engine | null
  readonly ready: Promise<void>
  private readonly instr: Instrument | null
  private readonly fxChain: FxChain | null
  private readonly ctx: BaseAudioContext
  private readonly gateGain: GainNode // noise gate (control-driven), pre-EQ
  private gateNodes: { abs: WaveShaperNode; lp: BiquadFilterNode; shaper: WaveShaperNode } | null = null
  private readonly eqBands: BiquadFilterNode[] // fixed MAX_EQ_BANDS slots, in series
  private readonly deEss: BiquadFilterNode // dynamic high-shelf cut (de-esser), post-EQ
  private deEssNodes: { hp: BiquadFilterNode; abs: WaveShaperNode; lp: BiquadFilterNode; shaper: WaveShaperNode } | null = null
  private readonly gateSource!: AudioNode // signal feeding the gate (for detection)
  private readonly deEssSource!: AudioNode // signal feeding the de-esser (for detection)
  private readonly comp: DynamicsCompressorNode
  private readonly makeup: GainNode
  private readonly duckGain: GainNode
  private duckNodes: { source: AudioNode; abs: WaveShaperNode; lp: BiquadFilterNode; scale: GainNode } | null = null
  private readonly pan: StereoPannerNode | GainNode
  private readonly volume: GainNode
  private readonly muteGain: GainNode
  private readonly sendA: GainNode
  private readonly sendB: GainNode
  private readonly analyser: AnalyserNode
  private readonly meterBuf: Float32Array<ArrayBuffer>
  private outDest: AudioNode // where muteGain currently routes (master or a bus input)
  private data: TrackData

  constructor(ctx: BaseAudioContext, data: TrackData, master: AudioNode, samples: SampleStore, buses: SendBuses) {
    this.ctx = ctx
    this.data = data
    this.kind = data.kind
    this.input = ctx.createGain()

    this.gateGain = ctx.createGain()
    this.gateGain.gain.value = 1
    // fixed pool of biquads; unused slots run transparent (peaking, 0 dB)
    this.eqBands = Array.from({ length: MAX_EQ_BANDS }, () => {
      const b = ctx.createBiquadFilter()
      b.type = 'peaking'
      b.frequency.value = 1000
      b.gain.value = 0
      b.Q.value = 1
      return b
    })
    this.deEss = ctx.createBiquadFilter()
    this.deEss.type = 'highshelf'
    this.deEss.frequency.value = 6500
    this.deEss.gain.value = 0

    this.comp = ctx.createDynamicsCompressor()
    this.comp.knee.value = 8
    this.makeup = ctx.createGain()
    this.duckGain = ctx.createGain()

    this.pan =
      typeof (ctx as AudioContext).createStereoPanner === 'function'
        ? ctx.createStereoPanner()
        : ctx.createGain()
    this.volume = ctx.createGain()
    this.muteGain = ctx.createGain()
    this.sendA = ctx.createGain()
    this.sendA.gain.value = 0
    this.sendB = ctx.createGain()
    this.sendB.gain.value = 0
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.meterBuf = new Float32Array(this.analyser.fftSize)

    if (data.kind === 'synth') {
      this.store = new Store()
      this.store.loadPatch(data.patch)
      this.engine = new Engine(ctx, this.store, this.input)
      this.instr = null
      this.fxChain = null // the synth engine has its own rack inside
      this.ready = this.engine.ready
    } else {
      // non-synth tracks reuse the synth patch's FX section as their insert
      // rack: same Store + FxChain + rack UI, zero new schema
      this.store = new Store()
      this.store.loadPatch(data.patch)
      this.engine = null
      if (data.kind === 'drums') {
        this.instr = new DrumMachine(ctx, () => this.data.drums)
      } else if (data.kind === 'sampler') {
        this.instr = new SamplerInstrument(ctx, () => this.data.sampler, samples)
      } else if (data.kind === 'pads') {
        this.instr = new PadsInstrument(ctx, () => this.data.pads, samples)
      } else {
        this.instr = null // audio tracks have no triggered instrument
      }
      this.instr?.output.connect(this.input)
      this.fxChain = new FxChain(ctx, this.store.getPatch())
      this.ready = this.fxChain.ready
      this.store.subscribeAll((value, path) => {
        const t = this.ctx.currentTime
        const chain = this.fxChain
        if (!chain) return
        if (path === '*') {
          chain.applyAll(this.store!.getPatch(), t)
          return
        }
        if (!path.startsWith('fx.')) return
        const [, id, key] = path.split('.')
        if (key === 'on') chain.setEnabled(id as FxId, value as boolean)
        else if (key !== 'order' && typeof value === 'number') chain.apply(id as FxId, key, value, t)
      })
    }

    if (this.fxChain) {
      this.input.connect(this.fxChain.input)
      this.fxChain.output.connect(this.gateGain)
    } else {
      this.input.connect(this.gateGain)
    }
    this.gateSource = this.fxChain ? this.fxChain.output : this.input
    this.gateGain.connect(this.eqBands[0])
    for (let i = 0; i < this.eqBands.length - 1; i++) this.eqBands[i].connect(this.eqBands[i + 1])
    const lastEq = this.eqBands[this.eqBands.length - 1]
    this.deEssSource = lastEq
    lastEq.connect(this.deEss)
    this.deEss.connect(this.comp)
    this.comp.connect(this.makeup)
    this.makeup.connect(this.duckGain)
    this.duckGain.connect(this.pan)
    this.pan.connect(this.volume)
    this.volume.connect(this.muteGain)
    this.muteGain.connect(master)
    this.outDest = master
    this.muteGain.connect(this.sendA)
    this.muteGain.connect(this.sendB)
    this.sendA.connect(buses.a)
    this.sendB.connect(buses.b)
    this.muteGain.connect(this.analyser)
    this.applyMixer(data.mixer, false)
  }

  // point the channel at the current TrackData object (undo/redo replaces it)
  rebind(data: TrackData): void {
    this.data = data
  }

  // re-route this channel's post-fader output to a new destination (master bus
  // or a group bus's input). Sends/meter taps are untouched.
  routeTo(dest: AudioNode): void {
    if (dest === this.outDest) return
    try {
      this.muteGain.disconnect(this.outDest)
    } catch {
      // edge already gone (e.g. previous dest was disposed)
    }
    this.muteGain.connect(dest)
    this.outDest = dest
  }

  trackData(): TrackData {
    return this.data
  }

  // the AudioParam an automation target drives (null = unsupported here, e.g.
  // pan when StereoPanner is unavailable). Automation is ABSOLUTE: it owns the
  // param while points exist, and applyMixer skips automated targets.
  paramForTarget(target: AutoTarget): AudioParam | null {
    switch (target) {
      case 'volume': return this.volume.gain
      case 'pan': return 'pan' in this.pan ? this.pan.pan : null
      case 'sendA': return this.sendA.gain
      case 'sendB': return this.sendB.gain
      case 'eqLow': return this.eqBands[0].gain
      case 'eqMid': return this.eqBands[1].gain
      case 'eqHigh': return this.eqBands[2].gain
      default: return null
    }
  }

  // cancel any booked automation ramps from `at` onward (stop/seek/wrap); the
  // next pump slice rebooks, or applyAutomationStatic pins them when stopped.
  cancelAutomation(at?: number): void {
    const t = at ?? this.ctx.currentTime
    for (const target of AUTOMATABLE) {
      this.paramForTarget(target)?.cancelScheduledValues(t)
    }
  }

  // pin automated params to their curve value at `beat` (used when stopped so
  // the mix reflects the cursor position).
  applyAutomationStatic(beat: number): void {
    const t = this.ctx.currentTime
    for (const target of AUTOMATABLE) {
      const points = this.data.auto[target]
      const param = this.paramForTarget(target)
      if (!points || points.length === 0 || !param) continue
      param.cancelScheduledValues(t)
      param.setValueAtTime(autoValueAt(points, beat, param.value), t)
    }
  }

  // FFT magnitude (dB) of this channel's output, length = frequencyBinCount.
  // Used by the EQ editor's spectrum backdrop.
  spectrum(out: Float32Array<ArrayBuffer>): void {
    this.analyser.getFloatFrequencyData(out)
  }

  get spectrumBins(): number {
    return this.analyser.frequencyBinCount
  }

  get sampleRate(): number {
    return this.ctx.sampleRate
  }

  // instantaneous output peak, 0..1+ (post-fader, post-mute)
  meterPeak(): number {
    this.analyser.getFloatTimeDomainData(this.meterBuf)
    let peak = 0
    for (let i = 0; i < this.meterBuf.length; i++) {
      const a = Math.abs(this.meterBuf[i])
      if (a > peak) peak = a
    }
    return peak
  }

  noteOn(pitch: number, vel: number, at?: number): void {
    if (this.engine) this.engine.noteOn(pitch, at, vel)
    else this.instr?.noteOn(pitch, vel, at ?? this.ctx.currentTime)
  }

  noteOff(pitch: number, at?: number): void {
    if (this.engine) this.engine.noteOff(pitch, at)
    else this.instr?.noteOff(pitch, at ?? this.ctx.currentTime)
  }

  allNotesOff(): void {
    this.engine?.allNotesOff()
    this.instr?.allNotesOff()
  }

  setBend(semitones: number): void {
    this.engine?.setBend(semitones)
    this.instr?.setBend(semitones)
  }

  // Sidechain: an envelope follower on `source` (another track's
  // post-instrument signal) modulates this channel's duck gain downward.
  // |x| → lowpass → negative gain into duckGain.gain (base 1).
  setDuck(source: AudioNode | null, amount: number): void {
    const t = this.ctx.currentTime
    if (!source || amount <= 0.001) {
      if (this.duckNodes) {
        this.duckNodes.source.disconnect(this.duckNodes.abs)
        this.duckNodes.abs.disconnect()
        this.duckNodes.lp.disconnect()
        this.duckNodes.scale.disconnect()
        this.duckNodes = null
        this.duckGain.gain.cancelScheduledValues(t)
        this.duckGain.gain.setTargetAtTime(1, t, 0.02)
      }
      return
    }
    if (this.duckNodes && this.duckNodes.source === source) {
      this.duckNodes.scale.gain.setTargetAtTime(-amount * 1.4, t, 0.02)
      return
    }
    this.setDuck(null, 0) // tear down any previous wiring
    const abs = this.ctx.createWaveShaper()
    const curve = new Float32Array(257)
    for (let i = 0; i < 257; i++) curve[i] = Math.abs(i / 128 - 1)
    abs.curve = curve
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 12 // pump speed
    const scale = this.ctx.createGain()
    scale.gain.value = -amount * 1.4
    source.connect(abs)
    abs.connect(lp)
    lp.connect(scale)
    scale.connect(this.duckGain.gain)
    this.duckGain.gain.setValueAtTime(1, t)
    this.duckNodes = { source, abs, lp, scale }
  }

  // Noise gate: an envelope follower on the pre-EQ signal drives gateGain.gain
  // through a threshold-shaping curve (closed below threshold, open above).
  setGate(gate: TrackData['mixer']['gate']): void {
    const t = this.ctx.currentTime
    if (!gate.on) {
      if (this.gateNodes) {
        this.gateNodes.shaper.disconnect()
        this.gateNodes.lp.disconnect()
        this.gateNodes.abs.disconnect()
        try {
          this.gateSource.disconnect(this.gateNodes.abs)
        } catch {
          // already disconnected
        }
        this.gateNodes = null
      }
      this.gateGain.gain.cancelScheduledValues(t)
      this.gateGain.gain.setTargetAtTime(1, t, 0.01)
      return
    }
    if (!this.gateNodes) {
      const abs = this.ctx.createWaveShaper()
      const curve = new Float32Array(257)
      for (let i = 0; i < 257; i++) curve[i] = Math.abs(i / 128 - 1)
      abs.curve = curve
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 40 // gate attack/release speed
      const shaper = this.ctx.createWaveShaper()
      this.gateSource.connect(abs)
      abs.connect(lp)
      lp.connect(shaper)
      this.gateGain.gain.setValueAtTime(0, t) // gain is fully control-driven
      shaper.connect(this.gateGain.gain)
      this.gateNodes = { abs, lp, shaper }
    }
    this.gateNodes.shaper.curve = gateCurve(gate.threshold, gate.floor)
    this.gateGain.gain.setValueAtTime(0, t)
  }

  // De-esser: an envelope follower on the high band pushes the de-ess high-shelf
  // gain negative when sibilance is loud (a dynamic high cut).
  setDeEss(de: TrackData['mixer']['deEss']): void {
    const t = this.ctx.currentTime
    if (!de.on || de.amount <= 0.001) {
      if (this.deEssNodes) {
        this.deEssNodes.shaper.disconnect()
        this.deEssNodes.lp.disconnect()
        this.deEssNodes.abs.disconnect()
        this.deEssNodes.hp.disconnect()
        try {
          this.deEssSource.disconnect(this.deEssNodes.hp)
        } catch {
          // already disconnected
        }
        this.deEssNodes = null
      }
      this.deEss.gain.cancelScheduledValues(t)
      this.deEss.gain.setTargetAtTime(0, t, 0.02)
      return
    }
    if (!this.deEssNodes) {
      const hp = this.ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.Q.value = 0.9
      const abs = this.ctx.createWaveShaper()
      const curve = new Float32Array(257)
      for (let i = 0; i < 257; i++) curve[i] = Math.abs(i / 128 - 1)
      abs.curve = curve
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 30
      // maps high-band envelope → a bounded shelf cut in dB (calibrated, capped)
      const shaper = this.ctx.createWaveShaper()
      this.deEssSource.connect(hp)
      hp.connect(abs)
      abs.connect(lp)
      lp.connect(shaper)
      this.deEss.gain.setValueAtTime(0, t)
      shaper.connect(this.deEss.gain)
      this.deEssNodes = { hp, abs, lp, shaper }
    }
    this.deEssNodes.hp.frequency.setTargetAtTime(de.freq, t, 0.02)
    this.deEss.frequency.setTargetAtTime(de.freq, t, 0.02)
    this.deEssNodes.shaper.curve = deEssCurve(de.amount)
  }

  // is this target currently owned by automation? (then applyMixer leaves it)
  private automated(target: AutoTarget): boolean {
    const pts = this.data.auto[target]
    return !!pts && pts.length > 0
  }

  // configure the biquad pool from the band list. Slots 0..2 expose gain to
  // automation (eqLow/eqMid/eqHigh) so applyMixer leaves those gains alone when
  // automated. Unused/off slots run transparent (peaking, 0 dB).
  private applyEq(bands: EqBand[], t: number): void {
    for (let i = 0; i < this.eqBands.length; i++) {
      const node = this.eqBands[i]
      const band = bands[i]
      if (band && band.on) {
        node.type = band.type
        node.frequency.setTargetAtTime(Math.min(20000, Math.max(20, band.freq)), t, 0.02)
        node.Q.setTargetAtTime(band.q, t, 0.02)
        const automated = i < EQ_SLOT_TARGETS.length && this.automated(EQ_SLOT_TARGETS[i])
        if (!automated) node.gain.setTargetAtTime(eqUsesGain(band.type) ? band.gain : 0, t, 0.02)
      } else {
        const automated = i < EQ_SLOT_TARGETS.length && this.automated(EQ_SLOT_TARGETS[i])
        if (!automated) {
          node.type = 'peaking'
          node.gain.setTargetAtTime(0, t, 0.02)
        }
      }
    }
  }

  applyMixer(mixer: TrackData['mixer'], soloElsewhere: boolean): void {
    const t = this.ctx.currentTime
    if (!this.automated('volume')) this.volume.gain.setTargetAtTime(mixer.volume, t, 0.02)
    if ('pan' in this.pan && !this.automated('pan')) {
      this.pan.pan.setTargetAtTime(mixer.pan, t, 0.02)
    }
    this.applyEq(mixer.eq, t)
    if (mixer.comp.on) {
      this.comp.threshold.setTargetAtTime(mixer.comp.threshold, t, 0.02)
      this.comp.ratio.setTargetAtTime(mixer.comp.ratio, t, 0.02)
      this.comp.attack.setTargetAtTime(mixer.comp.attack, t, 0.02)
      this.comp.release.setTargetAtTime(mixer.comp.release, t, 0.02)
      this.makeup.gain.setTargetAtTime(mixer.comp.makeup, t, 0.02)
    } else {
      // transparent: nothing crosses a 0 dB threshold at ratio 1, no knee
      this.comp.threshold.setTargetAtTime(0, t, 0.02)
      this.comp.ratio.setTargetAtTime(1, t, 0.02)
      this.comp.knee.setTargetAtTime(0, t, 0.02)
      this.makeup.gain.setTargetAtTime(1, t, 0.02)
    }
    if (mixer.comp.on) this.comp.knee.setTargetAtTime(8, t, 0.02)
    this.setGate(mixer.gate)
    this.setDeEss(mixer.deEss)
    if (!this.automated('sendA')) this.sendA.gain.setTargetAtTime(mixer.sendA, t, 0.02)
    if (!this.automated('sendB')) this.sendB.gain.setTargetAtTime(mixer.sendB, t, 0.02)
    const audible = !mixer.mute && (!soloElsewhere || mixer.solo)
    this.muteGain.gain.setTargetAtTime(audible ? 1 : 0, t, 0.01)
    if (!audible) this.allNotesOff()
  }

  dispose(): void {
    this.allNotesOff()
    this.engine?.masterGain.disconnect()
    this.instr?.dispose()
    this.setDuck(null, 0)
    this.setGate({ on: false, threshold: 0, floor: 0 })
    this.setDeEss({ on: false, amount: 0, freq: 6500 })
    const nodes: (AudioNode | null)[] = [this.input, this.fxChain?.input ?? null, this.fxChain?.output ?? null, this.gateGain, ...this.eqBands, this.deEss, this.comp, this.makeup, this.duckGain, this.pan, this.volume, this.muteGain, this.sendA, this.sendB, this.analyser]
    for (const n of nodes) n?.disconnect()
  }
}

export class SongEngine {
  readonly ctx: BaseAudioContext
  readonly masterGain: GainNode
  readonly ready: Promise<void>
  readonly samples: SampleStore
  private readonly channels = new Map<string, TrackChannel>()
  private readonly buses: SendBuses
  private readonly masterAnalyser: AnalyserNode
  private readonly masterMeterBuf: Float32Array<ArrayBuffer>
  private readonly kAnalyser: AnalyserNode
  private readonly kBuf: Float32Array<ArrayBuffer>
  private lufsEma = 1e-7

  constructor(ctx: BaseAudioContext, dest?: AudioNode, samples: SampleStore = sampleStore) {
    this.ctx = ctx
    this.samples = samples
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 4
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = 0.9
    limiter.connect(this.masterGain)
    this.masterGain.connect(dest ?? ctx.destination)
    this.limiterIn = limiter

    this.masterAnalyser = ctx.createAnalyser()
    this.masterAnalyser.fftSize = 512
    this.masterMeterBuf = new Float32Array(this.masterAnalyser.fftSize)
    this.masterGain.connect(this.masterAnalyser)

    // momentary loudness (LUFS-ish): K-weight the master (highpass + high-shelf
    // approximating ITU BS.1770), then mean-square with a ~400ms integrator.
    const kHp = ctx.createBiquadFilter()
    kHp.type = 'highpass'
    kHp.frequency.value = 38
    kHp.Q.value = 0.5
    const kShelf = ctx.createBiquadFilter()
    kShelf.type = 'highshelf'
    kShelf.frequency.value = 1500
    kShelf.gain.value = 4
    this.masterGain.connect(kHp)
    kHp.connect(kShelf)
    this.kAnalyser = ctx.createAnalyser()
    this.kAnalyser.fftSize = 1024
    kShelf.connect(this.kAnalyser)
    this.kBuf = new Float32Array(this.kAnalyser.fftSize)

    // send bus A: plate-ish generated reverb
    const busA = ctx.createGain()
    const verb = ctx.createConvolver()
    verb.buffer = makeImpulse(ctx, 2.6, 0.6)
    const verbOut = ctx.createGain()
    verbOut.gain.value = 0.9
    busA.connect(verb)
    verb.connect(verbOut)
    verbOut.connect(limiter)

    // send bus B: dark feedback delay
    const busB = ctx.createGain()
    const delay = ctx.createDelay(2)
    delay.delayTime.value = 0.32
    const fb = ctx.createGain()
    fb.gain.value = 0.38
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 4200
    busB.connect(delay)
    delay.connect(damp)
    damp.connect(fb)
    fb.connect(delay)
    damp.connect(limiter)

    this.buses = { a: busA, b: busB }
    this.ready = Promise.resolve()
  }

  private readonly limiterIn: DynamicsCompressorNode

  masterPeak(): number {
    this.masterAnalyser.getFloatTimeDomainData(this.masterMeterBuf)
    let peak = 0
    for (let i = 0; i < this.masterMeterBuf.length; i++) {
      const a = Math.abs(this.masterMeterBuf[i])
      if (a > peak) peak = a
    }
    return peak
  }

  // momentary loudness in LUFS (approximate). Call ~once per animation frame;
  // an EMA gives the ~400ms integration window. Returns -70 when silent.
  masterLufs(): number {
    this.kAnalyser.getFloatTimeDomainData(this.kBuf)
    let ms = 0
    for (let i = 0; i < this.kBuf.length; i++) ms += this.kBuf[i] * this.kBuf[i]
    ms /= this.kBuf.length
    this.lufsEma = this.lufsEma * 0.94 + ms * 0.06
    if (this.lufsEma < 1e-7) return -70
    return -0.691 + 10 * Math.log10(this.lufsEma)
  }

  // Create/dispose channels so the graph matches the track list; existing
  // same-kind channels are kept (live knob state survives) and rebound to the
  // current TrackData object.
  syncTracks(project: Project): Promise<void> {
    const seen = new Set<string>()
    for (const data of project.tracks) {
      seen.add(data.id)
      const existing = this.channels.get(data.id)
      if (existing && existing.kind === data.kind) {
        existing.rebind(data)
      } else {
        existing?.dispose()
        const ch = new TrackChannel(this.ctx, data, this.limiterIn, this.samples, this.buses)
        this.channels.set(data.id, ch)
      }
    }
    for (const [id, ch] of this.channels) {
      if (!seen.has(id)) {
        ch.dispose()
        this.channels.delete(id)
      }
    }
    this.applyMixers(project)
    // only live channels' readiness matters; collecting per call keeps this
    // from accumulating promises across repeated syncs (undo/redo)
    return Promise.all([...this.channels.values()].map(ch => ch.ready)).then(() => {})
  }

  applyMixers(project: Project): void {
    const soloActive = project.tracks.some(t => t.mixer.solo)
    for (const data of project.tracks) {
      this.channels.get(data.id)?.applyMixer(data.mixer, soloActive && !data.mixer.solo)
    }
    // sidechain wiring (after all channels exist)
    for (const data of project.tracks) {
      const ch = this.channels.get(data.id)
      if (!ch) continue
      const srcId = data.mixer.duck.source
      const srcCh = srcId && srcId !== data.id ? this.channels.get(srcId) : undefined
      ch.setDuck(srcCh ? srcCh.input : null, data.mixer.duck.amount)
    }
    this.applyRouting(project)
  }

  // Route each channel's output to master or its target group bus. A routing
  // that would form a cycle (bus feeding back into itself) falls back to master.
  private applyRouting(project: Project): void {
    const byId = new Map(project.tracks.map(t => [t.id, t]))
    for (const data of project.tracks) {
      const ch = this.channels.get(data.id)
      if (ch) ch.routeTo(this.resolveOutput(data, byId))
    }
  }

  private resolveOutput(data: TrackData, byId: Map<string, TrackData>): AudioNode {
    const targetId = data.mixer.output
    if (!targetId || targetId === 'master') return this.limiterIn
    const targetCh = this.channels.get(targetId)
    if (!targetCh || targetCh.kind !== 'bus') return this.limiterIn
    // walk the bus chain; if it returns to this track, it's a cycle → master
    const visited = new Set<string>([data.id])
    let cur: string | undefined = targetId
    while (cur && cur !== 'master') {
      if (visited.has(cur)) return this.limiterIn
      visited.add(cur)
      cur = byId.get(cur)?.mixer.output
    }
    return targetCh.input
  }

  channel(trackId: string): TrackChannel | undefined {
    return this.channels.get(trackId)
  }

  // ---------- automation ----------

  automationParam(trackId: string, target: AutoTarget): AudioParam | null {
    return this.channels.get(trackId)?.paramForTarget(target) ?? null
  }

  // cancel future ramps on every channel (stop/seek/wrap)
  cancelAutomation(at?: number): void {
    for (const ch of this.channels.values()) ch.cancelAutomation(at)
  }

  // pin automated params to their value at `beat` (stopped/seek-while-stopped)
  applyAutomationStatic(beat: number): void {
    for (const ch of this.channels.values()) ch.applyAutomationStatic(beat)
  }

  store(trackId: string): Store | undefined {
    return this.channels.get(trackId)?.store ?? undefined
  }

  noteOn(trackId: string, pitch: number, vel: number, at?: number): void {
    this.channels.get(trackId)?.noteOn(pitch, vel, at)
  }

  noteOff(trackId: string, pitch: number, at?: number): void {
    this.channels.get(trackId)?.noteOff(pitch, at)
  }

  allNotesOff(): void {
    for (const ch of this.channels.values()) ch.allNotesOff()
  }

  // ---------- audio clip playback ----------

  private readonly liveAudio = new Set<AudioBufferSourceNode>()
  // stretched buffers cached by sample + factor (heavy to compute once)
  private readonly stretchCache = new Map<string, AudioBuffer>()

  // offset/dur arrive in SOURCE seconds with `rate` = source-sec per wall-sec.
  // repitch plays the source at playbackRate=rate (pitch moves); stretch plays
  // a pre-stretched buffer at rate 1 (pitch preserved).
  playClip(trackId: string, region: AudioRegion, t: number, offsetSec: number, durSec: number, rate = 1, fadeInSec = 0, fadeOutSec = 0): void {
    const ch = this.channels.get(trackId)
    if (!ch || durSec <= 0.001) return

    let buffer = this.samples.get(region.sampleId)
    if (!buffer) return
    let off = offsetSec
    let dur = durSec
    let playbackRate = rate

    if (region.warp === 'stretch' && Math.abs(rate - 1) > 1e-4) {
      const factor = 1 / rate // output length relative to source
      const stretched = this.getStretched(region.sampleId, factor)
      if (stretched) {
        buffer = stretched
        off = offsetSec * factor // map source-sec → stretched-sec
        dur = durSec * factor
        playbackRate = 1 // pitch preserved
      }
    }

    off = Math.min(Math.max(0, off), buffer.duration)
    dur = Math.min(dur, buffer.duration - off)
    if (dur <= 0.001) return
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    if (playbackRate !== 1) src.playbackRate.value = playbackRate
    const g = this.ctx.createGain()
    // fade envelope in wall-clock time (fades are defined in song beats)
    const wall = dur / playbackRate
    const fi = Math.min(fadeInSec, wall / 2)
    const fo = Math.min(fadeOutSec, wall / 2)
    if (fi > 0) {
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(region.gain, t + fi)
    } else {
      g.gain.setValueAtTime(region.gain, t)
    }
    if (fo > 0) {
      g.gain.setValueAtTime(region.gain, t + wall - fo)
      g.gain.linearRampToValueAtTime(0, t + wall)
    }
    src.connect(g)
    g.connect(ch.input)
    src.start(t, off, dur)
    this.liveAudio.add(src)
    src.onended = () => {
      this.liveAudio.delete(src)
      src.disconnect()
      g.disconnect()
    }
  }

  private getStretched(sampleId: string, factor: number): AudioBuffer | null {
    const source = this.samples.get(sampleId)
    if (!source) return null
    const key = `${sampleId}:${factor.toFixed(3)}`
    let buf = this.stretchCache.get(key)
    if (!buf) {
      const ch0 = timeStretch(source.getChannelData(0), factor)
      buf = new AudioBuffer({ length: ch0.length, numberOfChannels: source.numberOfChannels, sampleRate: source.sampleRate })
      buf.copyToChannel(ch0, 0)
      for (let c = 1; c < source.numberOfChannels; c++) {
        buf.copyToChannel(timeStretch(source.getChannelData(c), factor), c)
      }
      this.stretchCache.set(key, buf)
    }
    return buf
  }

  stopAudioClips(at?: number): void {
    const t = at ?? this.ctx.currentTime
    for (const src of [...this.liveAudio]) {
      try {
        src.stop(t)
      } catch {
        // not started / already stopped
      }
    }
  }

  // Pull live synth patches back into the project (called before save/serialize).
  // Drum/sampler editors mutate the project objects directly, so only synth
  // stores need collecting.
  collectPatches(project: Project): void {
    for (const data of project.tracks) {
      const store = this.channels.get(data.id)?.store
      if (store) data.patch = structuredClone(store.getPatch())
    }
  }
}
