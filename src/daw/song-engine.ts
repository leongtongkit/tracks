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
import { DrumMachine } from './instruments/drums'
import { PadsInstrument } from './instruments/pads'
import { SamplerInstrument } from './instruments/sampler'
import type { Instrument } from './instruments/types'
import type { AudioRegion, Project, TrackData, TrackKind } from './project'
import { sampleStore, type SampleStore } from './samples'

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
  private readonly eqLow: BiquadFilterNode
  private readonly eqMid: BiquadFilterNode
  private readonly eqHigh: BiquadFilterNode
  private readonly comp: DynamicsCompressorNode
  private readonly makeup: GainNode
  private readonly duckGain: GainNode
  private duckNodes: { source: AudioNode; abs: WaveShaperNode; lp: BiquadFilterNode; scale: GainNode } | null = null
  private readonly pan: StereoPannerNode | GainNode
  private readonly autoPan: StereoPannerNode | null
  private readonly volume: GainNode
  private readonly autoVol: GainNode
  private readonly muteGain: GainNode
  private readonly sendA: GainNode
  private readonly sendB: GainNode
  private readonly analyser: AnalyserNode
  private readonly meterBuf: Float32Array<ArrayBuffer>
  private data: TrackData

  constructor(ctx: BaseAudioContext, data: TrackData, master: AudioNode, samples: SampleStore, buses: SendBuses) {
    this.ctx = ctx
    this.data = data
    this.kind = data.kind
    this.input = ctx.createGain()

    this.eqLow = ctx.createBiquadFilter()
    this.eqLow.type = 'lowshelf'
    this.eqLow.frequency.value = 130
    this.eqMid = ctx.createBiquadFilter()
    this.eqMid.type = 'peaking'
    this.eqMid.frequency.value = 1000
    this.eqMid.Q.value = 0.9
    this.eqHigh = ctx.createBiquadFilter()
    this.eqHigh.type = 'highshelf'
    this.eqHigh.frequency.value = 6000

    this.comp = ctx.createDynamicsCompressor()
    this.comp.knee.value = 8
    this.makeup = ctx.createGain()
    this.duckGain = ctx.createGain()

    this.pan =
      typeof (ctx as AudioContext).createStereoPanner === 'function'
        ? ctx.createStereoPanner()
        : ctx.createGain()
    this.autoPan =
      typeof (ctx as AudioContext).createStereoPanner === 'function' ? ctx.createStereoPanner() : null
    this.volume = ctx.createGain()
    this.autoVol = ctx.createGain()
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
      this.fxChain.output.connect(this.eqLow)
    } else {
      this.input.connect(this.eqLow)
    }
    this.eqLow.connect(this.eqMid)
    this.eqMid.connect(this.eqHigh)
    this.eqHigh.connect(this.comp)
    this.comp.connect(this.makeup)
    this.makeup.connect(this.duckGain)
    this.duckGain.connect(this.pan)
    if (this.autoPan) {
      this.pan.connect(this.autoPan)
      this.autoPan.connect(this.volume)
    } else {
      this.pan.connect(this.volume)
    }
    this.volume.connect(this.autoVol)
    this.autoVol.connect(this.muteGain)
    this.muteGain.connect(master)
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

  trackData(): TrackData {
    return this.data
  }

  // automation targets (volume rides the fader as a 0..1 multiplier)
  autoVolParam(): AudioParam {
    return this.autoVol.gain
  }

  autoPanParam(): AudioParam | null {
    return this.autoPan?.pan ?? null
  }

  // clear booked automation and return to neutral (stop/seek/wrap)
  resetAutomation(at?: number): void {
    const t = at ?? this.ctx.currentTime
    this.autoVol.gain.cancelScheduledValues(t)
    this.autoVol.gain.setValueAtTime(1, t)
    if (this.autoPan) {
      this.autoPan.pan.cancelScheduledValues(t)
      this.autoPan.pan.setValueAtTime(0, t)
    }
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

  applyMixer(mixer: TrackData['mixer'], soloElsewhere: boolean): void {
    const t = this.ctx.currentTime
    this.volume.gain.setTargetAtTime(mixer.volume, t, 0.02)
    if ('pan' in this.pan) {
      this.pan.pan.setTargetAtTime(mixer.pan, t, 0.02)
    }
    this.eqLow.gain.setTargetAtTime(mixer.eq.low, t, 0.02)
    this.eqMid.gain.setTargetAtTime(mixer.eq.mid, t, 0.02)
    this.eqHigh.gain.setTargetAtTime(mixer.eq.high, t, 0.02)
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
    this.sendA.gain.setTargetAtTime(mixer.sendA, t, 0.02)
    this.sendB.gain.setTargetAtTime(mixer.sendB, t, 0.02)
    const audible = !mixer.mute && (!soloElsewhere || mixer.solo)
    this.muteGain.gain.setTargetAtTime(audible ? 1 : 0, t, 0.01)
    if (!audible) this.allNotesOff()
  }

  dispose(): void {
    this.allNotesOff()
    this.engine?.masterGain.disconnect()
    this.instr?.dispose()
    this.setDuck(null, 0)
    const nodes: (AudioNode | null)[] = [this.input, this.fxChain?.input ?? null, this.fxChain?.output ?? null, this.eqLow, this.eqMid, this.eqHigh, this.comp, this.makeup, this.duckGain, this.pan, this.autoPan, this.volume, this.autoVol, this.muteGain, this.sendA, this.sendB, this.analyser]
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
  }

  channel(trackId: string): TrackChannel | undefined {
    return this.channels.get(trackId)
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

  playClip(trackId: string, region: AudioRegion, t: number, offsetSec: number, durSec: number, rate = 1): void {
    const buffer = this.samples.get(region.sampleId)
    const ch = this.channels.get(trackId)
    if (!buffer || !ch || durSec <= 0.001) return
    const off = Math.min(Math.max(0, offsetSec), buffer.duration)
    const dur = Math.min(durSec, buffer.duration - off)
    if (dur <= 0.001) return
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    if (rate !== 1) src.playbackRate.value = rate
    const g = this.ctx.createGain()
    g.gain.value = region.gain
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
