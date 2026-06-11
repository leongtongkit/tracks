// Versioned patch schema. Every saved patch, preset, and share URL carries `v`.
// Bump PATCH_VERSION and add a case to migrate() when the shape changes.

export const PATCH_VERSION = 1

export interface ADSR {
  a: number // attack seconds
  d: number // decay seconds
  s: number // sustain level 0..1
  r: number // release seconds
}

export type Waveform = 'saw' | 'square' | 'sine' | 'triangle' | 'noise'
export type FilterType = 'lowpass' | 'highpass' | 'bandpass'
export type VoiceMode = 'poly' | 'mono' | 'legato'
export type FxId = 'distortion' | 'bitcrusher' | 'chorus' | 'phaser' | 'delay' | 'reverb'
export type PatchCategory =
  | 'bass' | 'lead' | 'pad' | 'pluck' | 'keys'
  | 'bell' | 'brass' | 'wobble' | 'fx' | 'user'

export interface UnisonConfig {
  count: 1 | 3 | 5 | 7
  detune: number // cents between outermost voices
  spread: number // stereo width 0..1
}

export interface OscConfig {
  enabled: boolean
  wave: Waveform
  octave: number // -2..2
  semi: number // -12..12
  fine: number // cents -50..50
  level: number // 0..1
  unison: UnisonConfig
}

export interface LfoConfig {
  wave: 'sine' | 'triangle' | 'square' | 'sawtooth'
  rate: number // Hz
  targets: {
    pitch: number // depth in cents
    filter: number // depth in cents
    amp: number // depth 0..1
  }
}

export interface Patch {
  v: typeof PATCH_VERSION
  name: string
  category: PatchCategory
  voice: { mode: VoiceMode; glide: number; maxVoices: number }
  osc: [OscConfig, OscConfig, OscConfig]
  fm: { enabled: boolean; ratio: number; depth: number }
  filter: {
    type: FilterType
    cutoff: number // Hz
    resonance: number // Q
    envAmount: number // -1..1 (mapped to cents in the engine)
    keyTrack: number // 0..1
  }
  env: { amp: ADSR; filter: ADSR }
  lfo: [LfoConfig, LfoConfig]
  fx: {
    order: FxId[]
    distortion: { on: boolean; drive: number; tone: number; mix: number }
    bitcrusher: { on: boolean; bits: number; downsample: number; mix: number }
    chorus: { on: boolean; rate: number; depth: number; mix: number }
    phaser: { on: boolean; rate: number; depth: number; stages: number; mix: number }
    delay: { on: boolean; time: number; feedback: number; mix: number }
    reverb: { on: boolean; size: number; decay: number; mix: number }
  }
  master: { gain: number; bpm: number }
}

function osc(partial: Partial<OscConfig> = {}): OscConfig {
  return {
    enabled: false,
    wave: 'saw',
    octave: 0,
    semi: 0,
    fine: 0,
    level: 0.7,
    unison: { count: 1, detune: 12, spread: 0.5 },
    ...partial,
  }
}

export function defaultPatch(): Patch {
  return {
    v: PATCH_VERSION,
    name: 'Init',
    category: 'user',
    voice: { mode: 'poly', glide: 0.05, maxVoices: 10 },
    osc: [osc({ enabled: true }), osc(), osc()],
    fm: { enabled: false, ratio: 2, depth: 0 },
    filter: { type: 'lowpass', cutoff: 4000, resonance: 0.8, envAmount: 0.3, keyTrack: 0.3 },
    env: {
      amp: { a: 0.005, d: 0.15, s: 0.7, r: 0.25 },
      filter: { a: 0.005, d: 0.2, s: 0.4, r: 0.25 },
    },
    lfo: [
      { wave: 'sine', rate: 5, targets: { pitch: 0, filter: 0, amp: 0 } },
      { wave: 'sine', rate: 0.5, targets: { pitch: 0, filter: 0, amp: 0 } },
    ],
    fx: {
      order: ['distortion', 'bitcrusher', 'chorus', 'phaser', 'delay', 'reverb'],
      distortion: { on: false, drive: 0.3, tone: 0.5, mix: 1 },
      bitcrusher: { on: false, bits: 8, downsample: 4, mix: 1 },
      chorus: { on: false, rate: 0.8, depth: 0.5, mix: 0.5 },
      phaser: { on: false, rate: 0.4, depth: 0.6, stages: 4, mix: 0.5 },
      delay: { on: false, time: 0.375, feedback: 0.35, mix: 0.3 },
      reverb: { on: false, size: 2, decay: 0.5, mix: 0.3 },
    },
    master: { gain: 0.8, bpm: 120 },
  }
}

// Accepts any parsed JSON believed to be a patch; returns a valid current-version
// Patch or throws. Unknown fields are dropped by construction (merge into default).
export function migrate(raw: unknown): Patch {
  if (typeof raw !== 'object' || raw === null) throw new Error('not a patch')
  const p = raw as Record<string, unknown>
  if (p.v !== PATCH_VERSION) throw new Error(`unsupported patch version: ${String(p.v)}`)
  const merged = deepMerge(defaultPatch(), p) as Patch
  merged.fx.order = sanitizeOrder(merged.fx.order)
  return merged
}

// Element-wise array merging can produce duplicate or missing FX ids from a
// crafted/reordered patch; a duplicate would be wired into the chain twice.
function sanitizeOrder(order: FxId[]): FxId[] {
  const all = defaultPatch().fx.order
  const seen = new Set<FxId>()
  const out: FxId[] = []
  for (const id of order) {
    if (all.includes(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  for (const id of all) {
    if (!seen.has(id)) out.push(id)
  }
  return out
}

function deepMerge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return (over === undefined ? base : (over as T))
  }
  if (typeof over !== 'object' || over === null) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const key of Object.keys(base as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[key]
    const o = (over as Record<string, unknown>)[key]
    if (Array.isArray(b)) {
      out[key] = Array.isArray(o)
        ? b.map((item, i) => deepMerge(item, o[i]))
        : b
    } else {
      out[key] = deepMerge(b, o)
    }
  }
  return out as T
}
