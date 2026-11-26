// Starter songs: each opens ready to play, loops over its notes, and is fully
// editable. Only built-in synth presets and the drum machine are used, so
// nothing needs to download.

import { defaultProject, newId, newTrack, type Clip, type Note, type Project, type TrackData } from './project'

export type TemplateId = 'lofi' | 'house' | 'hiphop' | 'rock' | 'game'

export const TEMPLATE_IDS: readonly TemplateId[] = ['lofi', 'house', 'hiphop', 'rock', 'game']

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  lofi: 'Lo-fi',
  house: 'House',
  hiphop: 'Hip-hop',
  rock: 'Rock',
  game: 'Game music',
}

export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === 'string' && (TEMPLATE_IDS as readonly string[]).includes(v)
}

const KICK = 36
const SNARE = 38
const CLAP = 39
const HAT = 42
const HAT_OPEN = 46
const CRASH = 49

const BARS = 8
const LEN = BARS * 4

interface Bar {
  root: number
  chord: number[]
}

function note(start: number, pitch: number, dur: number, vel: number): Note {
  return { start, dur, pitch, vel }
}

function synth(name: string, preset: string, notes: Note[], volume?: number): TrackData {
  const t = newTrack(name, { preset })
  const clip: Clip = { id: newId(), start: 0, length: LEN, notes }
  t.clips = [clip]
  if (volume !== undefined) t.mixer.volume = volume
  return t
}

function drums(kit: '808' | '909', notes: Note[], volume?: number): TrackData {
  const t = newTrack('Drums', { kind: 'drums' })
  t.drums.kit = kit
  t.clips = [{ id: newId(), start: 0, length: LEN, notes }]
  if (volume !== undefined) t.mixer.volume = volume
  return t
}

function build(name: string, bpm: number, key: { root: number; scale: 'major' | 'minor' }, tracks: TrackData[]): Project {
  const p = defaultProject()
  p.name = name
  p.bpm = bpm
  p.key = key
  p.loop = { on: true, start: 0, end: LEN }
  p.tracks = tracks
  return p
}

// one entry per bar, then notes from a per-bar function
function perBar(bars: Bar[], fn: (bar: Bar, at: number, i: number) => Note[]): Note[] {
  return bars.flatMap((bar, i) => fn(bar, i * 4, i))
}

function repeat(phrase: Note[], every: number, times: number): Note[] {
  const out: Note[] = []
  for (let k = 0; k < times; k++) for (const n of phrase) out.push({ ...n, start: n.start + k * every })
  return out
}

export function lofiSong(): Project {
  const dm7 = { root: 50, chord: [57, 60, 62, 65] }
  const g7 = { root: 55, chord: [55, 59, 62, 65] }
  const cmaj7 = { root: 48, chord: [55, 59, 60, 64] }
  const am7 = { root: 45, chord: [57, 60, 64, 67] }
  const bars = [dm7, g7, cmaj7, am7, dm7, g7, cmaj7, am7]

  const keys = perBar(bars, (b, at) => [
    ...b.chord.map(p => note(at, p, 1.5, 0.55)),
    ...b.chord.map(p => note(at + 2.5, p, 1.2, 0.42)),
  ])
  const bass = perBar(bars, (b, at) => [
    note(at, b.root, 1.4, 0.85),
    note(at + 2.5, b.root, 0.9, 0.7),
    note(at + 3.5, b.root + 7, 0.4, 0.55),
  ])
  const pad = perBar(bars, (b, at) => b.chord.map(p => note(at, p, 3.9, 0.32)))
  const dr = perBar(bars, (_b, at, i) => {
    const out = [
      note(at, KICK, 0.25, 0.95),
      note(at + 1.75, KICK, 0.25, 0.7),
      note(at + 2.5, KICK, 0.25, 0.8),
      note(at + 1.05, SNARE, 0.25, 0.7),
      note(at + 3.05, SNARE, 0.25, 0.7),
    ]
    for (let b = 0; b < 4; b++) {
      out.push(note(at + b, HAT, 0.2, 0.45))
      out.push(note(at + b + 0.58, HAT, 0.2, 0.28)) // swung offbeat
    }
    if (i % 4 === 3) out.push(note(at + 3.5, HAT_OPEN, 0.25, 0.4))
    return out
  })
  return build('Lo-fi sketch', 80, { root: 0, scale: 'major' }, [
    synth('Keys', 'EP Glow', keys, 0.75),
    synth('Bass', 'Upright Bass', bass),
    synth('Pad', 'Warm Pad', pad, 0.5),
    drums('808', dr, 0.8),
  ])
}

