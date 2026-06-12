// Synthesized drum machine: classic analog recipes (pitch-swept sines for
// kick/toms, filtered noise for snare/clap/hats, detuned square stacks for
// metallic voices). Every hit builds its own small node graph into `output`
// and self-disposes; there is no voice state to manage. Two kit flavors
// tweak the recipes (808 = deep/boomy, 909 = punchy/bright).

import type { DrumPatch, DrumVoiceParams } from '../project'
import type { Instrument } from './types'

export type DrumId =
  | 'kick' | 'rim' | 'snare' | 'clap' | 'tomlo' | 'hatc' | 'tommid'
  | 'hato' | 'tomhi' | 'crash' | 'ride' | 'cowbell' | 'shaker' | 'clave'

// GM-flavored pitch map (matches DRUM_NAMES in the piano roll)
export const DRUM_PITCHES: Record<number, DrumId> = {
  36: 'kick',
  37: 'rim',
  38: 'snare',
  39: 'clap',
  41: 'tomlo',
  42: 'hatc',
  45: 'tommid',
  46: 'hato',
  48: 'tomhi',
  49: 'crash',
  51: 'ride',
  56: 'cowbell',
  70: 'shaker',
  75: 'clave',
}

export const DRUM_ORDER: { id: DrumId; pitch: number; label: string }[] = [
  { id: 'kick', pitch: 36, label: 'Kick' },
  { id: 'snare', pitch: 38, label: 'Snare' },
  { id: 'clap', pitch: 39, label: 'Clap' },
  { id: 'hatc', pitch: 42, label: 'Hat Closed' },
  { id: 'hato', pitch: 46, label: 'Hat Open' },
  { id: 'tomlo', pitch: 41, label: 'Tom Lo' },
  { id: 'tommid', pitch: 45, label: 'Tom Mid' },
  { id: 'tomhi', pitch: 48, label: 'Tom Hi' },
  { id: 'crash', pitch: 49, label: 'Crash' },
  { id: 'ride', pitch: 51, label: 'Ride' },
  { id: 'rim', pitch: 37, label: 'Rimshot' },
  { id: 'cowbell', pitch: 56, label: 'Cowbell' },
  { id: 'shaker', pitch: 70, label: 'Shaker' },
  { id: 'clave', pitch: 75, label: 'Clave' },
]

const MAPPED = Object.keys(DRUM_PITCHES).map(Number).sort((a, b) => a - b)

// Any pitch becomes the nearest mapped drum so live keyboard play always sounds.
export function pitchToDrum(pitch: number): DrumId {
  let best = MAPPED[0]
  for (const p of MAPPED) {
    if (Math.abs(p - pitch) < Math.abs(best - pitch)) best = p
  }
  return DRUM_PITCHES[best]
}

const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21]

function fullParams(patch: DrumPatch, id: DrumId): Required<DrumVoiceParams> {
  const o = patch.drums[id] ?? {}
  return { level: o.level ?? 1, tune: o.tune ?? 0, decay: o.decay ?? 1 }
}

export class DrumMachine implements Instrument {
  readonly output: GainNode
  private readonly ctx: BaseAudioContext
  private readonly getPatch: () => DrumPatch
  private noiseBuf: AudioBuffer | null = null
  private openHatEnv: GainNode | null = null

  constructor(ctx: BaseAudioContext, getPatch: () => DrumPatch) {
    this.ctx = ctx
    this.getPatch = getPatch
    this.output = ctx.createGain()
  }

