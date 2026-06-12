// Sampled pad bank: 16 pads on MIDI 36..51 (MPC-style), each with its own
// sample, gain, and tune. One-shot pads play the whole sample regardless of
// noteOff; gated pads stop on release.

import { PAD_BASE_PITCH, PAD_COUNT, type PadsPatch } from '../project'
import type { SampleStore } from '../samples'
import type { Instrument } from './types'

interface PadVoice {
  src: AudioBufferSourceNode
  env: GainNode
  pad: number
  oneshot: boolean
}

export function padIndexOf(pitch: number): number {
  return (((pitch - PAD_BASE_PITCH) % PAD_COUNT) + PAD_COUNT) % PAD_COUNT
}

export class PadsInstrument implements Instrument {
  readonly output: GainNode
  private readonly ctx: BaseAudioContext
  private readonly getPatch: () => PadsPatch
  private readonly samples: SampleStore
  private readonly voices: PadVoice[] = []

  constructor(ctx: BaseAudioContext, getPatch: () => PadsPatch, samples: SampleStore) {
    this.ctx = ctx
    this.getPatch = getPatch
    this.samples = samples
    this.output = ctx.createGain()
  }

  noteOn(pitch: number, vel: number, t: number): void {
    const idx = padIndexOf(pitch)
    const pad = this.getPatch().pads[idx]
    const buffer = pad?.sampleId ? this.samples.get(pad.sampleId) : undefined
    if (!pad || !buffer) return

    // retrigger: choke the previous hit of the same pad
    for (const v of this.voices) {
      if (v.pad === idx) {
        v.env.gain.cancelScheduledValues(t)
        v.env.gain.setTargetAtTime(0, t, 0.006)
        try {
          v.src.stop(t + 0.05)
        } catch {
          // already stopped
        }
      }
    }

    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = Math.pow(2, pad.tune / 12)
    const env = this.ctx.createGain()
    env.gain.setValueAtTime(pad.gain * (0.35 + 0.65 * vel), t)
    src.connect(env)
    env.connect(this.output)
    src.start(t)

    const voice: PadVoice = { src, env, pad: idx, oneshot: pad.oneshot }
    this.voices.push(voice)
    src.onended = () => {
      src.disconnect()
      env.disconnect()
      const i = this.voices.indexOf(voice)
      if (i !== -1) this.voices.splice(i, 1)
    }
  }

  noteOff(pitch: number, t: number): void {
    const idx = padIndexOf(pitch)
    for (const v of this.voices) {
      if (v.pad !== idx || v.oneshot) continue
      v.env.gain.cancelScheduledValues(t)
      v.env.gain.setTargetAtTime(0, t, 0.02)
      try {
        v.src.stop(t + 0.15)
      } catch {
        // already stopped
      }
    }
  }

  allNotesOff(): void {
    const t = this.ctx.currentTime
    for (const v of [...this.voices]) {
      if (v.oneshot) continue // let one-shots ring like drums
      v.env.gain.setTargetAtTime(0, t, 0.01)
      try {
        v.src.stop(t + 0.1)
      } catch {
        // already stopped
      }
    }
  }

  setBend(): void {
    // pads are fixed-pitch
  }

  dispose(): void {
    for (const v of [...this.voices]) {
      try {
        v.src.stop()
      } catch {
        // already stopped
      }
    }
    this.output.disconnect()
  }
}
