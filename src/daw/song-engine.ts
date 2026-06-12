// Multi-track audio graph: one full synth Engine per track, each feeding a
// channel strip (pan → volume → mute) into the shared master bus.

import { Engine } from '../engine/engine'
import { Store } from '../state/store'
import type { Project, TrackData } from './project'

class TrackChannel {
  readonly store: Store
  readonly engine: Engine
  private readonly pan: StereoPannerNode | GainNode
  private readonly volume: GainNode
  private readonly muteGain: GainNode

  constructor(ctx: BaseAudioContext, data: TrackData, master: AudioNode) {
    this.store = new Store()
    this.store.loadPatch(data.patch)
    this.pan =
      typeof (ctx as AudioContext).createStereoPanner === 'function'
        ? ctx.createStereoPanner()
        : ctx.createGain()
    this.volume = ctx.createGain()
    this.muteGain = ctx.createGain()
    this.engine = new Engine(ctx, this.store, this.pan)
    this.pan.connect(this.volume)
    this.volume.connect(this.muteGain)
    this.muteGain.connect(master)
    this.applyMixer(data.mixer, false)
  }

  setBend(semitones: number): void {
    this.engine.setBend(semitones)
  }

  applyMixer(mixer: TrackData['mixer'], soloElsewhere: boolean): void {
    const t = this.engine.ctx.currentTime
    this.volume.gain.setTargetAtTime(mixer.volume, t, 0.02)
    if ('pan' in this.pan) {
      this.pan.pan.setTargetAtTime(mixer.pan, t, 0.02)
    }
    const audible = !mixer.mute && (!soloElsewhere || mixer.solo)
    this.muteGain.gain.setTargetAtTime(audible ? 1 : 0, t, 0.01)
    if (!audible) this.engine.allNotesOff()
  }

  dispose(): void {
    this.engine.allNotesOff()
    this.engine.masterGain.disconnect()
    this.pan.disconnect()
    this.volume.disconnect()
    this.muteGain.disconnect()
  }
}

export class SongEngine {
  readonly ctx: BaseAudioContext
  readonly masterGain: GainNode
  readonly ready: Promise<void>
  private readonly channels = new Map<string, TrackChannel>()
  private readyList: Promise<void>[] = []

  constructor(ctx: BaseAudioContext, dest?: AudioNode) {
    this.ctx = ctx
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
  // channels keep their live store (knob tweaks survive track edits).
  syncTracks(project: Project): Promise<void> {
    const seen = new Set<string>()
    for (const data of project.tracks) {
      seen.add(data.id)
      if (!this.channels.has(data.id)) {
        const ch = new TrackChannel(this.ctx, data, this.limiterIn)
        this.channels.set(data.id, ch)
        this.readyList.push(ch.engine.ready)
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
    return this.channels.get(trackId)?.store
  }

  noteOn(trackId: string, pitch: number, vel: number, at?: number): void {
    this.channels.get(trackId)?.engine.noteOn(pitch, at, vel)
  }

  noteOff(trackId: string, pitch: number, at?: number): void {
    this.channels.get(trackId)?.engine.noteOff(pitch, at)
  }

  allNotesOff(): void {
    for (const ch of this.channels.values()) ch.engine.allNotesOff()
  }

  // Pull live patches back into the project (called before save/serialize).
  collectPatches(project: Project): void {
    for (const data of project.tracks) {
      const store = this.channels.get(data.id)?.store
      if (store) data.patch = structuredClone(store.getPatch())
    }
  }
}
