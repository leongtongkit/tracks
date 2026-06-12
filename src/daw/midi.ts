// Standard MIDI File (format 1) export of every note track. Drum tracks land
// on channel 10 (GM percussion); everything else gets its own melodic channel.

import { projectEndBeat, type Project } from './project'
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
