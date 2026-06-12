import type { FxId } from '../patch/schema'
import type { Store } from '../state/store'
import { chooseSlot, NoteStack, type SlotInfo } from './allocator'
import { FxChain } from './fx/chain'
import { LfoBank } from './lfo'
import { Voice, type VoiceMods } from './voice'

const MAX_VOICES = 10

// Owns the voice pool and the master bus:
// voices → voiceBus → tremolo (LFO amp) → FX chain → limiter → masterGain → out
export class Engine {
  readonly ctx: BaseAudioContext
  readonly voiceBus: GainNode
  readonly masterGain: GainNode
  readonly ready: Promise<void>

  private readonly store: Store
  private readonly voices: Voice[] = []
  private readonly stack = new NoteStack()
  private readonly slotInfo: SlotInfo[] = []
  private readonly lfoBank: LfoBank
  private readonly fxChain: FxChain
  private readonly mods: VoiceMods
  private bendCents = 0

  constructor(ctx: BaseAudioContext, store: Store, dest?: AudioNode) {
    this.ctx = ctx
    this.store = store
    const patch = store.getPatch()

    this.voiceBus = ctx.createGain()
    this.lfoBank = new LfoBank(ctx, patch)
    this.fxChain = new FxChain(ctx, patch)
    this.ready = this.fxChain.ready

    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -9
    limiter.knee.value = 6
    limiter.ratio.value = 16
    limiter.attack.value = 0.002
    limiter.release.value = 0.2

    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = patch.master.gain

    this.voiceBus.connect(this.lfoBank.tremolo)
    this.lfoBank.tremolo.connect(this.fxChain.input)
    this.fxChain.output.connect(limiter)
    limiter.connect(this.masterGain)
    this.masterGain.connect(dest ?? ctx.destination)

    this.mods = {
      pitch: this.lfoBank.pitchSources(),
      filter: this.lfoBank.filterSources(),
    }

    for (let i = 0; i < MAX_VOICES; i++) {
      this.voices.push(new Voice())
      this.slotInfo.push({ state: 'free', note: -1, startTime: 0, releaseEnd: 0 })
    }

    store.subscribeAll((value, path) => this.onParamChange(value, path))
  }

  noteOn(note: number, at?: number, velocity = 1): void {
    const patch = this.store.getPatch()
    const t = at ?? this.ctx.currentTime

    if (patch.voice.mode !== 'poly') {
      const sounding = this.voices[0].state === 'active'
      this.stack.push(note)
      if (sounding) {
        const retrigger = patch.voice.mode === 'mono'
        this.voices[0].glideTo(patch, note, patch.voice.glide, t, retrigger)
      } else {
        this.voices[0].noteOn(this.ctx, this.voiceBus, patch, note, t, this.mods, velocity)
      }
      if (this.bendCents !== 0) this.voices[0].setBend(this.bendCents, t)
      return
    }

    const idx = this.pickSlot(note, t)
    const voice = this.voices[idx]
    if (voice.state === 'active' || (voice.state === 'releasing' && !voice.isReclaimable(t))) {
      voice.steal(t)
    }
    voice.noteOn(this.ctx, this.voiceBus, patch, note, t, this.mods, velocity)
    if (this.bendCents !== 0) voice.setBend(this.bendCents, t)
  }

  noteOff(note: number, at?: number): void {
    const patch = this.store.getPatch()
    const t = at ?? this.ctx.currentTime

    if (patch.voice.mode !== 'poly') {
      this.stack.remove(note)
      const voice = this.voices[0]
      if (voice.state !== 'active' || voice.note !== note) return
      const fallback = this.stack.top()
      if (fallback !== null) {
        voice.glideTo(patch, fallback, patch.voice.glide, t, patch.voice.mode === 'mono')
      } else {
        voice.noteOff(patch, t)
      }
      return
    }

    for (const voice of this.voices) {
      if (voice.state === 'active' && voice.note === note) {
        voice.noteOff(patch, t)
      }
    }
  }

  // Pitch bend in semitones; affects sounding voices and future notes until reset.
  setBend(semitones: number): void {
    this.bendCents = semitones * 100
    const t = this.ctx.currentTime
    for (const voice of this.voices) {
      if (voice.state !== 'free') voice.setBend(this.bendCents, t)
    }
  }

  allNotesOff(): void {
    const patch = this.store.getPatch()
    const t = this.ctx.currentTime
    this.stack.clear()
    for (const voice of this.voices) {
      if (voice.state === 'active') voice.noteOff(patch, t)
    }
  }

  activeVoiceCount(): number {
    let n = 0
    for (const voice of this.voices) {
      if (voice.state === 'active') n++
    }
    return n
  }

  private pickSlot(note: number, now: number): number {
    const max = Math.min(MAX_VOICES, this.store.getPatch().voice.maxVoices)
    for (let i = 0; i < max; i++) {
      const v = this.voices[i]
      const s = this.slotInfo[i]
      s.state = v.isReclaimable(now) ? 'free' : v.state
      s.note = v.note
      s.startTime = v.startTime
      s.releaseEnd = v.releaseEnd
    }
    return chooseSlot(this.slotInfo.slice(0, max), note, now)
  }

  private onParamChange(value: number | string | boolean, path: string): void {
    const t = this.ctx.currentTime
    if (path === 'master.gain') {
      this.masterGain.gain.setTargetAtTime(value as number, t, 0.02)
      return
    }
    if (path === '*') {
      // whole-patch load: kill sounding notes, re-apply the whole engine state
      this.allNotesOff()
      const patch = this.store.getPatch()
      this.masterGain.gain.setTargetAtTime(patch.master.gain, t, 0.02)
      this.lfoBank.applyAll(patch, t)
      this.fxChain.applyAll(patch, t)
      return
    }
    if (path === 'voice.mode') {
      // switching poly/mono mid-performance: end every sounding note so no
      // poly voice is left unreachable by the mono noteOff path
      this.allNotesOff()
      return
    }
    if (path.startsWith('lfo.')) {
      this.lfoBank.apply(path, value as number | string, t)
      return
    }
    if (path.startsWith('fx.')) {
      const [, id, key] = path.split('.')
      if (key === 'on') {
        this.fxChain.setEnabled(id as FxId, value as boolean)
      } else if (key === 'order') {
        // handled on whole-patch load; live reorder UI calls setOrder directly
      } else if (typeof value === 'number') {
        this.fxChain.apply(id as FxId, key, value, t)
      }
      return
    }
    if (
      path === 'filter.cutoff' ||
      path === 'filter.resonance' ||
      path === 'filter.type' ||
      path === 'fm.depth' ||
      path === 'fm.ratio' ||
      (path.startsWith('osc.') && path.endsWith('.level'))
    ) {
      for (const voice of this.voices) {
        voice.applyParam(path, value as number | string, t)
      }
    }
    // Everything else (waves, envelopes, tuning, mode) applies on the next note.
  }
}
