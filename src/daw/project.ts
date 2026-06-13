// Tracks project schema. Everything musical is in BEATS so tempo changes
// re-time the whole song; conversion to seconds happens only at scheduling.
//
// v2 adds: track kinds (synth/drums/sampler/audio), extended mixer (3-band EQ,
// compressor, send levels), per-track volume/pan automation, a project key
// signature (drives autotune), audio clip regions, and sample metadata.
// Sample BINARY data never lives here — it lives in the runtime SampleStore
// and is embedded only when exporting a project file.

import { buildPresetPatch, PRESETS } from '../patch/presets'
import { defaultPatch, migrate, type Patch } from '../patch/schema'

export const PROJECT_VERSION = 2

// 'bus' = a group/summing track: no instrument or clips, just a channel strip
// other tracks route their output into.
export type TrackKind = 'synth' | 'drums' | 'sampler' | 'pads' | 'audio' | 'bus' | 'soundfont'

export interface Note {
  start: number // beats, relative to clip start
  dur: number // beats
  pitch: number // MIDI
  vel: number // 0..1
}

// follow the project tempo. 'off' = play at native speed; 'repitch' = vinyl
// (speed + pitch move together); 'stretch' = pitch-preserving time-stretch.
export type WarpMode = 'off' | 'repitch' | 'stretch'

// An audio clip references a sample in the SampleStore.
export interface AudioRegion {
  sampleId: string
  offsetSec: number // where in the sample this clip starts (source seconds)
  gain: number // 0..2 linear
  warp: WarpMode
  origBpm: number // the tempo this audio "is in"
  fadeIn: number // beats; gain ramps up over the clip's first fadeIn beats
  fadeOut: number // beats; gain ramps down over the clip's last fadeOut beats
}

// source-seconds per wall-clock-second when following tempo (same magnitude for
// repitch and stretch; the difference is whether pitch moves).
export function warpRate(region: AudioRegion, bpm: number): number {
  return region.warp === 'off' ? 1 : bpm / region.origBpm
}

export interface Clip {
  id: string
  start: number // beats, on the song timeline
  length: number // beats
  notes: Note[]
  audio?: AudioRegion
}

export type CurveShape = 'linear' | 'hold' | 'exp'

export interface AutoPoint {
  beat: number
  value: number
  shape?: CurveShape // how the curve LEAVES this point toward the next (default linear)
}

// Any channel-strip parameter can be automated. Each maps to a single
// AudioParam on the channel (see automation-targets.ts for ranges).
export type AutoTarget = 'volume' | 'pan' | 'sendA' | 'sendB' | 'eqLow' | 'eqMid' | 'eqHigh'

// Per-target breakpoint lists; absent/empty target = not automated.
export type Automation = Partial<Record<AutoTarget, AutoPoint[]>>

// One band of the parametric EQ. shelf/peaking bands use gain; lowpass/highpass
// ignore it. The first three bands are the legacy low/mid/high and stay the
// automation targets eqLow/eqMid/eqHigh.
export type EqBandType = 'lowshelf' | 'peaking' | 'highshelf' | 'lowpass' | 'highpass'
export interface EqBand {
  type: EqBandType
  freq: number // Hz, 20..20000
  gain: number // dB, -18..18 (shelf/peaking only)
  q: number // 0.1..18
  on: boolean
}

export const MAX_EQ_BANDS = 8

export function defaultEqBands(): EqBand[] {
  return [
    { type: 'lowshelf', freq: 130, gain: 0, q: 0.7, on: true },
    { type: 'peaking', freq: 1000, gain: 0, q: 0.9, on: true },
    { type: 'highshelf', freq: 6000, gain: 0, q: 0.7, on: true },
  ]
}

// does a band type respond to the gain control?
export function eqUsesGain(type: EqBandType): boolean {
  return type === 'lowshelf' || type === 'peaking' || type === 'highshelf'
}