export function houseSong(): Project {
  const am = { root: 45, chord: [57, 60, 64] }
  const f = { root: 41, chord: [57, 60, 65] }
  const g = { root: 43, chord: [55, 59, 62] }
  const bars = [am, am, f, g, am, am, f, g]

  const stabs = perBar(bars, (b, at) =>
    [0, 0.75, 1.5, 2.5, 3.25].flatMap(beat => b.chord.map(p => note(at + beat, p, 0.25, 0.65))),
  )
  const bass = perBar(bars, (b, at) => [0, 1, 2, 3].map(beat => note(at + beat + 0.5, b.root, 0.4, 0.85)))
  const dr = perBar(bars, (_b, at, i) => {
    const out: Note[] = []
    for (let b = 0; b < 4; b++) {
      out.push(note(at + b, KICK, 0.25, 1))
      out.push(note(at + b + 0.5, HAT_OPEN, 0.25, 0.6))
      out.push(note(at + b + 0.25, HAT, 0.15, 0.25))
      out.push(note(at + b + 0.75, HAT, 0.15, 0.25))
      if (b === 1 || b === 3) out.push(note(at + b, CLAP, 0.25, 0.85))
    }
    if (i % 4 === 0) out.push(note(at, CRASH, 0.5, 0.5))
    return out
  })
  return build('House sketch', 124, { root: 9, scale: 'minor' }, [
    synth('Chords', 'House Stab', stabs, 0.7),
    synth('Bass', 'Fat Saw', bass),
    drums('909', dr, 0.85),
  ])
}

export function hiphopSong(): Project {
  const cm = { root: 60, chord: [63, 67, 70, 72] }
  const ab = { root: 56, chord: [60, 63, 68, 72] }
  const g = { root: 55, chord: [62, 67, 71, 74] }
  const bars = [cm, cm, ab, g, cm, cm, ab, g]

  const keys = perBar(bars, (b, at) => b.chord.map(p => note(at, p, 2.8, 0.5)))
  const bass = perBar(bars, (b, at, i) => [
    note(at, b.root, 1.5, 0.9),
    note(at + 1.75, b.root, 0.5, 0.7),
    note(at + (i % 2 ? 3 : 2.5), b.root, 0.75, 0.8),
  ])
  const hookPhrase = [
    note(0, 79, 0.5, 0.75), note(0.5, 77, 0.5, 0.65), note(1, 75, 1, 0.75),
    note(2.5, 72, 0.5, 0.65), note(3, 75, 0.5, 0.7), note(4, 77, 1, 0.75),
    note(5.5, 75, 0.5, 0.65), note(6, 72, 1.5, 0.75),
  ]
  const hook = repeat(hookPhrase, 8, 4)
  const dr = perBar(bars, (_b, at, i) => {
    const out = [
      note(at, KICK, 0.25, 1),
      note(at + 1.75, KICK, 0.25, 0.75),
      note(at + (i % 2 ? 2.75 : 2.5), KICK, 0.25, 0.85),
      note(at + 1, SNARE, 0.25, 0.9),
      note(at + 3, SNARE, 0.25, 0.9),
    ]
    for (let e = 0; e < 8; e++) out.push(note(at + e * 0.5, HAT, 0.2, e % 2 ? 0.35 : 0.5))
    return out
  })
  return build('Hip-hop sketch', 90, { root: 0, scale: 'minor' }, [
    synth('Keys', 'EP Glow', keys, 0.7),
    synth('Hook', 'Kalimba', hook, 0.75),
    synth('Bass', 'Sub Sine', bass, 0.9),
    drums('808', dr, 0.85),
  ])
}

