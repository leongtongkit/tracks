// Project persistence: autosaved session, .json download/import, demo song.

import { decodeWav, encodeWav } from '../record/wav'
import type { DawApp } from './daw-app'
import { migrateProject, newId, newTrack, pruneSamples, type Clip, type Note, type Project, defaultProject } from './project'
import { sampleStore } from './samples'

const SESSION_KEY = 'tracks.session.v1'

export function saveSession(app: DawApp): void {
  try {
    app.song?.collectPatches(app.project)
    pruneSamples(app.project)
    // sample binaries persist separately in IndexedDB; this is metadata only
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

// Project files embed every referenced sample as base64 WAV so a .tracks.json
// is fully self-contained — recordings and imports travel with the song.
export function downloadProjectJson(app: DawApp): void {
  app.song?.collectPatches(app.project)
  pruneSamples(app.project)
  const out = JSON.parse(JSON.stringify(app.project)) as Project & {
    samples: Record<string, { name: string; duration: number; wav?: string }>
  }
  for (const [id, meta] of Object.entries(out.samples)) {
    const buffer = sampleStore.get(id)
    if (!buffer) continue
    const left = buffer.getChannelData(0)
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
    meta.wav = bufToB64(encodeWav(left, right, buffer.sampleRate))
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' })
  downloadBlob(blob, `${app.project.name.replaceAll(/\W+/g, '-') || 'tracks'}.tracks.json`)
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  const STEP = 0x8000
  for (let i = 0; i < bytes.length; i += STEP) {
    s += String.fromCharCode(...bytes.subarray(i, i + STEP))
  }
  return btoa(s)
}

function b64ToBuf(s: string): ArrayBuffer {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export async function importProjectJson(file: File): Promise<Project> {
  const raw = JSON.parse(await file.text()) as Record<string, unknown>
  // rebuild embedded samples BEFORE migrate (which keeps metadata only)
  const samples = raw && typeof raw === 'object' ? (raw.samples as Record<string, { name?: string; wav?: string }> | undefined) : undefined
  if (samples && typeof samples === 'object') {
    for (const [id, meta] of Object.entries(samples)) {
      if (sampleStore.has(id) || typeof meta?.wav !== 'string') continue
      try {
        const { left, right, sampleRate } = decodeWav(b64ToBuf(meta.wav))
        const buffer = new AudioBuffer({ length: left.length, numberOfChannels: 2, sampleRate })
        buffer.copyToChannel(left, 0)
        buffer.copyToChannel(right, 1)
        sampleStore.put(id, typeof meta.name === 'string' ? meta.name : 'sample', buffer)
      } catch {
        // corrupt sample; the clip will import silent rather than failing the project
      }
    }
  }
  return migrateProject(raw)
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

  // drums: four-on-the-floor 808 with offbeat hats, snare on 2 & 4
  const drumTrack = newTrack('Drums', { kind: 'drums' })
  const dn: Note[] = []
  for (let bar = 0; bar < 8; bar++) {
    const at = bar * 4
    for (let b = 0; b < 4; b++) {
      dn.push({ start: at + b, dur: 0.25, pitch: 36, vel: b === 0 ? 1 : 0.85 }) // kick
      dn.push({ start: at + b + 0.5, dur: 0.25, pitch: 42, vel: 0.5 }) // offbeat hat
      if (b === 1 || b === 3) dn.push({ start: at + b, dur: 0.25, pitch: 38, vel: 0.8 }) // snare
    }
    if (bar % 2 === 1) dn.push({ start: at + 3.75, dur: 0.25, pitch: 46, vel: 0.55 }) // open-hat pickup
    if (bar === 3 || bar === 7) dn.push({ start: at + 3.5, dur: 0.25, pitch: 39, vel: 0.7 }) // clap fill
  }
  drumTrack.clips = [clip(dn)]
  p.tracks.push(drumTrack)

  return p
}
