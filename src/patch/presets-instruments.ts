// Instrument-modeled presets (v2): organs, keys, strings, choir, mallets,
// pipes/winds, plucked & world instruments — all built from the same engine.
// Authored as deviations from the default patch, like presets.ts.

import type { PresetDef } from './presets'

const on = true

export const INSTRUMENT_PRESETS: PresetDef[] = [
  // ---------- ORGAN ----------
  {
    name: 'Drawbar Organ',
    category: 'organ',
    patch: {
      osc: [
        { enabled: on, wave: 'sine', level: 0.7 },
        { enabled: on, wave: 'sine', semi: 12, level: 0.5 },
        { enabled: on, wave: 'sine', semi: 19, level: 0.35 },
      ],
      filter: { cutoff: 8000, envAmount: 0 },
      env: { amp: { a: 0.004, d: 0.05, s: 1, r: 0.06 } },
      fx: { chorus: { on, rate: 5.6, depth: 0.25, mix: 0.4 } },
    },
  },
  {
    name: 'Rock Organ',
    category: 'organ',
    patch: {
      osc: [
        { enabled: on, wave: 'sine', level: 0.65 },
        { enabled: on, wave: 'sine', semi: 12, level: 0.55 },
        { enabled: on, wave: 'sine', semi: 19, level: 0.45 },
      ],
      filter: { cutoff: 7000, envAmount: 0 },
      env: { amp: { a: 0.003, d: 0.05, s: 1, r: 0.05 } },
      fx: {
        distortion: { on, drive: 0.45, tone: 0.6, mix: 0.55 },
        chorus: { on, rate: 6.5, depth: 0.35, mix: 0.5 },
      },
    },
  },
  {
    name: 'Cathedral Pipes',
    category: 'organ',
    patch: {
      osc: [
        { enabled: on, wave: 'sine', level: 0.6 },
        { enabled: on, wave: 'sine', semi: 12, level: 0.5 },
        { enabled: on, wave: 'sine', semi: 24, level: 0.3 },
      ],
      filter: { cutoff: 6000, envAmount: 0 },
      env: { amp: { a: 0.06, d: 0.1, s: 1, r: 0.6 } },
      fx: { reverb: { on, size: 4.5, decay: 0.75, mix: 0.45 } },
    },
  },

  // ---------- KEYS ----------
  {
    name: 'House Piano',
    category: 'keys',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', level: 0.75 },
        { enabled: on, wave: 'saw', fine: 6, level: 0.35 },
      ],
      filter: { cutoff: 3800, envAmount: 0.4, keyTrack: 0.6 },
      env: {
        amp: { a: 0.002, d: 0.9, s: 0.12, r: 0.2 },
        filter: { a: 0.001, d: 0.5, s: 0.1, r: 0.2 },
      },
      fx: { chorus: { on, rate: 0.9, depth: 0.3, mix: 0.3 } },
    },
  },
  {
    name: 'Clavinet',
    category: 'keys',
    patch: {
      osc: [
        { enabled: on, wave: 'square', level: 0.6 },
        { enabled: on, wave: 'saw', semi: 12, level: 0.3 },
      ],
      filter: { cutoff: 2600, resonance: 3, envAmount: 0.55, keyTrack: 0.7 },
      env: {
        amp: { a: 0.001, d: 0.45, s: 0.15, r: 0.07 },
        filter: { a: 0.001, d: 0.12, s: 0.1, r: 0.07 },
      },
      fx: { phaser: { on, rate: 0.7, depth: 0.4, mix: 0.3 } },
    },
  },
  {
    name: 'Harpsichord',
    category: 'keys',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', level: 0.55 },
        { enabled: on, wave: 'saw', semi: 12, fine: 4, level: 0.4 },
      ],
      filter: { cutoff: 5200, envAmount: 0.25, keyTrack: 0.6 },
      env: { amp: { a: 0.001, d: 0.7, s: 0.05, r: 0.12 } },
      fx: { reverb: { on, size: 1.8, decay: 0.4, mix: 0.22 } },
    },
  },

  // ---------- STRINGS ----------
  {
    name: 'String Ensemble',
    category: 'strings',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', fine: -6, level: 0.55, unison: { count: 7, detune: 24, spread: 0.85 } },
        { enabled: on, wave: 'saw', octave: -1, fine: 6, level: 0.4 },
      ],
      filter: { cutoff: 3400, envAmount: 0.1 },
      env: { amp: { a: 0.35, d: 0.3, s: 0.85, r: 0.7 } },
      fx: { chorus: { on, rate: 0.6, depth: 0.5, mix: 0.45 }, reverb: { on, size: 3, decay: 0.6, mix: 0.3 } },
    },
  },
  {
    name: 'Solo Violin',
    category: 'strings',
    patch: {
      voice: { mode: 'legato', glide: 0.045 },
      osc: [{ enabled: on, wave: 'saw', level: 0.7 }],
      filter: { cutoff: 4200, resonance: 1.8, envAmount: 0.15 },
      env: { amp: { a: 0.09, d: 0.2, s: 0.9, r: 0.25 } },
      lfo: [{ wave: 'sine', rate: 5.6, targets: { pitch: 14, filter: 0, amp: 0.08 } }],
      fx: { reverb: { on, size: 2.4, decay: 0.55, mix: 0.3 } },
    },
  },
  {
    name: 'Cello',
    category: 'strings',
    patch: {
      voice: { mode: 'legato', glide: 0.05 },
      osc: [
        { enabled: on, wave: 'saw', octave: -1, level: 0.75 },
        { enabled: on, wave: 'triangle', octave: -1, level: 0.3 },
      ],
      filter: { cutoff: 1900, resonance: 1.5, envAmount: 0.12 },
      env: { amp: { a: 0.12, d: 0.25, s: 0.9, r: 0.3 } },
      lfo: [{ wave: 'sine', rate: 5, targets: { pitch: 10, filter: 0, amp: 0.06 } }],
      fx: { reverb: { on, size: 2.6, decay: 0.55, mix: 0.28 } },
    },
  },
  {
    name: 'Pizzicato',
    category: 'strings',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', level: 0.8 },
        { enabled: on, wave: 'saw', level: 0.25 },
      ],
      filter: { cutoff: 2800, envAmount: 0.5, keyTrack: 0.5 },
      env: {
        amp: { a: 0.001, d: 0.28, s: 0, r: 0.12 },
        filter: { a: 0.001, d: 0.09, s: 0, r: 0.1 },
      },
      fx: { reverb: { on, size: 2, decay: 0.45, mix: 0.25 } },
    },
  },

  // ---------- CHOIR ----------
  {
    name: 'Choir Aahs',
    category: 'choir',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', level: 0.55, unison: { count: 5, detune: 16, spread: 0.7 } },
        { enabled: on, wave: 'sine', semi: 12, level: 0.25 },
      ],
      filter: { type: 'bandpass', cutoff: 950, resonance: 1.6, envAmount: 0.08 },
      env: { amp: { a: 0.4, d: 0.3, s: 0.9, r: 0.8 } },
      lfo: [{ wave: 'sine', rate: 4.8, targets: { pitch: 7, filter: 0, amp: 0 } }],
      fx: { chorus: { on, rate: 0.5, depth: 0.45, mix: 0.4 }, reverb: { on, size: 3.6, decay: 0.7, mix: 0.4 } },
    },
  },
  {
    name: 'Vox Choir',
    category: 'choir',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', level: 0.5, unison: { count: 5, detune: 12, spread: 0.8 } },
        { enabled: on, wave: 'sine', level: 0.35 },
      ],
      filter: { type: 'bandpass', cutoff: 700, resonance: 1.2, envAmount: 0.15 },
      env: {
        amp: { a: 0.7, d: 0.4, s: 0.85, r: 1.2 },
        filter: { a: 0.9, d: 0.5, s: 0.6, r: 1 },
      },
      fx: { reverb: { on, size: 4, decay: 0.75, mix: 0.45 } },
    },
  },

  // ---------- MALLET ----------
  {
    name: 'Marimba',
    category: 'mallet',
    patch: {
      osc: [{ enabled: on, wave: 'sine', level: 0.85 }],
      fm: { enabled: on, ratio: 4, depth: 0.18 },
      filter: { cutoff: 5000, envAmount: 0.2, keyTrack: 0.8 },
      env: { amp: { a: 0.001, d: 0.4, s: 0, r: 0.18 } },
      fx: { reverb: { on, size: 1.8, decay: 0.4, mix: 0.22 } },
    },
  },
  {
    name: 'Vibraphone',
    category: 'mallet',
    patch: {
      osc: [{ enabled: on, wave: 'sine', level: 0.8 }],
      fm: { enabled: on, ratio: 3.5, depth: 0.12 },
      filter: { cutoff: 6000, envAmount: 0.1 },
      env: { amp: { a: 0.002, d: 2.2, s: 0, r: 0.8 } },
      lfo: [{ wave: 'sine', rate: 4.2, targets: { pitch: 0, filter: 0, amp: 0.4 } }],
      fx: { reverb: { on, size: 2.2, decay: 0.5, mix: 0.28 } },
    },
  },
  {
    name: 'Mbira',
    category: 'mallet',
    patch: {
      osc: [{ enabled: on, wave: 'sine', level: 0.85 }],
      fm: { enabled: on, ratio: 7, depth: 0.08 },
      filter: { cutoff: 4500, envAmount: 0.3, keyTrack: 0.7 },
      env: { amp: { a: 0.001, d: 0.55, s: 0, r: 0.2 } },
      fx: { delay: { on, time: 0.28, feedback: 0.22, mix: 0.16 }, reverb: { on, size: 1.6, decay: 0.4, mix: 0.2 } },
    },
  },
  {
    name: 'Music Box',
    category: 'mallet',
    patch: {
      osc: [
        { enabled: on, wave: 'sine', octave: 1, level: 0.7 },
        { enabled: on, wave: 'sine', octave: 2, semi: 4, level: 0.2 },
      ],
      fm: { enabled: on, ratio: 9, depth: 0.06 },
      filter: { cutoff: 8000, envAmount: 0 },
      env: { amp: { a: 0.001, d: 1.4, s: 0, r: 0.6 } },
      fx: { reverb: { on, size: 2.8, decay: 0.6, mix: 0.35 } },
    },
  },
  {
    name: 'Steel Drum',
    category: 'mallet',
    patch: {
      osc: [{ enabled: on, wave: 'sine', level: 0.75 }],
      fm: { enabled: on, ratio: 1.4, depth: 0.55 },
      filter: { cutoff: 5200, envAmount: 0.25, keyTrack: 0.5 },
      env: { amp: { a: 0.001, d: 0.8, s: 0.05, r: 0.3 } },
      fx: { chorus: { on, rate: 1.4, depth: 0.4, mix: 0.35 }, reverb: { on, size: 2.2, decay: 0.5, mix: 0.3 } },
    },
  },

  // ---------- PIPE / WIND ----------
  {
    name: 'Concert Flute',
    category: 'pipe',
    patch: {
      voice: { mode: 'legato', glide: 0.02 },
      osc: [
        { enabled: on, wave: 'triangle', level: 0.75 },
        { enabled: on, wave: 'noise', level: 0.07 },
      ],
      filter: { cutoff: 3200, envAmount: 0.1 },
      env: { amp: { a: 0.07, d: 0.15, s: 0.85, r: 0.2 } },
      lfo: [{ wave: 'sine', rate: 5.2, targets: { pitch: 8, filter: 0, amp: 0.07 } }],
      fx: { reverb: { on, size: 2.2, decay: 0.5, mix: 0.28 } },
    },
  },
  {
    name: 'Pan Flute',
    category: 'pipe',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', level: 0.65 },
        { enabled: on, wave: 'noise', level: 0.16 },
      ],
      filter: { type: 'bandpass', cutoff: 1600, resonance: 1.4, envAmount: 0.3 },
      env: {
        amp: { a: 0.03, d: 0.25, s: 0.7, r: 0.25 },
        filter: { a: 0.005, d: 0.12, s: 0.3, r: 0.2 },
      },
      fx: { delay: { on, time: 0.3, feedback: 0.28, mix: 0.2 }, reverb: { on, size: 2.6, decay: 0.55, mix: 0.32 } },
    },
  },
  {
    name: 'Ocarina',
    category: 'pipe',
    patch: {
      osc: [{ enabled: on, wave: 'sine', level: 0.85 }],
      filter: { cutoff: 2600, envAmount: 0.05 },
      env: { amp: { a: 0.04, d: 0.1, s: 0.9, r: 0.15 } },
      lfo: [{ wave: 'sine', rate: 5.8, targets: { pitch: 12, filter: 0, amp: 0 } }],
      fx: { reverb: { on, size: 2, decay: 0.45, mix: 0.25 } },
    },
  },
  {
    name: 'Soft Sax',
    category: 'pipe',
    patch: {
      voice: { mode: 'legato', glide: 0.03 },
      osc: [
        { enabled: on, wave: 'saw', level: 0.6 },
        { enabled: on, wave: 'square', octave: -1, level: 0.25 },
      ],
      filter: { cutoff: 2100, resonance: 1.8, envAmount: 0.3 },
      env: {
        amp: { a: 0.05, d: 0.2, s: 0.85, r: 0.18 },
        filter: { a: 0.06, d: 0.2, s: 0.5, r: 0.18 },
      },
      lfo: [{ wave: 'sine', rate: 5, targets: { pitch: 9, filter: 0, amp: 0.05 } }],
      fx: { reverb: { on, size: 2.2, decay: 0.5, mix: 0.26 } },
    },
  },
  {
    name: 'Trumpet Section',
    category: 'brass',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', level: 0.65, unison: { count: 3, detune: 10, spread: 0.4 } },
        { enabled: on, wave: 'saw', fine: -7, level: 0.35 },
      ],
      filter: { cutoff: 2400, resonance: 1.4, envAmount: 0.5 },
      env: {
        amp: { a: 0.025, d: 0.15, s: 0.85, r: 0.15 },
        filter: { a: 0.04, d: 0.18, s: 0.5, r: 0.15 },
      },
      fx: { reverb: { on, size: 2, decay: 0.45, mix: 0.22 } },
    },
  },

  // ---------- PLUCKED / WORLD ----------
  {
    name: 'Nylon Harp',
    category: 'pluck',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', level: 0.8 },
        { enabled: on, wave: 'sine', semi: 12, level: 0.3 },
      ],
      filter: { cutoff: 3400, envAmount: 0.35, keyTrack: 0.6 },
      env: { amp: { a: 0.001, d: 1.1, s: 0, r: 0.5 } },
      fx: { reverb: { on, size: 2.8, decay: 0.6, mix: 0.32 } },
    },
  },
  {
    name: 'Upright Bass',
    category: 'bass',
    patch: {
      voice: { mode: 'mono', glide: 0.015 },
      osc: [
        { enabled: on, wave: 'sine', octave: -1, level: 0.8 },
        { enabled: on, wave: 'triangle', octave: -1, level: 0.35 },
      ],
      filter: { cutoff: 900, envAmount: 0.3, keyTrack: 0.4 },
      env: { amp: { a: 0.004, d: 0.8, s: 0.3, r: 0.15 } },
    },
  },
  {
    name: 'Sitar',
    category: 'world',
    patch: {
      osc: [
        { enabled: on, wave: 'saw', level: 0.6 },
        { enabled: on, wave: 'square', semi: 12, level: 0.2 },
      ],
      fm: { enabled: on, ratio: 2, depth: 0.2 },
      filter: { type: 'bandpass', cutoff: 1900, resonance: 5, envAmount: 0.4 },
      env: {
        amp: { a: 0.001, d: 1.3, s: 0.1, r: 0.4 },
        filter: { a: 0.001, d: 0.5, s: 0.2, r: 0.3 },
      },
      fx: { delay: { on, time: 0.24, feedback: 0.25, mix: 0.15 }, reverb: { on, size: 2.4, decay: 0.5, mix: 0.28 } },
    },
  },
  {
    name: 'Koto Pluck',
    category: 'world',
    patch: {
      osc: [
        { enabled: on, wave: 'triangle', level: 0.75 },
        { enabled: on, wave: 'saw', semi: 12, level: 0.2 },
      ],
      filter: { cutoff: 2900, resonance: 2.2, envAmount: 0.45, keyTrack: 0.6 },
      env: {
        amp: { a: 0.001, d: 0.7, s: 0, r: 0.25 },
        filter: { a: 0.001, d: 0.15, s: 0, r: 0.2 },
      },
      fx: { reverb: { on, size: 2.2, decay: 0.5, mix: 0.26 } },
    },
  },
  {
    name: 'Accordion',
    category: 'world',
    patch: {
      osc: [
        { enabled: on, wave: 'square', fine: -8, level: 0.5 },
        { enabled: on, wave: 'square', fine: 8, level: 0.5 },
        { enabled: on, wave: 'saw', semi: 12, level: 0.2 },
      ],
      filter: { cutoff: 3200, envAmount: 0.05 },
      env: { amp: { a: 0.03, d: 0.1, s: 1, r: 0.08 } },
      fx: { chorus: { on, rate: 4.8, depth: 0.3, mix: 0.4 } },
    },
  },
]