export function rockSong(): Project {
  const e5 = { root: 52, chord: [52, 59, 64] }
  const g5 = { root: 55, chord: [55, 62, 67] }
  const d5 = { root: 50, chord: [50, 57, 62] }
  const a5 = { root: 57, chord: [57, 64, 69] }
  const bars = [e5, e5, g5, d5, e5, e5, g5, a5]

  const power = perBar(bars, (b, at) =>
    Array.from({ length: 8 }, (_, e) => e).flatMap(e => b.chord.map(p => note(at + e * 0.5, p, 0.4, e % 2 ? 0.6 : 0.8))),
  )
  const bass = perBar(bars, (b, at) =>
    Array.from({ length: 8 }, (_, e) => note(at + e * 0.5, b.root, 0.45, e % 2 ? 0.7 : 0.9)),
  )
  const lead = [
    note(16, 76, 1, 0.8), note(17, 79, 1, 0.8), note(18, 81, 1.5, 0.85), note(19.5, 79, 0.5, 0.75),
    note(20, 76, 2, 0.8), note(22, 74, 1, 0.75), note(23, 76, 1, 0.8),
    note(24, 79, 1, 0.8), note(25, 81, 1, 0.8), note(26, 83, 1.5, 0.9), note(27.5, 81, 0.5, 0.75),
    note(28, 79, 1, 0.8), note(29, 76, 1, 0.75), note(30, 74, 1, 0.75), note(31, 76, 1, 0.8),
  ]
  const dr = perBar(bars, (_b, at, i) => {
    const out = [
      note(at, KICK, 0.25, 1),
      note(at + 2, KICK, 0.25, 0.9),
      note(at + (i % 2 ? 3.5 : 2.5), KICK, 0.25, 0.7),
      note(at + 1, SNARE, 0.25, 0.95),
      note(at + 3, SNARE, 0.25, 0.95),
    ]
    for (let e = 0; e < 8; e++) out.push(note(at + e * 0.5, HAT, 0.2, e % 2 ? 0.4 : 0.6))
    if (i % 4 === 0) out.push(note(at, CRASH, 0.5, 0.7))
    return out
  })
  return build('Rock sketch', 120, { root: 4, scale: 'minor' }, [
    synth('Guitar', 'Fifth Stack', power, 0.6),
    synth('Bass', 'Square Growl', bass, 0.8),
    synth('Lead', 'Retro Solo', lead, 0.7),
    drums('909', dr, 0.85),
  ])
}

export function gameSong(): Project {
  const am = { root: 45, chord: [57, 60, 64] }
  const f = { root: 41, chord: [57, 60, 65] }
  const c = { root: 48, chord: [60, 64, 67] }
  const g = { root: 43, chord: [59, 62, 67] }
  const bars = [am, f, c, g, am, f, c, g]

  const phrase = [
    note(0, 81, 0.5, 0.85), note(0.5, 79, 0.5, 0.8), note(1, 76, 1, 0.85),
    note(2, 79, 0.5, 0.8), note(2.5, 81, 0.5, 0.8), note(3, 84, 1, 0.9),
    note(4, 81, 0.5, 0.85), note(4.5, 77, 0.5, 0.8), note(5, 81, 1, 0.85),
    note(6, 79, 1, 0.8), note(7, 77, 1, 0.8),
    note(8, 79, 0.5, 0.85), note(8.5, 76, 0.5, 0.8), note(9, 79, 1, 0.85),
    note(10, 84, 1, 0.9), note(11, 79, 1, 0.8),
    note(12, 83, 0.5, 0.85), note(12.5, 79, 0.5, 0.8), note(13, 74, 1, 0.85),
    note(14, 79, 2, 0.85),
  ]
  const lead = repeat(phrase, 16, 2)
  const arp = perBar(bars, (b, at) =>
    Array.from({ length: 16 }, (_, s) => note(at + s * 0.25, b.chord[[0, 1, 2, 1][s % 4]] + 12, 0.2, s % 4 === 0 ? 0.6 : 0.4)),
  )
  const bass = perBar(bars, (b, at) =>
    Array.from({ length: 8 }, (_, e) => note(at + e * 0.5, e % 2 ? b.root + 12 : b.root, 0.4, e % 2 ? 0.6 : 0.85)),
  )
  const dr = perBar(bars, (_b, at) => {
    const out = [
      note(at, KICK, 0.25, 0.85),
      note(at + 2, KICK, 0.25, 0.8),
      note(at + 1, SNARE, 0.25, 0.55),
      note(at + 3, SNARE, 0.25, 0.55),
    ]
    for (let e = 0; e < 8; e++) out.push(note(at + e * 0.5, HAT, 0.15, 0.3))
    return out
  })
  return build('Game music sketch', 140, { root: 9, scale: 'minor' }, [
    synth('Lead', 'Chip Square', lead, 0.65),
    synth('Arp', 'Pop Pluck', arp, 0.5),
    synth('Bass', 'Square Growl', bass, 0.8),
    drums('808', dr, 0.7),
  ])
}

const BUILDERS: Record<TemplateId, () => Project> = {
  lofi: lofiSong,
  house: houseSong,
  hiphop: hiphopSong,
  rock: rockSong,
  game: gameSong,
}

export function buildTemplate(id: TemplateId): Project {
  return BUILDERS[id]()
}

export function emptySong(): Project {
  const p = defaultProject()
  for (const t of p.tracks) t.clips = []
  p.name = 'Untitled'
  return p
}
