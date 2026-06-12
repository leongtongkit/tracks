// Standard MIDI File (format 1) export of every note track. Drum tracks land
// on channel 10 (GM percussion); everything else gets its own melodic channel.

import { defaultProject, migrateProject, newId, newTrack, projectEndBeat, type Project } from './project'
import { collectEvents } from './transport'

const PPQ = 480

export function exportMidi(project: Project): Uint8Array {
  const chunks: Uint8Array[] = []

  // conductor track: tempo only
  const conductor: number[] = []
  pushVarLen(conductor, 0)
  const usPerBeat = Math.round(60_000_000 / project.bpm)
  conductor.push(0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff)
  endTrack(conductor)
  chunks.push(trackChunk(conductor))

  const endBeat = projectEndBeat(project)
  let melodicCh = 0
  for (const track of project.tracks) {
    const events = collectEvents([track], 0, endBeat)
    if (events.length === 0) continue
    let channel: number
    if (track.kind === 'drums') {
      channel = 9
    } else {
      channel = melodicCh
      melodicCh = (melodicCh + 1) % 16
      if (melodicCh === 9) melodicCh++ // never hand a melodic part the drum channel
    }

    // absolute-tick on/off list
    const evs: { tick: number; on: boolean; pitch: number; vel: number }[] = []
    for (const e of events) {
      const tick = Math.round(e.startBeat * PPQ)
      const off = Math.round((e.startBeat + e.durBeats) * PPQ)
      evs.push({ tick, on: true, pitch: e.pitch, vel: Math.max(1, Math.min(127, Math.round(e.vel * 127))) })
      evs.push({ tick: Math.max(tick + 1, off), on: false, pitch: e.pitch, vel: 0 })
    }
    evs.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on)) // offs before ons at the same tick

    const data: number[] = []
    pushVarLen(data, 0)
    const nameBytes = [...track.name].map(c => c.charCodeAt(0) & 0x7f)
    data.push(0xff, 0x03, nameBytes.length, ...nameBytes)
    let lastTick = 0
    for (const e of evs) {
      pushVarLen(data, e.tick - lastTick)
      lastTick = e.tick
      data.push((e.on ? 0x90 : 0x80) | channel, e.pitch & 0x7f, e.vel & 0x7f)
    }
    endTrack(data)
    chunks.push(trackChunk(data))
  }

  const header = new Uint8Array(14)
  const hv = new DataView(header.buffer)
  header.set([0x4d, 0x54, 0x68, 0x64]) // MThd
  hv.setUint32(4, 6)
  hv.setUint16(8, 1) // format 1
  hv.setUint16(10, chunks.length)
  hv.setUint16(12, PPQ)

  const total = 14 + chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  out.set(header)
  let off = 14
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

// ---------- import ----------

// Parse a standard MIDI file (format 0/1, PPQ division) into a Project:
// one track per MTrk with notes, drums for channel-10 parts, tempo applied.
export function importMidi(bytes: Uint8Array): Project {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (ascii(bytes, 0, 4) !== 'MThd') throw new Error('not a MIDI file')
  const ntrks = view.getUint16(10)
  const division = view.getUint16(12)
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported')
  const ppq = division || 480

  const project = defaultProject()
  project.tracks = []
  project.name = 'Imported MIDI'
  let tempoSet = false

  let off = 14
  for (let t = 0; t < ntrks && off + 8 <= bytes.length; t++) {
    if (ascii(bytes, off, 4) !== 'MTrk') break
    const len = view.getUint32(off + 4)
    const end = off + 8 + len
    let p = off + 8
    let tick = 0
    let running = 0
    let name = ''
    const open = new Map<string, { tick: number; vel: number }>()
    const notes: { start: number; dur: number; pitch: number; vel: number }[] = []
    let drumNotes = 0

    const readVar = (): number => {
      let v = 0
      let b
      do {
        b = bytes[p++]
        v = (v << 7) | (b & 0x7f)
      } while (b & 0x80 && p < end)
      return v
    }

    while (p < end) {
      tick += readVar()
      let status = bytes[p]
      if (status & 0x80) p++
      else status = running // running status reuses the previous status byte
      running = status

      if (status === 0xff) {
        const type = bytes[p++]
        const mlen = readVar()
        if (type === 0x03 && !name) name = ascii(bytes, p, Math.min(mlen, 24))
        if (type === 0x51 && mlen === 3 && !tempoSet) {
          const us = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]
          project.bpm = Math.min(240, Math.max(40, Math.round(60_000_000 / us)))
          tempoSet = true
        }
        p += mlen
        continue
      }
      if (status === 0xf0 || status === 0xf7) {
        p += readVar()
        continue
      }
      const kind = status & 0xf0
      const channel = status & 0x0f
      const d1 = bytes[p++]
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[p++]
      if (kind === 0x90 && d2 > 0) {
        open.set(`${channel}:${d1}`, { tick, vel: d2 })
        if (channel === 9) drumNotes++
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        const key = `${channel}:${d1}`
        const on = open.get(key)
        if (on) {
          open.delete(key)
          notes.push({
            start: on.tick / ppq,
            dur: Math.max(1 / 32, (tick - on.tick) / ppq),
            pitch: d1,
            vel: Math.max(0.05, on.vel / 127),
          })
        }
      }
    }
    off = end

    if (notes.length === 0) continue
    const isDrums = drumNotes > notes.length / 2
    const track = newTrack(name || (isDrums ? 'Drums' : `MIDI ${project.tracks.length + 1}`), {
      kind: isDrums ? 'drums' : 'synth',
    })
    const span = Math.max(4, Math.ceil(Math.max(...notes.map(n => n.start + n.dur)) / 4) * 4)
    track.clips = [{ id: newId(), start: 0, length: span, notes }]
    project.tracks.push(track)
    if (project.tracks.length >= 24) break
  }

  if (project.tracks.length === 0) throw new Error('no notes found in that MIDI file')
  return migrateProject(JSON.parse(JSON.stringify(project)))
}

function ascii(bytes: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(off, off + len))
}

function endTrack(data: number[]): void {
  pushVarLen(data, 0)
  data.push(0xff, 0x2f, 0x00)
}

function trackChunk(data: number[]): Uint8Array {
  const out = new Uint8Array(8 + data.length)
  out.set([0x4d, 0x54, 0x72, 0x6b]) // MTrk
  new DataView(out.buffer).setUint32(4, data.length)
  out.set(data, 8)
  return out
}

function pushVarLen(data: number[], value: number): void {
  let v = Math.max(0, Math.round(value))
  const bytes = [v & 0x7f]
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80)
  data.push(...bytes)
}