export interface MixerState {
  volume: number
  pan: number
  mute: boolean
  solo: boolean
  eq: EqBand[] // 1..MAX_EQ_BANDS parametric bands, in series
  comp: { on: boolean; threshold: number; ratio: number; attack: number; release: number; makeup: number }
  gate: { on: boolean; threshold: number; floor: number } // noise gate: close below threshold (linear env 0..0.3) down to floor gain
  deEss: { on: boolean; amount: number; freq: number } // de-esser: dynamic high-shelf cut driven by sibilance level
  sendA: number // 0..1 to the reverb bus
  sendB: number // 0..1 to the delay bus
  output: string // routing destination: 'master' or a bus track id
  duck: { source: string | null; amount: number } // sidechain: dip this track when `source` plays
}

export interface DrumVoiceParams {
  level: number // 0..1.5
  tune: number // semitones, -12..12
  decay: number // 0.2..3 multiplier on the recipe's decay
}

export interface DrumPatch {
  kit: '808' | '909'
  level: number
  drums: Record<string, Partial<DrumVoiceParams>> // keyed by drum id; only overrides stored
}

export interface SamplerPatch {
  sampleId: string | null
  root: number // MIDI note the sample plays back unshifted
  gain: number
  attack: number // s
  release: number // s
  loop: boolean
}

// 16 sample pads (MPC-style), mapped to MIDI 36..51.
export interface PadConfig {
  sampleId: string | null
  gain: number // 0..2
  tune: number // semitones, -24..24
  oneshot: boolean // true = always play the full sample
}

export interface PadsPatch {
  pads: PadConfig[] // exactly PAD_COUNT entries
}

// References a SoundFont loaded into the runtime SoundFontStore by id. The .sf2
// binary is never stored in the project (local to the browser).
export interface SoundFontPatch {
  id: string | null
  name: string
  presetIndex: number
}

export const PAD_COUNT = 16
export const PAD_BASE_PITCH = 36

export interface TrackData {
  id: string
  name: string
  kind: TrackKind
  patch: Patch
  drums: DrumPatch
  sampler: SamplerPatch
  pads: PadsPatch
  soundfont: SoundFontPatch
  mixer: MixerState
  auto: Automation
  clips: Clip[]
  // session-view slots (one per scene row); null = empty. Launching a slot loops
  // that clip on this track, overriding the arrangement.
  session: (Clip | null)[]
  // when set, the track's instrument is bounced to this sample (rendered with a
  // neutral strip) and played back through the live strip instead of synthesised
  // live — saves CPU. lengthBeats is the bounce length on the song timeline.
  frozen?: { sampleId: string; lengthBeats: number }
}

export interface SampleMeta {
  name: string
  duration: number // s
}

export type ScaleName = 'chromatic' | 'major' | 'minor'

export interface KeySig {
  root: number // 0..11, 0 = C
  scale: ScaleName
}

// a named point on the timeline (verse / chorus / drop …)
export interface Marker {
  beat: number
  name: string
}

export interface Project {
  v: typeof PROJECT_VERSION
  name: string
  bpm: number
  key: KeySig
  // display time signature: beats here are quarter notes, so a bar spans
  // num * 4/den quarter-note beats (4/4 = 4, 3/4 = 3, 6/8 = 3). Affects the
  // ruler/grid only — clip timing stays in quarter-note beats.
  timeSig: { num: number; den: number }
  tempoMap: TempoEvent[] // tempo changes after beat 0 (beat 0 = bpm); empty = constant tempo
  scenes: { name: string }[] // session-view rows
  markers: Marker[]
  loop: { on: boolean; start: number; end: number } // beats
  tracks: TrackData[]
  samples: Record<string, SampleMeta>
}

// quarter-note beats per bar for a time signature
export function beatsPerBar(timeSig: { num: number; den: number }): number {
  return (timeSig.num * 4) / timeSig.den
}

// a tempo change at a beat (beat 0 is always the project's base bpm)
export interface TempoEvent {
  beat: number
  bpm: number
}

