// Single source of truth for every user-facing parameter.
// Continuous params drive knobs and AudioParam smoothing; structural params
// drive selects/toggles and take effect on the next note or a graph splice.

export type Taper = 'lin' | 'log'

export interface ContinuousParam {
  path: string
  label: string
  min: number
  max: number
  default: number
  taper: Taper
  unit: string
  smoothing: number // setTargetAtTime tau seconds; 0 = no audio smoothing needed
  group: string
}

export interface StructuralParam {
  path: string
  label: string
  options: readonly (string | number)[]
  group: string
}

const osc = (i: number): ContinuousParam[] => [
  { path: `osc.${i}.level`, label: `Osc ${i + 1} Level`, min: 0, max: 1, default: i === 0 ? 0.7 : 0, taper: 'lin', unit: '', smoothing: 0.02, group: `osc${i + 1}` },
  { path: `osc.${i}.octave`, label: 'Octave', min: -2, max: 2, default: 0, taper: 'lin', unit: 'oct', smoothing: 0, group: `osc${i + 1}` },
  { path: `osc.${i}.semi`, label: 'Semi', min: -12, max: 12, default: 0, taper: 'lin', unit: 'st', smoothing: 0, group: `osc${i + 1}` },
  { path: `osc.${i}.fine`, label: 'Fine', min: -50, max: 50, default: 0, taper: 'lin', unit: 'ct', smoothing: 0, group: `osc${i + 1}` },
]

export const CONTINUOUS: ContinuousParam[] = [
  ...osc(0), ...osc(1), ...osc(2),
  { path: 'filter.cutoff', label: 'Cutoff', min: 20, max: 18000, default: 4000, taper: 'log', unit: 'Hz', smoothing: 0.015, group: 'filter' },
  { path: 'filter.resonance', label: 'Resonance', min: 0.0001, max: 24, default: 0.8, taper: 'log', unit: 'Q', smoothing: 0.02, group: 'filter' },
  { path: 'filter.envAmount', label: 'Env Amt', min: -1, max: 1, default: 0.3, taper: 'lin', unit: '', smoothing: 0, group: 'filter' },
  { path: 'filter.keyTrack', label: 'Key Track', min: 0, max: 1, default: 0.3, taper: 'lin', unit: '', smoothing: 0, group: 'filter' },
  { path: 'env.amp.a', label: 'Attack', min: 0.001, max: 4, default: 0.005, taper: 'log', unit: 's', smoothing: 0, group: 'ampEnv' },
  { path: 'env.amp.d', label: 'Decay', min: 0.005, max: 4, default: 0.15, taper: 'log', unit: 's', smoothing: 0, group: 'ampEnv' },
  { path: 'env.amp.s', label: 'Sustain', min: 0, max: 1, default: 0.7, taper: 'lin', unit: '', smoothing: 0, group: 'ampEnv' },
  { path: 'env.amp.r', label: 'Release', min: 0.005, max: 8, default: 0.25, taper: 'log', unit: 's', smoothing: 0, group: 'ampEnv' },
  { path: 'env.filter.a', label: 'Attack', min: 0.001, max: 4, default: 0.005, taper: 'log', unit: 's', smoothing: 0, group: 'filterEnv' },
  { path: 'env.filter.d', label: 'Decay', min: 0.005, max: 4, default: 0.2, taper: 'log', unit: 's', smoothing: 0, group: 'filterEnv' },
  { path: 'env.filter.s', label: 'Sustain', min: 0, max: 1, default: 0.4, taper: 'lin', unit: '', smoothing: 0, group: 'filterEnv' },
  { path: 'env.filter.r', label: 'Release', min: 0.005, max: 8, default: 0.25, taper: 'log', unit: 's', smoothing: 0, group: 'filterEnv' },
  { path: 'voice.glide', label: 'Glide', min: 0.001, max: 2, default: 0.05, taper: 'log', unit: 's', smoothing: 0, group: 'voice' },
  { path: 'master.gain', label: 'Volume', min: 0, max: 1, default: 0.8, taper: 'lin', unit: '', smoothing: 0.02, group: 'master' },
]

export const STRUCTURAL: StructuralParam[] = [
  { path: 'osc.0.wave', label: 'Osc 1 Wave', options: ['saw', 'square', 'sine', 'triangle', 'noise'], group: 'osc1' },
  { path: 'osc.0.enabled', label: 'Osc 1 On', options: [], group: 'osc1' },
  { path: 'osc.1.wave', label: 'Osc 2 Wave', options: ['saw', 'square', 'sine', 'triangle', 'noise'], group: 'osc2' },
  { path: 'osc.1.enabled', label: 'Osc 2 On', options: [], group: 'osc2' },
  { path: 'osc.2.wave', label: 'Osc 3 Wave', options: ['saw', 'square', 'sine', 'triangle', 'noise'], group: 'osc3' },
  { path: 'osc.2.enabled', label: 'Osc 3 On', options: [], group: 'osc3' },
  { path: 'filter.type', label: 'Filter Type', options: ['lowpass', 'highpass', 'bandpass'], group: 'filter' },
  { path: 'voice.mode', label: 'Voice Mode', options: ['poly', 'mono', 'legato'], group: 'voice' },
]

// Map a normalized 0..1 knob position to a param value respecting taper.
export function denormalize(p: ContinuousParam, norm: number): number {
  const n = Math.min(1, Math.max(0, norm))
  if (p.taper === 'log') {
    return p.min * Math.pow(p.max / p.min, n)
  }
  return p.min + (p.max - p.min) * n
}

export function normalize(p: ContinuousParam, value: number): number {
  const v = Math.min(p.max, Math.max(p.min, value))
  if (p.taper === 'log') {
    return Math.log(v / p.min) / Math.log(p.max / p.min)
  }
  return (v - p.min) / (p.max - p.min)
}
