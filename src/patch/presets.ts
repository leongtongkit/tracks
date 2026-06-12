import { INSTRUMENT_PRESETS } from './presets-instruments'
import { migrate, PATCH_VERSION, type Patch, type PatchCategory } from './schema'

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export interface PresetDef {
  name: string
  category: PatchCategory
  patch: DeepPartial<Patch>
}

export function buildPresetPatch(def: PresetDef): Patch {
  return migrate({ v: PATCH_VERSION, name: def.name, category: def.category, ...def.patch })
}

const on = true

// 35 factory presets. Authored against the engine's default patch: only
// deviations from defaults are written; migrate() fills the rest.
export const PRESETS: PresetDef[] = [
  // ---------- BASS ----------
  {
    name: 'Fat Saw',
    category: 'bass',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', octave: -1, fine: -10, level: 0.7, unison: { count: 3, detune: 14, spread: 0.4 } },
        { enabled: on, wave: 'saw', octave: -1, fine: 10, level: 0.7 },
      ],
      filter: { cutoff: 950, resonance: 1.2, envAmount: 0.35 },
      env: { amp: { a: 0.003, d: 0.25, s: 0.6, r: 0.15 }, filter: { a: 0.001, d: 0.18, s: 0.25, r: 0.15 } },
      fx: { distortion: { on, drive: 0.25, tone: 0.45, mix: 0.5 } },
    },
  },
  {
    name: 'Sub Sine',
    category: 'bass',
    patch: {
      osc: [{ enabled: on, wave: 'sine', octave: -2, level: 0.9 }],
      filter: { cutoff: 1500, envAmount: 0 },
      env: { amp: { a: 0.004, d: 0.2, s: 0.85, r: 0.12 } },
    },
  },
  {
    name: 'Acid Line',
    category: 'bass',
    patch: {
      voice: { mode: 'legato', glide: 0.07 },
      osc: [{ enabled: on, wave: 'saw', octave: -1, level: 0.8 }],
      filter: { cutoff: 420, resonance: 11, envAmount: 0.75, keyTrack: 0.5 },
      env: { amp: { a: 0.002, d: 0.3, s: 0.55, r: 0.08 }, filter: { a: 0.001, d: 0.22, s: 0.05, r: 0.1 } },
      fx: { distortion: { on, drive: 0.35, tone: 0.55, mix: 0.45 }, delay: { on, time: 0.19, feedback: 0.3, mix: 0.18 } },
    },
  },
  {
    name: 'Square Growl',
    category: 'bass',
    patch: {
      osc: [
        { enabled: on, wave: 'square', octave: -1, level: 0.65 },
        { enabled: on, wave: 'saw', octave: -1, fine: 8, level: 0.5 },
      ],
      filter: { cutoff: 700, resonance: 2.5, envAmount: 0.45 },
      env: { amp: { a: 0.003, d: 0.3, s: 0.7, r: 0.12 }, filter: { a: 0.002, d: 0.25, s: 0.2, r: 0.12 } },
      fx: { distortion: { on, drive: 0.5, tone: 0.35, mix: 0.6 } },
    },
  },
  {
    name: 'FM Knock',
    category: 'bass',
    patch: {
      osc: [{ enabled: on, wave: 'sine', octave: -1, level: 0.85 }],
      fm: { enabled: on, ratio: 1, depth: 0.5 },
      filter: { cutoff: 2400, envAmount: 0.4 },
      env: { amp: { a: 0.002, d: 0.28, s: 0.5, r: 0.1 }, filter: { a: 0.001, d: 0.12, s: 0.1, r: 0.1 } },
    },
  },

  // ---------- LEAD ----------
  {
    name: 'Screamer',
    category: 'lead',
    patch: {
      voice: { mode: 'legato', glide: 0.05 },
      osc: [
        { enabled: on, wave: 'saw', fine: -8, level: 0.7, unison: { count: 3, detune: 18, spread: 0.5 } },
        { enabled: on, wave: 'square', fine: 8, level: 0.45 },
      ],
      filter: { cutoff: 4800, resonance: 3.5, envAmount: 0.3 },
      env: { amp: { a: 0.004, d: 0.2, s: 0.8, r: 0.25 } },
      fx: { delay: { on, time: 0.32, feedback: 0.35, mix: 0.28 }, distortion: { on, drive: 0.3, tone: 0.7, mix: 0.35 } },
    },
  },
  {
    name: 'Fifth Stack',
    category: 'lead',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', level: 0.7 },
        { enabled: on, wave: 'saw', semi: 7, fine: 6, level: 0.55 },
      ],
      filter: { cutoff: 5200, resonance: 1.5 },
      fx: { phaser: { on, rate: 0.5, depth: 0.5, mix: 0.4 }, delay: { on, time: 0.25, feedback: 0.3, mix: 0.22 } },
    },
  },
  {
    name: 'Chip Square',
    category: 'lead',
    patch: {
      osc: [{ enabled: on, wave: 'square', level: 0.7 }],
      filter: { cutoff: 9000, envAmount: 0 },
      env: { amp: { a: 0.001, d: 0.1, s: 0.65, r: 0.06 } },
      fx: { bitcrusher: { on, bits: 6, downsample: 6, mix: 0.8 }, delay: { on, time: 0.21, feedback: 0.35, mix: 0.25 } },
    },
  },
  {
    name: 'FM Whistle',
    category: 'lead',
    patch: {
      osc: [{ enabled: on, wave: 'sine', octave: 1, level: 0.75 }],
      fm: { enabled: on, ratio: 3, depth: 0.3 },
      env: { amp: { a: 0.03, d: 0.2, s: 0.75, r: 0.3 } },
      fx: { reverb: { on, size: 1.2, decay: 0.4, mix: 0.25 }, chorus: { on, rate: 0.6, depth: 0.3, mix: 0.3 } },
    },
  },
  {
    name: 'Retro Solo',
    category: 'lead',
    patch: {
      voice: { mode: 'mono', glide: 0.04 },
      osc: [
        { enabled: on, wave: 'triangle', level: 0.7 },
        { enabled: on, wave: 'saw', fine: 7, level: 0.4 },
      ],
      filter: { cutoff: 3200, resonance: 2 },
      fx: { chorus: { on, rate: 0.9, depth: 0.45, mix: 0.4 }, delay: { on, time: 0.27, feedback: 0.32, mix: 0.3 } },
    },
  },

  // ---------- PAD ----------
  {
    name: 'Warm Pad',
    category: 'pad',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', fine: -14, level: 0.55, unison: { count: 5, detune: 22, spread: 0.8 } },
        { enabled: on, wave: 'saw', fine: 14, level: 0.55, unison: { count: 3, detune: 16, spread: 0.6 } },
      ],
      filter: { cutoff: 1700, resonance: 0.7, envAmount: 0.15 },
      env: { amp: { a: 0.9, d: 0.5, s: 0.85, r: 1.8 }, filter: { a: 1.2, d: 0.8, s: 0.6, r: 1.5 } },
      fx: { chorus: { on, rate: 0.5, depth: 0.5, mix: 0.45 }, reverb: { on, size: 2.8, decay: 0.65, mix: 0.4 } },
    },
  },
  {
    name: 'Glass Pad',
    category: 'pad',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', level: 0.6 },
        { enabled: on, wave: 'sine', octave: 1, fine: 5, level: 0.45 },
      ],
      filter: { cutoff: 5200, envAmount: 0 },
      env: { amp: { a: 0.7, d: 0.4, s: 0.8, r: 2.2 } },
      lfo: [{}, { rate: 0.18, targets: { filter: 1400 } }],
      fx: { reverb: { on, size: 3.2, decay: 0.75, mix: 0.45 } },
    },
  },
  {
    name: 'Dark Drift',
    category: 'pad',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', octave: -1, level: 0.6 },
        { enabled: on, wave: 'saw', octave: -1, fine: 9, level: 0.5 },
      ],
      filter: { cutoff: 850, resonance: 1.8 },
      env: { amp: { a: 1.4, d: 0.6, s: 0.85, r: 2.5 } },
      lfo: [{}, { rate: 0.12, targets: { filter: 2200 } }],
      fx: { reverb: { on, size: 3.6, decay: 0.8, mix: 0.45 } },
    },
  },
  {
    name: 'Vox Pad',
    category: 'pad',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', fine: -9, level: 0.5 },
        { enabled: on, wave: 'saw', fine: 9, level: 0.5 },
        { enabled: on, wave: 'saw', semi: 12, fine: 4, level: 0.3 },
      ],
      filter: { type: 'bandpass', cutoff: 1250, resonance: 2.2, envAmount: 0.1 },
      env: { amp: { a: 0.8, d: 0.5, s: 0.85, r: 1.6 } },
      fx: { chorus: { on, rate: 0.4, depth: 0.55, mix: 0.5 }, reverb: { on, size: 2.6, decay: 0.6, mix: 0.35 } },
    },
  },
  {
    name: 'Shimmer',
    category: 'pad',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', octave: 1, level: 0.55 },
        { enabled: on, wave: 'sine', octave: 2, fine: 7, level: 0.3 },
      ],
      env: { amp: { a: 1.1, d: 0.4, s: 0.8, r: 2.8 } },
      filter: { cutoff: 7500 },
      fx: { phaser: { on, rate: 0.15, depth: 0.7, mix: 0.45 }, reverb: { on, size: 4, decay: 0.85, mix: 0.5 } },
    },
  },

  // ---------- PLUCK ----------
  {
    name: 'Pop Pluck',
    category: 'pluck',
    patch: {
      osc: [{ enabled: on, wave: 'saw', level: 0.75 }],
      filter: { cutoff: 1100, resonance: 2, envAmount: 0.7 },
      env: { amp: { a: 0.001, d: 0.18, s: 0, r: 0.18 }, filter: { a: 0.001, d: 0.12, s: 0, r: 0.12 } },
      fx: { delay: { on, time: 0.24, feedback: 0.28, mix: 0.22 } },
    },
  },
  {
    name: 'Kalimba',
    category: 'pluck',
    patch: {
      osc: [
        { enabled: on, wave: 'sine', level: 0.7 },
        { enabled: on, wave: 'triangle', octave: 1, level: 0.35 },
      ],
      filter: { cutoff: 4500, envAmount: 0.2, keyTrack: 0.6 },
      env: { amp: { a: 0.001, d: 0.5, s: 0, r: 0.4 }, filter: { a: 0.001, d: 0.2, s: 0, r: 0.2 } },
      fx: { reverb: { on, size: 1.6, decay: 0.45, mix: 0.3 } },
    },
  },
  {
    name: 'FM Pluck',
    category: 'pluck',
    patch: {
      osc: [{ enabled: on, wave: 'sine', level: 0.8 }],
      fm: { enabled: on, ratio: 7, depth: 0.3 },
      env: { amp: { a: 0.001, d: 0.35, s: 0, r: 0.3 }, filter: { a: 0.001, d: 0.15, s: 0, r: 0.15 } },
      filter: { cutoff: 6500, envAmount: 0.3 },
      fx: { delay: { on, time: 0.3, feedback: 0.25, mix: 0.2 }, reverb: { on, size: 1.4, decay: 0.4, mix: 0.22 } },
    },
  },
  {
    name: 'Nylon',
    category: 'pluck',
    patch: {
      osc: [{ enabled: on, wave: 'triangle', level: 0.8 }],
      filter: { cutoff: 2400, resonance: 1, envAmount: 0.4, keyTrack: 0.65 },
      env: { amp: { a: 0.002, d: 0.4, s: 0, r: 0.35 }, filter: { a: 0.001, d: 0.1, s: 0.1, r: 0.2 } },
      fx: { reverb: { on, size: 1.2, decay: 0.35, mix: 0.2 } },
    },
  },

  // ---------- KEYS ----------
  {
    name: 'EP Glow',
    category: 'keys',
    patch: {
      osc: [
        { enabled: on, wave: 'sine', level: 0.7 },
        { enabled: on, wave: 'triangle', octave: 1, level: 0.2 },
      ],
      fm: { enabled: on, ratio: 1, depth: 0.22 },
      env: { amp: { a: 0.003, d: 0.9, s: 0.35, r: 0.5 }, filter: { a: 0.001, d: 0.4, s: 0.3, r: 0.3 } },
      filter: { cutoff: 4200, envAmount: 0.25 },
      fx: { chorus: { on, rate: 0.7, depth: 0.4, mix: 0.4 }, reverb: { on, size: 1.5, decay: 0.4, mix: 0.22 } },
    },
  },
  {
    name: 'Drawbar',
    category: 'keys',
    patch: {
      osc: [
        { enabled: on, wave: 'sine', level: 0.7 },
        { enabled: on, wave: 'sine', octave: 1, level: 0.5 },
        { enabled: on, wave: 'sine', octave: 1, semi: 7, level: 0.3 },
      ],
      filter: { cutoff: 8000, envAmount: 0 },
      env: { amp: { a: 0.004, d: 0.05, s: 1, r: 0.09 } },
      lfo: [{ rate: 6, targets: { amp: 0.12 } }],
      fx: { reverb: { on, size: 1.1, decay: 0.35, mix: 0.18 } },
    },
  },
  {
    name: 'Clav Bite',
    category: 'keys',
    patch: {
      osc: [
        { enabled: on, wave: 'square', level: 0.6 },
        { enabled: on, wave: 'saw', fine: 6, level: 0.45 },
      ],
      filter: { type: 'bandpass', cutoff: 1600, resonance: 3, envAmount: 0.5, keyTrack: 0.5 },
      env: { amp: { a: 0.001, d: 0.4, s: 0.15, r: 0.12 }, filter: { a: 0.001, d: 0.08, s: 0.2, r: 0.08 } },
      fx: { phaser: { on, rate: 0.8, depth: 0.4, mix: 0.3 } },
    },
  },
  {
    name: 'House Stab',
    category: 'keys',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', fine: -10, level: 0.6 },
        { enabled: on, wave: 'saw', fine: 10, level: 0.6 },
        { enabled: on, wave: 'square', octave: -1, level: 0.35 },
      ],
      filter: { cutoff: 2300, resonance: 2, envAmount: 0.45 },
      env: { amp: { a: 0.002, d: 0.35, s: 0.2, r: 0.15 }, filter: { a: 0.001, d: 0.2, s: 0.1, r: 0.15 } },
      fx: { delay: { on, time: 0.375, feedback: 0.3, mix: 0.25 } },
    },
  },

  // ---------- BELL ----------
  {
    name: 'FM Bell',
    category: 'bell',
    patch: {
      osc: [{ enabled: on, wave: 'sine', level: 0.75 }],
      fm: { enabled: on, ratio: 3.5, depth: 0.55 },
      env: { amp: { a: 0.001, d: 1.6, s: 0, r: 1.4 }, filter: { a: 0.001, d: 0.8, s: 0, r: 0.8 } },
      filter: { cutoff: 9000, envAmount: 0.2 },
      fx: { reverb: { on, size: 2.4, decay: 0.6, mix: 0.35 } },
    },
  },
  {
    name: 'Glass Bell',
    category: 'bell',
    patch: {
      osc: [
        { enabled: on, wave: 'sine', octave: 1, level: 0.6 },
        { enabled: on, wave: 'sine', octave: 2, semi: 7, level: 0.3 },
      ],
      env: { amp: { a: 0.001, d: 1.2, s: 0, r: 1.2 } },
      filter: { cutoff: 12000 },
      fx: { delay: { on, time: 0.4, feedback: 0.35, mix: 0.25 }, reverb: { on, size: 2.2, decay: 0.55, mix: 0.3 } },
    },
  },
  {
    name: 'Toy Box',
    category: 'bell',
    patch: {
      osc: [{ enabled: on, wave: 'triangle', octave: 2, level: 0.65 }],
      env: { amp: { a: 0.001, d: 0.6, s: 0, r: 0.5 } },
      filter: { cutoff: 10000, keyTrack: 0.4 },
      fx: { delay: { on, time: 0.28, feedback: 0.4, mix: 0.3 }, reverb: { on, size: 1.3, decay: 0.4, mix: 0.25 } },
    },
  },

  // ---------- BRASS ----------
  {
    name: 'Synth Brass',
    category: 'brass',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', fine: -8, level: 0.65 },
        { enabled: on, wave: 'saw', fine: 8, level: 0.65 },
      ],
      filter: { cutoff: 1250, resonance: 1.2, envAmount: 0.5 },
      env: { amp: { a: 0.045, d: 0.25, s: 0.8, r: 0.25 }, filter: { a: 0.07, d: 0.3, s: 0.5, r: 0.25 } },
      fx: { chorus: { on, rate: 0.5, depth: 0.3, mix: 0.3 } },
    },
  },
  {
    name: 'Stab Brass',
    category: 'brass',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', level: 0.7 },
        { enabled: on, wave: 'saw', octave: -1, fine: 6, level: 0.5 },
      ],
      filter: { cutoff: 1500, envAmount: 0.6 },
      env: { amp: { a: 0.01, d: 0.3, s: 0.4, r: 0.18 }, filter: { a: 0.005, d: 0.18, s: 0.2, r: 0.15 } },
      fx: { distortion: { on, drive: 0.2, tone: 0.6, mix: 0.3 } },
    },
  },
  {
    name: 'Soft Horn',
    category: 'brass',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', level: 0.7 },
        { enabled: on, wave: 'saw', level: 0.25 },
      ],
      filter: { cutoff: 1000, envAmount: 0.3 },
      env: { amp: { a: 0.09, d: 0.3, s: 0.8, r: 0.35 }, filter: { a: 0.12, d: 0.4, s: 0.5, r: 0.3 } },
      fx: { reverb: { on, size: 1.8, decay: 0.5, mix: 0.28 } },
    },
  },

  // ---------- WOBBLE ----------
  {
    name: 'Dub Wob',
    category: 'wobble',
    patch: {
      voice: { mode: 'mono', glide: 0.03 },
      osc: [
        { enabled: on, wave: 'saw', octave: -1, level: 0.7 },
        { enabled: on, wave: 'square', octave: -1, fine: 7, level: 0.5 },
      ],
      filter: { cutoff: 480, resonance: 6, envAmount: 0.2 },
      lfo: [{ rate: 0.9, targets: { filter: 3400 } }],
      env: { amp: { a: 0.004, d: 0.2, s: 0.9, r: 0.12 } },
      fx: { distortion: { on, drive: 0.4, tone: 0.4, mix: 0.5 } },
    },
  },
  {
    name: 'Talk Wob',
    category: 'wobble',
    patch: {
      voice: { mode: 'mono' },
      osc: [{ enabled: on, wave: 'saw', octave: -1, level: 0.8 }],
      filter: { type: 'bandpass', cutoff: 780, resonance: 7, envAmount: 0 },
      lfo: [{ rate: 2.2, wave: 'triangle', targets: { filter: 2600 } }],
      env: { amp: { a: 0.004, d: 0.2, s: 0.9, r: 0.1 } },
    },
  },
  {
    name: 'Grime Growl',
    category: 'wobble',
    patch: {
      voice: { mode: 'mono' },
      osc: [{ enabled: on, wave: 'square', octave: -1, level: 0.75 }],
      fm: { enabled: on, ratio: 0.5, depth: 0.35 },
      filter: { cutoff: 650, resonance: 4, envAmount: 0.25 },
      lfo: [{ rate: 1.4, wave: 'square', targets: { filter: 2000 } }],
      fx: { bitcrusher: { on, bits: 8, downsample: 3, mix: 0.4 }, distortion: { on, drive: 0.45, tone: 0.35, mix: 0.5 } },
    },
  },

  // ---------- FX ----------
  {
    name: 'Riser',
    category: 'fx',
    patch: {
      osc: [
        { enabled: on, wave: 'noise', level: 0.5 },
        { enabled: on, wave: 'saw', octave: 1, level: 0.4 },
      ],
      filter: { cutoff: 1200, resonance: 3, envAmount: 0.8 },
      env: { amp: { a: 2.2, d: 0.3, s: 1, r: 0.6 }, filter: { a: 2.6, d: 0.3, s: 1, r: 0.5 } },
      lfo: [{ rate: 7, targets: { pitch: 90 } }],
      fx: { reverb: { on, size: 3.2, decay: 0.7, mix: 0.45 } },
    },
  },
  {
    name: 'Sweep Noise',
    category: 'fx',
    patch: {
      osc: [{ enabled: on, wave: 'noise', level: 0.7 }],
      filter: { type: 'bandpass', cutoff: 900, resonance: 5, envAmount: 0 },
      lfo: [{ rate: 0.25, targets: { filter: 4400 } }],
      env: { amp: { a: 0.6, d: 0.3, s: 0.9, r: 1.2 } },
      fx: { reverb: { on, size: 2.8, decay: 0.65, mix: 0.4 } },
    },
  },
  {
    name: 'Laser Zap',
    category: 'fx',
    patch: {
      osc: [{ enabled: on, wave: 'sine', octave: 1, level: 0.85 }],
      fm: { enabled: on, ratio: 8, depth: 1 },
      env: { amp: { a: 0.001, d: 0.25, s: 0, r: 0.2 }, filter: { a: 0.001, d: 0.1, s: 0, r: 0.1 } },
      filter: { cutoff: 11000, envAmount: 0.6 },
      fx: { delay: { on, time: 0.16, feedback: 0.5, mix: 0.35 } },
    },
  },
]

// v2: instrument-modeled bank (organs, strings, choir, mallets, pipes, world)
PRESETS.push(...INSTRUMENT_PRESETS)
