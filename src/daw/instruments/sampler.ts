// Sampler: plays one loaded sample chromatically. Repitching is plain
// playback-rate scaling (2^(semitones/12)) — the classic sampler sound.
// Polyphonic; each noteOn builds a source + envelope pair.

import type { SamplerPatch } from '../project'
import type { SampleStore } from '../samples'
import type { Instrument } from './types'

interface SamplerVoice {
  src: AudioBufferSourceNode
  env: GainNode
  pitch: number
  baseRate: number
}

export class SamplerInstrument implements Instrument {
  readonly output: GainNode
  private readonly ctx: BaseAudioContext
  private readonly getPatch: () => SamplerPatch
  private readonly samples: SampleStore
  private readonly voices: SamplerVoice[] = []
  private bendSemi = 0

  constructor(ctx: BaseAudioContext, getPatch: () => SamplerPatch, samples: SampleStore) {
    this.ctx = ctx
    this.getPatch = getPatch
    this.samples = samples
    this.output = ctx.createGain()
  }

  noteOn(pitch: number, vel: number, t: number): void {
    const patch = this.getPatch()
    const buffer = patch.sampleId ? this.samples.get(patch.sampleId) : undefined
    if (!buffer) return

    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = patch.loop
    const baseRate = Math.pow(2, (pitch - patch.root) / 12)
    src.playbackRate.setValueAtTime(baseRate * Math.pow(2, this.bendSemi / 12), t)

    const env = this.ctx.createGain()
    const peak = patch.gain * (0.3 + 0.7 * vel)
    if (patch.attack > 0.002) {
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(peak, t + patch.attack)
    } else {
      env.gain.setValueAtTime(peak, t)
    }

    src.connect(env)
    env.connect(this.output)
    src.start(t)

    const voice: SamplerVoice = { src, env, pitch, baseRate }
    this.voices.push(voice)
    src.onended = () => {
      src.disconnect()
      env.disconnect()
      const i = this.voices.indexOf(voice)
      if (i !== -1) this.voices.splice(i, 1)
    }
  }

  noteOff(pitch: number, t: number): void {
    const release = Math.max(0.005, this.getPatch().release)
    for (const v of this.voices) {
      if (v.pitch !== pitch) continue
      v.env.gain.cancelScheduledValues(t)
      v.env.gain.setTargetAtTime(0, t, release / 3)
      try {
        v.src.stop(t + release * 3 + 0.05)
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
    for (const v of this.voices) {
      v.src.playbackRate.setTargetAtTime(v.baseRate * factor, t, 0.01)
    }
  }

  dispose(): void {
    this.allNotesOff()
    this.output.disconnect()
  }
}
