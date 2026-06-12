// Project persistence: autosaved session, .json download/import, demo song.

import type { DawApp } from './daw-app'
import { migrateProject, newId, type Clip, type Note, type Project, defaultProject } from './project'

const SESSION_KEY = 'tracks.session.v1'

export function saveSession(app: DawApp): void {
  try {
    app.song?.collectPatches(app.project)
    localStorage.setItem(SESSION_KEY, JSON.stringify(app.project))
  } catch {
    // best-effort
  }
}

export function loadSession(): Project | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? migrateProject(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function downloadProjectJson(app: DawApp): void {
  app.song?.collectPatches(app.project)
  const blob = new Blob([JSON.stringify(app.project, null, 1)], { type: 'application/json' })
  downloadBlob(blob, `${app.project.name.replaceAll(/\W+/g, '-') || 'tracks'}.tracks.json`)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function importProjectJson(file: File): Promise<Project> {
  return file.text().then(text => migrateProject(JSON.parse(text)))
}

// ---------- demo song: 8 bars, four tracks ----------

const PROG = [
  { root: 33, chord: [57, 60, 64] }, // Am
  { root: 29, chord: [57, 60, 65] }, // F
  { root: 36, chord: [55, 60, 64] }, // C
  { root: 31, chord: [55, 59, 62] }, // G
]

export function demoSong(): Project {
  const p = defaultProject()
  p.name = 'First Light (demo)'
  p.bpm = 112
  p.loop = { on: true, start: 0, end: 32 }

  const clip = (notes: Note[], length = 32): Clip => ({ id: newId(), start: 0, length, notes })

  // bass: driving 8ths, root + octave accents
  const bass: Note[] = []
  for (let bar = 0; bar < 8; bar++) {
    const root = PROG[Math.floor(bar / 2) % 4].root
    for (let e = 0; e < 8; e++) {
      bass.push({
        start: bar * 4 + e * 0.5,
        dur: 0.45,
        pitch: e === 6 ? root + 12 : root,
        vel: e % 2 === 0 ? 0.9 : 0.65,
      })
    }
  }
  p.tracks[0].clips = [clip(bass)]

  // keys: offbeat chord stabs
  const keys: Note[] = []
  for (let bar = 0; bar < 8; bar++) {
    const chord = PROG[Math.floor(bar / 2) % 4].chord
    for (const beat of [1, 2.5, 3]) {
      for (const pitch of chord) {
        keys.push({ start: bar * 4 + beat, dur: 0.4, pitch, vel: 0.7 })
      }
    }
  }
  p.tracks[1].clips = [clip(keys)]

  // lead: enters halfway, simple call-and-answer
  const melody: [number, number, number][] = [
    [16, 69, 1], [17, 72, 0.5], [17.5, 71, 0.5], [18, 69, 1.5], [20, 64, 1.5],
    [22, 65, 0.5], [22.5, 67, 0.5], [23, 69, 1],
    [24, 72, 1], [25.5, 71, 0.5], [26, 69, 1], [27.5, 67, 0.5],
    [28, 64, 2], [30, 62, 0.75], [31, 60, 1],
  ]
  p.tracks[2].clips = [clip(melody.map(([start, pitch, dur]) => ({ start, dur, pitch, vel: 0.85 })))]

  // pad: held chords, one per 2 bars
  const pad: Note[] = []
  for (let seg = 0; seg < 4; seg++) {
    for (const pitch of PROG[seg].chord) {
      pad.push({ start: seg * 8, dur: 7.8, pitch: pitch - 12, vel: 0.6 })
    }
  }
  p.tracks[3].clips = [clip(pad)]

  return p
}
