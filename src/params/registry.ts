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

const lfo = (i: number): ContinuousParam[] => [
  { path: `lfo.${i}.rate`, label: 'Rate', min: 0.05, max: 30, default: i === 0 ? 5 : 0.5, taper: 'log', unit: 'Hz', smoothing: 0.05, group: `lfo${i + 1}` },
  { path: `lfo.${i}.targets.pitch`, label: 'To Pitch', min: 0, max: 1200, default: 0, taper: 'lin', unit: 'ct', smoothing: 0.02, group: `lfo${i + 1}` },
  { path: `lfo.${i}.targets.filter`, label: 'To Filter', min: 0, max: 4800, default: 0, taper: 'lin', unit: 'ct', smoothing: 0.02, group: `lfo${i + 1}` },
  { path: `lfo.${i}.targets.amp`, label: 'To Amp', min: 0, max: 1, default: 0, taper: 'lin', unit: '', smoothing: 0.02, group: `lfo${i + 1}` },
]

const osc = (i: number): ContinuousParam[] => [
  { path: `osc.${i}.level`, label: `Osc ${i + 1} Level`, min: 0, max: 1, default: i === 0 ? 0.7 : 0, taper: 'lin', unit: '', smoothing: 0.02, group: `osc${i + 1}` },
  { path: `osc.${i}.octave`, label: 'Octave', min: -2, max: 2, default: 0, taper: 'lin', unit: 'oct', smoothing: 0, group: `osc${i + 1}` },
  { path: `osc.${i}.semi`, label: 'Semi', min: -12, max: 12, default: 0, taper: 'lin', unit: 'st', smoothing: 0, group: `osc${i + 1}` },
  { path: `osc.${i}.fine`, label: 'Fine', min: -50, max: 50, default: 0, taper: 'lin', unit: 'ct', smoothing: 0, group: `osc${i + 1}` },
  { path: `osc.${i}.unison.detune`, label: 'Detune', min: 0, max: 60, default: 12, taper: 'lin', unit: 'ct', smoothing: 0, group: `osc${i + 1}` },
  { path: `osc.${i}.unison.spread`, label: 'Spread', min: 0, max: 1, default: 0.5, taper: 'lin', unit: '', smoothing: 0, group: `osc${i + 1}` },
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
  { path: 'master.bpm', label: 'BPM', min: 40, max: 240, default: 120, taper: 'lin', unit: '', smoothing: 0, group: 'master' },
  { path: 'fm.ratio', label: 'FM Ratio', min: 0.25, max: 16, default: 2, taper: 'log', unit: 'x', smoothing: 0.02, group: 'fm' },
  { path: 'fm.depth', label: 'FM Depth', min: 0, max: 1, default: 0, taper: 'lin', unit: '', smoothing: 0.02, group: 'fm' },
  ...lfo(0), ...lfo(1),
  { path: 'fx.distortion.drive', label: 'Drive', min: 0, max: 1, default: 0.3, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-distortion' },
  { path: 'fx.distortion.tone', label: 'Tone', min: 0, max: 1, default: 0.5, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-distortion' },
  { path: 'fx.distortion.mix', label: 'Mix', min: 0, max: 1, default: 1, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-distortion' },
  { path: 'fx.bitcrusher.bits', label: 'Bits', min: 1, max: 16, default: 8, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-bitcrusher' },
  { path: 'fx.bitcrusher.downsample', label: 'Crush', min: 1, max: 40, default: 4, taper: 'lin', unit: 'x', smoothing: 0.02, group: 'fx-bitcrusher' },
  { path: 'fx.bitcrusher.mix', label: 'Mix', min: 0, max: 1, default: 1, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-bitcrusher' },
  { path: 'fx.chorus.rate', label: 'Rate', min: 0.05, max: 8, default: 0.8, taper: 'log', unit: 'Hz', smoothing: 0.05, group: 'fx-chorus' },
  { path: 'fx.chorus.depth', label: 'Depth', min: 0, max: 1, default: 0.5, taper: 'lin', unit: '', smoothing: 0.05, group: 'fx-chorus' },
  { path: 'fx.chorus.mix', label: 'Mix', min: 0, max: 1, default: 0.5, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-chorus' },
  { path: 'fx.phaser.rate', label: 'Rate', min: 0.05, max: 8, default: 0.4, taper: 'log', unit: 'Hz', smoothing: 0.05, group: 'fx-phaser' },
  { path: 'fx.phaser.depth', label: 'Depth', min: 0, max: 1, default: 0.6, taper: 'lin', unit: '', smoothing: 0.05, group: 'fx-phaser' },
  { path: 'fx.phaser.mix', label: 'Mix', min: 0, max: 1, default: 0.5, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-phaser' },
  { path: 'fx.delay.time', label: 'Time', min: 0.02, max: 2, default: 0.375, taper: 'log', unit: 's', smoothing: 0.05, group: 'fx-delay' },
  { path: 'fx.delay.feedback', label: 'Feedback', min: 0, max: 0.9, default: 0.35, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-delay' },
  { path: 'fx.delay.mix', label: 'Mix', min: 0, max: 1, default: 0.3, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-delay' },
  { path: 'fx.reverb.size', label: 'Size', min: 0.2, max: 4, default: 2, taper: 'log', unit: 's', smoothing: 0, group: 'fx-reverb' },
  { path: 'fx.reverb.decay', label: 'Decay', min: 0, max: 1, default: 0.5, taper: 'lin', unit: '', smoothing: 0, group: 'fx-reverb' },
  { path: 'fx.reverb.mix', label: 'Mix', min: 0, max: 1, default: 0.3, taper: 'lin', unit: '', smoothing: 0.02, group: 'fx-reverb' },
]

export const STRUCTURAL: StructuralParam[] = [
  { path: 'osc.0.wave', label: 'Osc 1 Wave', options: ['saw', 'square', 'sine', 'triangle', 'noise'], group: 'osc1' },
  { path: 'osc.0.unison.count', label: 'Osc 1 Unison', options: [1, 3, 5, 7], group: 'osc1' },
  { path: 'osc.1.unison.count', label: 'Osc 2 Unison', options: [1, 3, 5, 7], group: 'osc2' },
  { path: 'osc.2.unison.count', label: 'Osc 3 Unison', options: [1, 3, 5, 7], group: 'osc3' },
  { path: 'osc.0.enabled', label: 'Osc 1 On', options: [], group: 'osc1' },
  { path: 'osc.1.wave', label: 'Osc 2 Wave', options: ['saw', 'square', 'sine', 'triangle', 'noise'], group: 'osc2' },
  { path: 'osc.1.enabled', label: 'Osc 2 On', options: [], group: 'osc2' },
  { path: 'osc.2.wave', label: 'Osc 3 Wave', options: ['saw', 'square', 'sine', 'triangle', 'noise'], group: 'osc3' },
  { path: 'osc.2.enabled', label: 'Osc 3 On', options: [], group: 'osc3' },
  { path: 'filter.type', label: 'Filter Type', options: ['lowpass', 'highpass', 'bandpass'], group: 'filter' },
  { path: 'voice.mode', label: 'Voice Mode', options: ['poly', 'mono', 'legato'], group: 'voice' },
  { path: 'fm.enabled', label: 'FM On', options: [], group: 'fm' },
  { path: 'lfo.0.wave', label: 'LFO 1 Wave', options: ['sine', 'triangle', 'square', 'sawtooth'], group: 'lfo1' },
  { path: 'lfo.1.wave', label: 'LFO 2 Wave', options: ['sine', 'triangle', 'square', 'sawtooth'], group: 'lfo2' },
  { path: 'fx.distortion.on', label: 'Distortion On', options: [], group: 'fx-distortion' },
  { path: 'fx.bitcrusher.on', label: 'Bitcrusher On', options: [], group: 'fx-bitcrusher' },
  { path: 'fx.chorus.on', label: 'Chorus On', options: [], group: 'fx-chorus' },
  { path: 'fx.phaser.on', label: 'Phaser On', options: [], group: 'fx-phaser' },
  { path: 'fx.delay.on', label: 'Delay On', options: [], group: 'fx-delay' },
  { path: 'fx.reverb.on', label: 'Reverb On', options: [], group: 'fx-reverb' },
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