// Piecewise-constant tempo → beat↔time conversion. With no events it is exactly
// the old constant-tempo math (secAtBeat(b) = b * 60/bpm), so existing projects
// are byte-identical. Build once per tempo change; cheap to query.
export class TempoMap {
  private readonly segs: { beat: number; bpm: number; sec: number }[]

  constructor(baseBpm: number, events: TempoEvent[] = []) {
    const base = Math.min(240, Math.max(20, baseBpm)) || 120
    const pts = [{ beat: 0, bpm: base }, ...events.filter(e => e.beat > 0 && e.bpm > 0).sort((a, b) => a.beat - b.beat)]
    const segs: { beat: number; bpm: number; sec: number }[] = []
    let sec = 0
    for (let i = 0; i < pts.length; i++) {
      if (segs.length && pts[i].beat === segs[segs.length - 1].beat) {
        segs[segs.length - 1].bpm = pts[i].bpm // same beat → last wins
        continue
      }
      if (i > 0) sec += (pts[i].beat - segs[segs.length - 1].beat) * (60 / segs[segs.length - 1].bpm)
      segs.push({ beat: pts[i].beat, bpm: pts[i].bpm, sec })
    }
    this.segs = segs
  }

  private segAtBeat(beat: number): { beat: number; bpm: number; sec: number } {
    let s = this.segs[0]
    for (const seg of this.segs) {
      if (seg.beat <= beat + 1e-9) s = seg
      else break
    }
    return s
  }

  bpmAtBeat(beat: number): number {
    return this.segAtBeat(beat).bpm
  }

  // seconds from song start (beat 0) to `beat`
  secAtBeat(beat: number): number {
    const s = this.segAtBeat(beat)
    return s.sec + (beat - s.beat) * (60 / s.bpm)
  }