  noteOn(pitch: number, vel: number, t: number): void {
    const patch = this.getPatch()
    const id = pitchToDrum(pitch)
    const p = fullParams(patch, id)
    const amp = patch.level * p.level * (0.35 + 0.65 * vel)
    const r = Math.pow(2, p.tune / 12)
    const d = p.decay
    const is909 = patch.kit === '909'

    switch (id) {
      case 'kick': this.kick(t, amp, r, d, is909); break
      case 'snare': this.snare(t, amp, r, d, is909); break
      case 'clap': this.clap(t, amp, r, d); break
      case 'hatc': this.hat(t, amp * 0.8, r, 0.03 * d, is909); this.chokeOpenHat(t); break
      case 'hato': this.openHatEnv = this.hat(t, amp * 0.7, r, 0.3 * d, is909); break
      case 'tomlo': this.tom(t, amp, 85 * r, d); break
      case 'tommid': this.tom(t, amp, 130 * r, d); break
      case 'tomhi': this.tom(t, amp, 185 * r, d); break
      case 'crash': this.cymbal(t, amp * 0.6, r, 1.1 * d, 4800); break
      case 'ride': this.cymbal(t, amp * 0.45, r, 0.55 * d, 6200); break
      case 'rim': this.rim(t, amp, r); break
      case 'cowbell': this.cowbell(t, amp * 0.7, r, d); break
      case 'shaker': this.bpNoise(t, amp * 0.7, 6500, 2.5, 0.05 * d); break
      case 'clave': this.ping(t, amp * 0.8, 2500 * r, 0.03 * d); break
    }
  }

  noteOff(): void {
    // one-shots; nothing to release
  }

  allNotesOff(): void {
    // one-shots ring out naturally
  }

  setBend(): void {
    // not meaningful for drums
  }

  dispose(): void {
    this.output.disconnect()
  }

  // ---------- building blocks ----------

