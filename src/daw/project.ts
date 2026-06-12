// Tracks project schema. Everything musical is in BEATS so tempo changes
// re-time the whole song; conversion to seconds happens only at scheduling.

import { buildPresetPatch, PRESETS } from '../patch/presets'
import { defaultPatch, migrate, type Patch } from '../patch/schema'

export const PROJECT_VERSION = 1

export interface Note {
  start: number // beats, relative to clip start
  dur: number // beats
  pitch: number // MIDI
  vel: number // 0..1
}

export interface Clip {
  id: string
  start: number // beats, on the song timeline
  length: number // beats
  notes: Note[]
}

export interface TrackData {
  id: string
  name: string
  patch: Patch
  mixer: { volume: number; pan: number; mute: boolean; solo: boolean }
  clips: Clip[]
}

export interface Project {
  v: typeof PROJECT_VERSION
  name: string
  bpm: number
  loop: { on: boolean; start: number; end: number } // beats
  tracks: TrackData[]
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : `i${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
}

export function newTrack(name: string, presetName?: string): TrackData {
  const def = presetName ? PRESETS.find(p => p.name === presetName) : undefined
  return {
    id: newId(),
    name,
    patch: def ? buildPresetPatch(def) : defaultPatch(),
    mixer: { volume: 0.8, pan: 0, mute: false, solo: false },
    clips: [],
  }
}

export function defaultProject(): Project {
  return {
    v: PROJECT_VERSION,
    name: 'Untitled',
    bpm: 120,
    loop: { on: false, start: 0, end: 16 },
    tracks: [
      newTrack('Bass', 'Fat Saw'),
      newTrack('Keys', 'EP Glow'),
      newTrack('Lead', 'Retro Solo'),
      newTrack('Pad', 'Warm Pad'),
    ],
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

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// Accepts parsed JSON; returns a valid Project or throws.
export function migrateProject(raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) throw new Error('not a project')
  const p = raw as Record<string, unknown>
  if (p.v !== PROJECT_VERSION) throw new Error(`unsupported project version: ${String(p.v)}`)

  const tracks = Array.isArray(p.tracks) ? p.tracks : []
  const loop = (typeof p.loop === 'object' && p.loop !== null ? p.loop : {}) as Record<string, unknown>

  return {
    v: PROJECT_VERSION,
    name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, 60) : 'Untitled',
    bpm: clamp(p.bpm, 40, 240, 120),
    loop: {
      on: Boolean(loop.on),
      start: clamp(loop.start, 0, 1e5, 0),
      end: clamp(loop.end, 1, 1e5, 16),
    },
    tracks: tracks.slice(0, 16).map((t, i) => migrateTrack(t, i)),
  }
}

function migrateTrack(raw: unknown, index: number): TrackData {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const mixer = (typeof t.mixer === 'object' && t.mixer !== null ? t.mixer : {}) as Record<string, unknown>
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
    patch,
    mixer: {
      volume: clamp(mixer.volume, 0, 1, 0.8),
      pan: clamp(mixer.pan, -1, 1, 0),
      mute: Boolean(mixer.mute),
      solo: Boolean(mixer.solo),
    },
    clips: clips.slice(0, 256).map(migrateClip).filter((c): c is Clip => c !== null),
  }
}

function migrateClip(raw: unknown): Clip | null {
  const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const rawLength = Number(c.length)
  if (!Number.isFinite(rawLength) || rawLength <= 0) return null
  const length = clamp(rawLength, 0.25, 1024, 1)
  const notes = Array.isArray(c.notes) ? c.notes : []
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
  }
}