  // inverse: the beat reached at `sec` seconds from song start
  beatAtSec(sec: number): number {
    let s = this.segs[0]
    for (const seg of this.segs) {
      if (seg.sec <= sec + 1e-12) s = seg
      else break
    }
    return s.beat + (sec - s.sec) * (s.bpm / 60)
  }
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : `i${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
}

export function defaultMixer(): MixerState {
  return {
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    eq: defaultEqBands(),
    comp: { on: false, threshold: -18, ratio: 3, attack: 0.01, release: 0.18, makeup: 1 },
    gate: { on: false, threshold: 0.04, floor: 0 },
    deEss: { on: false, amount: 0.5, freq: 6500 },
    sendA: 0,
    sendB: 0,
    output: 'master',
    duck: { source: null, amount: 0 },
  }
}

export function defaultDrums(): DrumPatch {
  return { kit: '808', level: 0.9, drums: {} }
}

export function defaultSampler(): SamplerPatch {
  return { sampleId: null, root: 60, gain: 0.9, attack: 0.003, release: 0.08, loop: false }
}

export function defaultPads(): PadsPatch {
  return {
    pads: Array.from({ length: PAD_COUNT }, () => ({ sampleId: null, gain: 1, tune: 0, oneshot: true })),
  }
}

export function defaultSoundFont(): SoundFontPatch {
  return { id: null, name: '', presetIndex: 0 }
}

export function newTrack(name: string, opts: { preset?: string; kind?: TrackKind } = {}): TrackData {
  const def = opts.preset ? PRESETS.find(p => p.name === opts.preset) : undefined
  return {
    id: newId(),
    name,
    kind: opts.kind ?? 'synth',
    patch: def ? buildPresetPatch(def) : defaultPatch(),
    drums: defaultDrums(),
    sampler: defaultSampler(),
    pads: defaultPads(),
    soundfont: defaultSoundFont(),
    mixer: defaultMixer(),
    auto: {},
    clips: [],
    session: [],
  }
}

export function defaultProject(): Project {
  return {
    v: PROJECT_VERSION,
    name: 'Untitled',
    bpm: 120,
    key: { root: 0, scale: 'chromatic' },
    timeSig: { num: 4, den: 4 },
    tempoMap: [],
    scenes: [],
    markers: [],
    loop: { on: false, start: 0, end: 16 },
    tracks: [
      newTrack('Bass', { preset: 'Fat Saw' }),
      newTrack('Keys', { preset: 'EP Glow' }),
      newTrack('Lead', { preset: 'Retro Solo' }),
      newTrack('Pad', { preset: 'Warm Pad' }),
    ],
    samples: {},
  }
}

// Length of the song in beats (end of the last clip), minimum one bar.
export function projectEndBeat(project: Project): number {
  let end = 4
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.length)
    }
  }
  return end
}

// Drop sample entries no clip or sampler references (keeps exports lean).
export function pruneSamples(project: Project): void {
  const used = new Set<string>()
  for (const track of project.tracks) {
    if (track.frozen) used.add(track.frozen.sampleId)
    if (track.sampler.sampleId) used.add(track.sampler.sampleId)
    for (const pad of track.pads.pads) {
      if (pad.sampleId) used.add(pad.sampleId)
    }
    for (const clip of track.clips) {
      if (clip.audio) used.add(clip.audio.sampleId)
    }
  }
  for (const id of Object.keys(project.samples)) {
    if (!used.has(id)) delete project.samples[id]
  }
}

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const KINDS: TrackKind[] = ['synth', 'drums', 'sampler', 'pads', 'audio', 'bus', 'soundfont']
const SCALES: ScaleName[] = ['chromatic', 'major', 'minor']

// Accepts parsed JSON (v1 or v2); returns a valid v2 Project or throws.
export function migrateProject(raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) throw new Error('not a project')
  const p = raw as Record<string, unknown>
  if (p.v !== 1 && p.v !== PROJECT_VERSION) throw new Error(`unsupported project version: ${String(p.v)}`)

  const tracks = Array.isArray(p.tracks) ? p.tracks : []
  const loop = (typeof p.loop === 'object' && p.loop !== null ? p.loop : {}) as Record<string, unknown>
  const key = (typeof p.key === 'object' && p.key !== null ? p.key : {}) as Record<string, unknown>
  const samplesRaw = (typeof p.samples === 'object' && p.samples !== null ? p.samples : {}) as Record<string, unknown>

  const samples: Record<string, SampleMeta> = {}
  for (const [id, meta] of Object.entries(samplesRaw)) {
    const m = (typeof meta === 'object' && meta !== null ? meta : {}) as Record<string, unknown>
    samples[id] = {
      name: typeof m.name === 'string' ? m.name.slice(0, 60) : 'sample',
      duration: clamp(m.duration, 0, 3600, 0),
    }
  }

  return {
    v: PROJECT_VERSION,
    name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, 60) : 'Untitled',
    bpm: clamp(p.bpm, 40, 240, 120),
    key: {
      root: Math.round(clamp(key.root, 0, 11, 0)),
      scale: SCALES.includes(key.scale as ScaleName) ? (key.scale as ScaleName) : 'chromatic',
    },
    timeSig: (() => {
      const ts = (typeof p.timeSig === 'object' && p.timeSig !== null ? p.timeSig : {}) as Record<string, unknown>
      const den = Number(ts.den)
      return {
        num: Math.round(clamp(ts.num, 1, 32, 4)),
        den: [1, 2, 4, 8, 16].includes(den) ? den : 4,
      }
    })(),
    tempoMap: (Array.isArray(p.tempoMap) ? p.tempoMap : [])
      .slice(0, 256)
      .map(e => {
        const o = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>
        return { beat: clamp(o.beat, 0, 1e5, 0), bpm: clamp(o.bpm, 20, 240, 120) }
      })
      .filter(e => e.beat > 0 && Number.isFinite(e.bpm))
      .sort((a, b) => a.beat - b.beat),
    scenes: (Array.isArray(p.scenes) ? p.scenes : [])
      .slice(0, 64)
      .map((s, i) => {
        const o = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>
        return { name: typeof o.name === 'string' ? o.name.slice(0, 40) : `Scene ${i + 1}` }
      }),
    markers: (Array.isArray(p.markers) ? p.markers : [])
      .slice(0, 256)
      .map(m => {
        const o = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>
        return { beat: clamp(o.beat, 0, 1e5, 0), name: typeof o.name === 'string' ? o.name.slice(0, 40) : 'Mark' }
      })
      .filter(m => Number.isFinite(m.beat))
      .sort((a, b) => a.beat - b.beat),
    loop: {
      on: Boolean(loop.on),
      start: clamp(loop.start, 0, 1e5, 0),
      end: clamp(loop.end, 1, 1e5, 16),
    },
    tracks: tracks.slice(0, 24).map((t, i) => migrateTrack(t, i)),
    samples,
  }
}

function migrateTrack(raw: unknown, index: number): TrackData {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const mixer = (typeof t.mixer === 'object' && t.mixer !== null ? t.mixer : {}) as Record<string, unknown>
  const comp = (typeof mixer.comp === 'object' && mixer.comp !== null ? mixer.comp : {}) as Record<string, unknown>
  const auto = (typeof t.auto === 'object' && t.auto !== null ? t.auto : {}) as Record<string, unknown>
  let patch: Patch
  try {
    patch = migrate(t.patch)
  } catch {
    patch = defaultPatch()
  }
  const clips = Array.isArray(t.clips) ? t.clips : []
  return {
    id: typeof t.id === 'string' && t.id ? t.id : newId(),
    name: typeof t.name === 'string' && t.name.trim() ? t.name.slice(0, 24) : `Track ${index + 1}`,
    kind: KINDS.includes(t.kind as TrackKind) ? (t.kind as TrackKind) : 'synth',
    patch,
    drums: migrateDrums(t.drums),
    sampler: migrateSampler(t.sampler),
    pads: migratePads(t.pads),
    soundfont: migrateSoundFont(t.soundfont),
    mixer: {
      volume: clamp(mixer.volume, 0, 1, 0.8),
      pan: clamp(mixer.pan, -1, 1, 0),
      mute: Boolean(mixer.mute),
      solo: Boolean(mixer.solo),
      eq: migrateEq(mixer.eq),
      comp: {
        on: Boolean(comp.on),
        threshold: clamp(comp.threshold, -60, 0, -18),
        ratio: clamp(comp.ratio, 1, 20, 3),
        attack: clamp(comp.attack, 0.001, 0.3, 0.01),
        release: clamp(comp.release, 0.02, 1, 0.18),
        makeup: clamp(comp.makeup, 0.25, 4, 1),
      },
      gate: (() => {
        const g = (typeof mixer.gate === 'object' && mixer.gate !== null ? mixer.gate : {}) as Record<string, unknown>
        return { on: Boolean(g.on), threshold: clamp(g.threshold, 0, 0.3, 0.04), floor: clamp(g.floor, 0, 1, 0) }
      })(),
      deEss: (() => {
        const d = (typeof mixer.deEss === 'object' && mixer.deEss !== null ? mixer.deEss : {}) as Record<string, unknown>
        return { on: Boolean(d.on), amount: clamp(d.amount, 0, 1, 0.5), freq: clamp(d.freq, 2000, 12000, 6500) }
      })(),
      sendA: clamp(mixer.sendA, 0, 1, 0),
      sendB: clamp(mixer.sendB, 0, 1, 0),
      output: typeof mixer.output === 'string' && mixer.output ? mixer.output : 'master',
      duck: (() => {
        const d = (typeof mixer.duck === 'object' && mixer.duck !== null ? mixer.duck : {}) as Record<string, unknown>
        return {
          source: typeof d.source === 'string' && d.source ? d.source : null,
          amount: clamp(d.amount, 0, 1, 0),
        }
      })(),
    },
    auto: migrateAuto(auto),
    clips: clips.slice(0, 256).map(migrateClip).filter((c): c is Clip => c !== null),
    session: (Array.isArray(t.session) ? t.session : []).slice(0, 64).map(s => (s === null ? null : migrateClip(s))),
    ...(() => {
      const f = (typeof t.frozen === 'object' && t.frozen !== null ? t.frozen : null) as Record<string, unknown> | null
      return f && typeof f.sampleId === 'string' && f.sampleId
        ? { frozen: { sampleId: f.sampleId, lengthBeats: clamp(f.lengthBeats, 1, 1e5, 4) } }
        : {}
    })(),
  }
}

const EQ_TYPES: EqBandType[] = ['lowshelf', 'peaking', 'highshelf', 'lowpass', 'highpass']

// Accepts the new EqBand[] array OR the legacy { low, mid, high } object.
function migrateEq(raw: unknown): EqBand[] {
  if (Array.isArray(raw)) {
    const bands = raw
      .slice(0, MAX_EQ_BANDS)
      .map((b): EqBand => {
        const o = (typeof b === 'object' && b !== null ? b : {}) as Record<string, unknown>
        return {
          type: EQ_TYPES.includes(o.type as EqBandType) ? (o.type as EqBandType) : 'peaking',
          freq: clamp(o.freq, 20, 20000, 1000),
          gain: clamp(o.gain, -18, 18, 0),
          q: clamp(o.q, 0.1, 18, 0.9),
          on: o.on === undefined ? true : Boolean(o.on),
        }
      })
    return bands.length ? bands : defaultEqBands()
  }
  // legacy v2 { low, mid, high } in dB → the three default bands
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bands = defaultEqBands()
  bands[0].gain = clamp(o.low, -18, 18, 0)
  bands[1].gain = clamp(o.mid, -18, 18, 0)
  bands[2].gain = clamp(o.high, -18, 18, 0)
  return bands
}

function migrateAuto(raw: Record<string, unknown>): Automation {
  const out: Automation = {}
  for (const t of AUTO_TARGET_RANGES) {
    const pts = migrateAutoPoints(raw[t.key], t.min, t.max)
    if (pts.length > 0) out[t.key] = pts
  }
  return out
}

// Range table (kept here so migration clamps correctly without importing the
// UI-facing target registry).
const AUTO_TARGET_RANGES: { key: AutoTarget; min: number; max: number }[] = [
  { key: 'volume', min: 0, max: 1 },
  { key: 'pan', min: -1, max: 1 },
  { key: 'sendA', min: 0, max: 1 },
  { key: 'sendB', min: 0, max: 1 },
  { key: 'eqLow', min: -18, max: 18 },
  { key: 'eqMid', min: -18, max: 18 },
  { key: 'eqHigh', min: -18, max: 18 },
]

function migrateDrums(raw: unknown): DrumPatch {
  const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const drumsRaw = (typeof d.drums === 'object' && d.drums !== null ? d.drums : {}) as Record<string, unknown>
  const drums: Record<string, Partial<DrumVoiceParams>> = {}
  for (const [id, v] of Object.entries(drumsRaw)) {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
    const out: Partial<DrumVoiceParams> = {}
    if (o.level !== undefined) out.level = clamp(o.level, 0, 1.5, 1)
    if (o.tune !== undefined) out.tune = clamp(o.tune, -12, 12, 0)
    if (o.decay !== undefined) out.decay = clamp(o.decay, 0.2, 3, 1)
    drums[id] = out
  }
  return {
    kit: d.kit === '909' ? '909' : '808',
    level: clamp(d.level, 0, 1.5, 0.9),
    drums,
  }
}

function migrateSampler(raw: unknown): SamplerPatch {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    sampleId: typeof s.sampleId === 'string' && s.sampleId ? s.sampleId : null,
    root: Math.round(clamp(s.root, 0, 127, 60)),
    gain: clamp(s.gain, 0, 2, 0.9),
    attack: clamp(s.attack, 0, 2, 0.003),
    release: clamp(s.release, 0.005, 4, 0.08),
    loop: Boolean(s.loop),
  }
}

function migrateSoundFont(raw: unknown): SoundFontPatch {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    id: typeof s.id === 'string' && s.id ? s.id : null,
    name: typeof s.name === 'string' ? s.name.slice(0, 60) : '',
    presetIndex: Math.max(0, Math.round(clamp(s.presetIndex, 0, 4096, 0))),
  }
}

function migratePads(raw: unknown): PadsPatch {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const padsRaw = Array.isArray(p.pads) ? p.pads : []
  const pads: PadConfig[] = []
  for (let i = 0; i < PAD_COUNT; i++) {
    const o = (typeof padsRaw[i] === 'object' && padsRaw[i] !== null ? padsRaw[i] : {}) as Record<string, unknown>
    pads.push({
      sampleId: typeof o.sampleId === 'string' && o.sampleId ? o.sampleId : null,
      gain: clamp(o.gain, 0, 2, 1),
      tune: clamp(o.tune, -24, 24, 0),
      oneshot: o.oneshot === undefined ? true : Boolean(o.oneshot),
    })
  }
  return { pads }
}

function migrateAutoPoints(raw: unknown, min: number, max: number): AutoPoint[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 512)
    .map(p => {
      const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>
      const beat = Number(o.beat)
      const value = Number(o.value)
      if (!Number.isFinite(beat) || !Number.isFinite(value)) return null
      const shape = o.shape === 'hold' || o.shape === 'exp' ? o.shape : undefined
      const pt: AutoPoint = { beat: Math.min(1e5, Math.max(0, beat)), value: Math.min(max, Math.max(min, value)) }
      if (shape) pt.shape = shape
      return pt
    })
    .filter((p): p is AutoPoint => p !== null)
    .sort((a, b) => a.beat - b.beat)
}

function migrateWarp(raw: unknown): WarpMode {
  if (raw === 'repitch' || raw === 'stretch' || raw === 'off') return raw
  return raw === true ? 'repitch' : 'off' // v3 boolean → mode
}

function migrateClip(raw: unknown): Clip | null {
  const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const rawLength = Number(c.length)
  if (!Number.isFinite(rawLength) || rawLength <= 0) return null
  const length = clamp(rawLength, 0.25, 1024, 1)
  const notes = Array.isArray(c.notes) ? c.notes : []
  const audioRaw = (typeof c.audio === 'object' && c.audio !== null ? c.audio : null) as Record<string, unknown> | null
  const audio: AudioRegion | undefined =
    audioRaw && typeof audioRaw.sampleId === 'string' && audioRaw.sampleId
      ? {
          sampleId: audioRaw.sampleId,
          offsetSec: clamp(audioRaw.offsetSec, 0, 3600, 0),
          gain: clamp(audioRaw.gain, 0, 2, 1),
          warp: migrateWarp(audioRaw.warp),
          origBpm: clamp(audioRaw.origBpm, 40, 240, 120),
          fadeIn: clamp(audioRaw.fadeIn, 0, 1024, 0),
          fadeOut: clamp(audioRaw.fadeOut, 0, 1024, 0),
        }
      : undefined
  return {
    id: typeof c.id === 'string' && c.id ? c.id : newId(),
    start: clamp(c.start, 0, 1e5, 0),
    length,
    notes: notes.slice(0, 4096).map(n => {
      const note = (typeof n === 'object' && n !== null ? n : {}) as Record<string, unknown>
      return {
        start: clamp(note.start, 0, 1024, 0),
        dur: clamp(note.dur, 1 / 32, 256, 0.25),
        pitch: Math.round(clamp(note.pitch, 0, 127, 60)),
        vel: clamp(note.vel, 0.01, 1, 0.8),
      }
    }),
    ...(audio ? { audio } : {}),
  }
}
