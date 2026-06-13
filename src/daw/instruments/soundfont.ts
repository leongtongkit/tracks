// SoundFont instrument: multisample playback from a parsed .sf2. A note plays
// every preset zone whose key+velocity range contains it, each as an
// AudioBufferSource (repitched from the zone's root key + tuning, looped per the
// sample) through a per-voice volume ADSR and pan. Polyphonic.

import { zonesForNote, type Sf2Sample, type Sf2Zone, type SoundFont } from '../dsp/sf2'
import type { SoundFontPatch } from '../project'
import type { SoundFontStore } from '../soundfont-store'
import type { Instrument } from './types'

interface SfVoice {
  pitch: number
  src: AudioBufferSourceNode
  env: GainNode
  baseRate: number
  release: number
}

export class SoundFontInstrument implements Instrument {
  readonly output: GainNode
  private readonly ctx: BaseAudioContext
  private readonly getPatch: () => SoundFontPatch
  private readonly store: SoundFontStore
  private readonly voices: SfVoice[] = []
  // decoded AudioBuffers per (soundfont id + sample index), built lazily
  private readonly bufCache = new Map<string, AudioBuffer>()
  private bendSemi = 0

  constructor(ctx: BaseAudioContext, getPatch: () => SoundFontPatch, store: SoundFontStore) {
    this.ctx = ctx
    this.getPatch = getPatch
    this.store = store
    this.output = ctx.createGain()
  }

  private soundFont(): SoundFont | null {
    const id = this.getPatch().id
    return id ? this.store.get(id) ?? null : null
  }

  private buffer(id: string, index: number, sample: Sf2Sample): AudioBuffer {
    const key = `${id}:${index}`
    let buf = this.bufCache.get(key)
    if (!buf) {
      buf = new AudioBuffer({ length: Math.max(1, sample.data.length), numberOfChannels: 1, sampleRate: sample.sampleRate })
      buf.copyToChannel(sample.data as Float32Array<ArrayBuffer>, 0)
      this.bufCache.set(key, buf)
    }
    return buf
  }

  noteOn(pitch: number, vel: number, t: number): void {
    const patch = this.getPatch()
    const sf = this.soundFont()
    if (!sf || !patch.id) return
    const preset = sf.presets[patch.presetIndex]
    if (!preset) return

    for (const zone of zonesForNote(preset, pitch, vel)) {
      const sample = sf.samples[zone.sampleIndex]
      if (!sample) continue
      const buf = this.buffer(patch.id, zone.sampleIndex, sample)

      const src = this.ctx.createBufferSource()
      src.buffer = buf
      if (zone.loop && sample.loopEnd > sample.loopStart) {
        src.loop = true
        src.loopStart = sample.loopStart / sample.sampleRate
        src.loopEnd = sample.loopEnd / sample.sampleRate
      }
      // pitch: semitones from root + sample/zone fine tuning (cents)
      const cents = (pitch - zone.rootKey) * 100 + zone.tuneCents + sample.pitchCorrection
      const baseRate = Math.pow(2, cents / 1200)
      src.playbackRate.setValueAtTime(baseRate * Math.pow(2, this.bendSemi / 12), t)

      const env = this.ctx.createGain()
      this.applyEnv(env, zone, vel, t)

      let tail: AudioNode = env
      if (zone.pan !== 0 && typeof (this.ctx as AudioContext).createStereoPanner === 'function') {
        const panner = this.ctx.createStereoPanner()
        panner.pan.value = zone.pan
        env.connect(panner)
        tail = panner
      }
      src.connect(env)
      tail.connect(this.output)
      src.start(t)

      const voice: SfVoice = { pitch, src, env, baseRate, release: zone.release }
      this.voices.push(voice)
      src.onended = () => {
        src.disconnect()
        env.disconnect()
        if (tail !== env) tail.disconnect()
        const i = this.voices.indexOf(voice)
        if (i !== -1) this.voices.splice(i, 1)
      }
    }
  }

  private applyEnv(env: GainNode, zone: Sf2Zone, vel: number, t: number): void {
    const peak = zone.gain * (0.2 + 0.8 * vel)
    const g = env.gain
    g.setValueAtTime(0, t)
    const aEnd = t + Math.max(0.001, zone.attack)
    g.linearRampToValueAtTime(peak, aEnd)
    const hEnd = aEnd + zone.hold
    if (zone.hold > 0) g.setValueAtTime(peak, hEnd)
    if (zone.decay > 0 && zone.sustain < 1) {
      g.setTargetAtTime(peak * zone.sustain, hEnd, zone.decay / 3 + 0.001)
    }
  }

  noteOff(pitch: number, t: number): void {
    for (const v of this.voices) {
      if (v.pitch !== pitch) continue
      const rel = Math.max(0.01, v.release)
      v.env.gain.cancelScheduledValues(t)
      v.env.gain.setTargetAtTime(0, t, rel / 3)
      try {
        v.src.stop(t + rel * 3 + 0.05)
      } catch {
        // already stopped
      }
    }
  }

  allNotesOff(): void {
    const t = this.ctx.currentTime
    for (const v of [...this.voices]) {
      v.env.gain.cancelScheduledValues(t)
      v.env.gain.setTargetAtTime(0, t, 0.01)
      try {
        v.src.stop(t + 0.1)
      } catch {
        // already stopped
      }
    }
  }

  setBend(semitones: number): void {
    this.bendSemi = semitones
    const t = this.ctx.currentTime
    const factor = Math.pow(2, semitones / 12)
    for (const v of this.voices) v.src.playbackRate.setTargetAtTime(v.baseRate * factor, t, 0.01)
  }

  dispose(): void {
    this.allNotesOff()
    this.output.disconnect()
  }
}
