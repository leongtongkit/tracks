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

export type TrackKind = 'synth' | 'drums' | 'sampler' | 'pads' | 'audio'

export interface Note {
  start: number // beats, relative to clip start
  dur: number // beats
  pitch: number // MIDI
  vel: number // 0..1
}

// An audio clip references a sample in the SampleStore.
export interface AudioRegion {
  sampleId: string
  offsetSec: number // where in the sample this clip starts
  gain: number // 0..2 linear
}

export interface Clip {
  id: string
  start: number // beats, on the song timeline
  length: number // beats
  notes: Note[]
  audio?: AudioRegion
}

export interface AutoPoint {
  beat: number
  value: number
}

export interface Automation {
  volume: AutoPoint[] // 0..1; empty = no automation
  pan: AutoPoint[] // -1..1
}

export interface MixerState {
  volume: number
  pan: number
  mute: boolean
  solo: boolean
  eq: { low: number; mid: number; high: number } // dB, -12..12
  comp: { on: boolean; threshold: number; ratio: number; attack: number; release: number; makeup: number }
  sendA: number // 0..1 to the reverb bus
  sendB: number // 0..1 to the delay bus
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
  mixer: MixerState
  auto: Automation
  clips: Clip[]
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

export interface Project {
  v: typeof PROJECT_VERSION
  name: string
  bpm: number
  key: KeySig
  loop: { on: boolean; start: number; end: number } // beats
  tracks: TrackData[]
  samples: Record<string, SampleMeta>
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
    eq: { low: 0, mid: 0, high: 0 },
    comp: { on: false, threshold: -18, ratio: 3, attack: 0.01, release: 0.18, makeup: 1 },
    sendA: 0,
    sendB: 0,
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
    mixer: defaultMixer(),
    auto: { volume: [], pan: [] },
    clips: [],
  }
}

export function defaultProject(): Project {
  return {
    v: PROJECT_VERSION,
    name: 'Untitled',
    bpm: 120,
    key: { root: 0, scale: 'chromatic' },
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

const KINDS: TrackKind[] = ['synth', 'drums', 'sampler', 'pads', 'audio']
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
  const eq = (typeof mixer.eq === 'object' && mixer.eq !== null ? mixer.eq : {}) as Record<string, unknown>
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
    mixer: {
      volume: clamp(mixer.volume, 0, 1, 0.8),
      pan: clamp(mixer.pan, -1, 1, 0),
      mute: Boolean(mixer.mute),
      solo: Boolean(mixer.solo),
      eq: {
        low: clamp(eq.low, -12, 12, 0),
        mid: clamp(eq.mid, -12, 12, 0),
        high: clamp(eq.high, -12, 12, 0),
      },
      comp: {
        on: Boolean(comp.on),
        threshold: clamp(comp.threshold, -60, 0, -18),
        ratio: clamp(comp.ratio, 1, 20, 3),
        attack: clamp(comp.attack, 0.001, 0.3, 0.01),
        release: clamp(comp.release, 0.02, 1, 0.18),
        makeup: clamp(comp.makeup, 0.25, 4, 1),
      },
      sendA: clamp(mixer.sendA, 0, 1, 0),
      sendB: clamp(mixer.sendB, 0, 1, 0),
    },
    auto: {
      volume: migrateAutoPoints(auto.volume, 0, 1),
      pan: migrateAutoPoints(auto.pan, -1, 1),
    },
    clips: clips.slice(0, 256).map(migrateClip).filter((c): c is Clip => c !== null),
  }
}

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
      return { beat: Math.min(1e5, Math.max(0, beat)), value: Math.min(max, Math.max(min, value)) }
    })
    .filter((p): p is AutoPoint => p !== null)
    .sort((a, b) => a.beat - b.beat)
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
