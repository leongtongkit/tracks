import type { Store } from '../state/store'
import { chooseSlot, NoteStack, type SlotInfo } from './allocator'
import { Voice } from './voice'

const MAX_VOICES = 10

// Owns the voice pool and the master bus. The FX chain (Phase 3) slots in
// between voiceBus and masterGain.
export class Engine {
  readonly ctx: BaseAudioContext
  readonly voiceBus: GainNode
  readonly masterGain: GainNode

  private readonly store: Store
  private readonly voices: Voice[] = []
  private readonly stack = new NoteStack()
  private readonly slotInfo: SlotInfo[] = []

  constructor(ctx: BaseAudioContext, store: Store) {
    this.ctx = ctx
    this.store = store
    this.voiceBus = ctx.createGain()
    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = store.getPatch().master.gain
    this.voiceBus.connect(this.masterGain)
    this.masterGain.connect(ctx.destination)

    for (let i = 0; i < MAX_VOICES; i++) {
      this.voices.push(new Voice())
      this.slotInfo.push({ state: 'free', note: -1, startTime: 0, releaseEnd: 0 })
    }

    store.subscribeAll((value, path) => this.onParamChange(value, path))
  }

  noteOn(note: number): void {
    const patch = this.store.getPatch()
    const t = this.ctx.currentTime

    if (patch.voice.mode !== 'poly') {
      const sounding = this.voices[0].state === 'active'
      this.stack.push(note)
      if (sounding) {
        const retrigger = patch.voice.mode === 'mono'
        this.voices[0].glideTo(patch, note, patch.voice.glide, t, retrigger)
      } else {
        this.voices[0].noteOn(this.ctx, this.voiceBus, patch, note, t)
      }
      return
    }

    const idx = this.pickSlot(note, t)
    const voice = this.voices[idx]
    if (voice.state === 'active' || (voice.state === 'releasing' && !voice.isReclaimable(t))) {
      voice.steal(t)
    }
    voice.noteOn(this.ctx, this.voiceBus, patch, note, t)
  }

  noteOff(note: number): void {
    const patch = this.store.getPatch()
    const t = this.ctx.currentTime

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
      // whole-patch load: kill sounding notes, apply master level
      this.allNotesOff()
      this.masterGain.gain.setTargetAtTime(this.store.getPatch().master.gain, t, 0.02)
      return
    }
    if (
      path === 'filter.cutoff' ||
      path === 'filter.resonance' ||
      path === 'filter.type' ||
      (path.startsWith('osc.') && path.endsWith('.level'))
    ) {
      for (const voice of this.voices) {
        voice.applyParam(path, value as number | string, t)
      }
    }
    // Everything else (waves, envelopes, tuning, mode) applies on the next note.
  }
}
