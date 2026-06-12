// Multi-track audio graph. Each track gets a channel whose instrument depends
// on the track kind (synth Engine / drum machine / sampler / none for audio
// clips), feeding a channel strip (pan → volume → mute) into the shared
// master bus. Channels rebind to fresh TrackData objects on every sync so
// undo/redo (which replaces the project object) keeps working graphs.

import { Engine } from '../engine/engine'
import { Store } from '../state/store'
import { DrumMachine } from './instruments/drums'
import { SamplerInstrument } from './instruments/sampler'
import type { Instrument } from './instruments/types'
import type { Project, TrackData, TrackKind } from './project'
import { sampleStore, type SampleStore } from './samples'

export class TrackChannel {
  readonly kind: TrackKind
  readonly input: GainNode // audio-clip sources (P4) and instruments both feed this
  readonly store: Store | null
  readonly engine: Engine | null
  readonly ready: Promise<void>
  private readonly instr: Instrument | null
  private readonly ctx: BaseAudioContext
  private readonly pan: StereoPannerNode | GainNode
  private readonly volume: GainNode
  private readonly muteGain: GainNode
  private data: TrackData

  constructor(ctx: BaseAudioContext, data: TrackData, master: AudioNode, samples: SampleStore) {
    this.ctx = ctx
    this.data = data
    this.kind = data.kind
    this.input = ctx.createGain()
    this.pan =
      typeof (ctx as AudioContext).createStereoPanner === 'function'
        ? ctx.createStereoPanner()
        : ctx.createGain()
    this.volume = ctx.createGain()
    this.muteGain = ctx.createGain()

    if (data.kind === 'synth') {
      this.store = new Store()
      this.store.loadPatch(data.patch)
      this.engine = new Engine(ctx, this.store, this.input)
      this.instr = null
      this.ready = this.engine.ready
    } else {
      this.store = null
      this.engine = null
      if (data.kind === 'drums') {
        this.instr = new DrumMachine(ctx, () => this.data.drums)
      } else if (data.kind === 'sampler') {
        this.instr = new SamplerInstrument(ctx, () => this.data.sampler, samples)
      } else {
        this.instr = null // audio tracks have no triggered instrument
      }
      this.instr?.output.connect(this.input)
      this.ready = Promise.resolve()
    }

    this.input.connect(this.pan)
    this.pan.connect(this.volume)
    this.volume.connect(this.muteGain)
    this.muteGain.connect(master)
    this.applyMixer(data.mixer, false)
  }

  // point the channel at the current TrackData object (undo/redo replaces it)
  rebind(data: TrackData): void {
    this.data = data
  }

  trackData(): TrackData {
    return this.data
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

  applyMixer(mixer: TrackData['mixer'], soloElsewhere: boolean): void {
    const t = this.ctx.currentTime
    this.volume.gain.setTargetAtTime(mixer.volume, t, 0.02)
    if ('pan' in this.pan) {
      this.pan.pan.setTargetAtTime(mixer.pan, t, 0.02)
    }
    const audible = !mixer.mute && (!soloElsewhere || mixer.solo)
    this.muteGain.gain.setTargetAtTime(audible ? 1 : 0, t, 0.01)
    if (!audible) this.allNotesOff()
  }

  dispose(): void {
    this.allNotesOff()
    this.engine?.masterGain.disconnect()
    this.instr?.dispose()
    this.input.disconnect()
    this.pan.disconnect()
    this.volume.disconnect()
    this.muteGain.disconnect()
  }
}

export class SongEngine {
  readonly ctx: BaseAudioContext
  readonly masterGain: GainNode
  readonly ready: Promise<void>
  readonly samples: SampleStore
  private readonly channels = new Map<string, TrackChannel>()
  private readyList: Promise<void>[] = []

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
    this.ready = Promise.resolve()
  }

  private readonly limiterIn: DynamicsCompressorNode

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
        const ch = new TrackChannel(this.ctx, data, this.limiterIn, this.samples)
        this.channels.set(data.id, ch)
        this.readyList.push(ch.ready)
      }
    }
    for (const [id, ch] of this.channels) {
      if (!seen.has(id)) {
        ch.dispose()
        this.channels.delete(id)
      }
    }
    this.applyMixers(project)
    return Promise.all(this.readyList).then(() => {})
  }

  applyMixers(project: Project): void {
    const soloActive = project.tracks.some(t => t.mixer.solo)
    for (const data of project.tracks) {
      this.channels.get(data.id)?.applyMixer(data.mixer, soloActive && !data.mixer.solo)
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