  private noise(): AudioBuffer {
    if (!this.noiseBuf) {
      const len = Math.floor(this.ctx.sampleRate * 1.2)
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    return this.noiseBuf
  }

  // gain node with an exponential decay from `peak`, auto-cleanup at `end`
  private env(t: number, peak: number, tau: number): { node: GainNode; end: number } {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(peak, t)
    g.gain.setTargetAtTime(0, t, tau)
    g.connect(this.output)
    return { node: g, end: t + tau * 7 + 0.05 }
  }

  private oscInto(dest: AudioNode, type: OscillatorType, freq: number, t: number, stop: number): OscillatorNode {
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    osc.connect(dest)
    osc.start(t)
    osc.stop(stop)
    osc.onended = () => {
      osc.disconnect()
      dest.disconnect()
    }
    return osc
  }

  private noiseInto(node: AudioNode, t: number, stop: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise()
    src.loop = true
    src.connect(node)
    src.start(t)
    src.stop(stop)
    src.onended = () => src.disconnect()
    return src
  }

  // ---------- voices ----------

  private kick(t: number, amp: number, r: number, d: number, is909: boolean): void {
    const tau = (is909 ? 0.13 : 0.22) * d
    const { node, end } = this.env(t, amp * 1.1, tau)
    const osc = this.oscInto(node, 'sine', (is909 ? 190 : 160) * r, t, end)
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, (is909 ? 55 : 42) * r), t + 0.09)
    // attack click
    const click = this.ctx.createBiquadFilter()
    click.type = 'highpass'
    click.frequency.value = is909 ? 900 : 500
    const { node: cEnv, end: cEnd } = this.env(t, amp * (is909 ? 0.5 : 0.3), 0.008)
    click.connect(cEnv)
    this.noiseInto(click, t, cEnd)
  }

  private snare(t: number, amp: number, r: number, d: number, is909: boolean): void {
    const { node: toneEnv, end: toneEnd } = this.env(t, amp * 0.55, 0.055 * d)
    const tone = this.oscInto(toneEnv, 'triangle', 185 * r, t, toneEnd)
    tone.frequency.exponentialRampToValueAtTime(Math.max(60, 140 * r), t + 0.04)
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'highpass'
    bp.frequency.value = is909 ? 700 : 450
    const { node: nEnv, end: nEnd } = this.env(t, amp * (is909 ? 0.95 : 0.8), (is909 ? 0.12 : 0.1) * d)
    bp.connect(nEnv)
    this.noiseInto(bp, t, nEnd)
  }

  private clap(t: number, amp: number, _r: number, d: number): void {
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1100
    bp.Q.value = 1.4
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    // three retriggered bursts then a tail
    for (const [dt, lvl] of [[0, 0.9], [0.011, 0.75], [0.022, 0.6]] as const) {
      g.gain.setValueAtTime(amp * lvl, t + dt)
      g.gain.setTargetAtTime(0.0001, t + dt, 0.008)
    }
    g.gain.setValueAtTime(amp * 0.85, t + 0.033)
    g.gain.setTargetAtTime(0, t + 0.033, 0.075 * d)
    bp.connect(g)
    g.connect(this.output)
    const end = t + 0.033 + 0.075 * d * 7
    this.noiseInto(bp, t, end)
    setTimeoutDisconnect(g, this.ctx, end)
  }

  private hat(t: number, amp: number, r: number, tau: number, is909: boolean): GainNode {
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = is909 ? 7800 : 7000
    const { node, end } = this.env(t, amp, tau)
    hp.connect(node)
    for (const ratio of METAL_RATIOS) {
      const osc = this.ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(40 * ratio * r * (is909 ? 1.18 : 1), t)
      osc.connect(hp)
      osc.start(t)
      osc.stop(end)
      osc.onended = () => osc.disconnect()
    }
    setTimeoutDisconnect(hp, this.ctx, end)
    return node
  }

  private chokeOpenHat(t: number): void {
    if (this.openHatEnv) {
      this.openHatEnv.gain.cancelScheduledValues(t)
      this.openHatEnv.gain.setTargetAtTime(0, t, 0.008)
      this.openHatEnv = null
    }
  }

  private tom(t: number, amp: number, f0: number, d: number): void {
    const { node, end } = this.env(t, amp * 0.9, 0.2 * d)
    const osc = this.oscInto(node, 'sine', f0 * 1.8, t, end)
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f0), t + 0.08)
  }

  private cymbal(t: number, amp: number, r: number, tau: number, hpFreq: number): void {
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = hpFreq
    const { node, end } = this.env(t, amp, tau)
    hp.connect(node)
    this.noiseInto(hp, t, end)
    for (const ratio of METAL_RATIOS) {
      const osc = this.ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(60 * ratio * r, t)
      osc.connect(hp)
      osc.start(t)
      osc.stop(end)
      osc.onended = () => osc.disconnect()
    }
    setTimeoutDisconnect(hp, this.ctx, end)
  }

  private rim(t: number, amp: number, r: number): void {
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1700 * r
    bp.Q.value = 3
    const { node, end } = this.env(t, amp * 1.2, 0.012)
    bp.connect(node)
    this.oscInto(bp, 'square', 1100 * r, t, end)
    setTimeoutDisconnect(node, this.ctx, end)
  }

  private cowbell(t: number, amp: number, r: number, d: number): void {
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 800 * r
    bp.Q.value = 1.2
    const { node, end } = this.env(t, amp, 0.12 * d)
    bp.connect(node)
    for (const f of [540, 800]) {
      const osc = this.ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(f * r, t)
      osc.connect(bp)
      osc.start(t)
      osc.stop(end)
      osc.onended = () => osc.disconnect()
    }
    setTimeoutDisconnect(bp, this.ctx, end)
  }

  private bpNoise(t: number, amp: number, freq: number, q: number, tau: number): void {
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    bp.Q.value = q
    const { node, end } = this.env(t, amp, tau)
    bp.connect(node)
    this.noiseInto(bp, t, end)
    setTimeoutDisconnect(bp, this.ctx, end)
  }

  private ping(t: number, amp: number, freq: number, tau: number): void {
    const { node, end } = this.env(t, amp, tau)
    this.oscInto(node, 'sine', freq, t, end)
  }
}

// Filters between source and env have no onended of their own; disconnect them
// once the hit has fully decayed. Offline contexts ignore this (no timers run),
// which is fine — the whole graph is discarded after rendering.
function setTimeoutDisconnect(node: AudioNode, ctx: BaseAudioContext, end: number): void {
  if (typeof window === 'undefined' || !(ctx instanceof AudioContext)) return
  const ms = Math.max(0, (end - ctx.currentTime) * 1000 + 200)
  setTimeout(() => node.disconnect(), ms)
}
