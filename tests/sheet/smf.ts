// A small Standard MIDI File writer for the sheet tests: format 1, a conductor
// track (title, tempo, time and key signature) and one track per part.

export interface SmfTrack {
  name?: string
  channel?: number // 9 = drums
  /** [start, length, pitch], in quarter notes */
  notes: [number, number, number][]
}
export interface SmfOptions {
  title?: string
  bpm?: number
  /** numerator and the denominator's power of two, as MIDI stores it: [6, 3] = 6/8 */
  meter?: [number, number]
  /** sharps (negative = flats) and 1 for minor */
  key?: [number, 0 | 1]
}

const PPQ = 480

function vlq(v: number): number[] {
  const out = [v & 0x7f]
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80)
  return out
}
const text = (type: number, s: string): number[] => [0xff, type, s.length, ...[...s].map(c => c.charCodeAt(0))]

function chunk(events: [number, number[]][]): number[] {
  const sorted = [...events].sort((a, b) => a[0] - b[0]) // stable: offs stay before ons at the same tick
  const data: number[] = []
  let last = 0
  for (const [tick, bytes] of sorted) {
    data.push(...vlq(tick - last), ...bytes)
    last = tick
  }
  data.push(0, 0xff, 0x2f, 0)
  const n = data.length
  return [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...data]
}

export function smf(tracks: SmfTrack[], o: SmfOptions = {}): Uint8Array {
  const conductor: [number, number[]][] = []
  if (o.title) conductor.push([0, text(0x03, o.title)])
  const us = Math.round(60_000_000 / (o.bpm ?? 120))
  conductor.push([0, [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255]])
  if (o.meter) conductor.push([0, [0xff, 0x58, 4, o.meter[0], o.meter[1], 24, 8]])
  if (o.key) conductor.push([0, [0xff, 0x59, 2, o.key[0] & 0xff, o.key[1]]])
  const chunks = [chunk(conductor)]
  for (const t of tracks) {
    const ch = t.channel ?? 0
    const offs: [number, number[]][] = [], ons: [number, number[]][] = []
    for (const [start, dur, pitch] of t.notes) {
      ons.push([Math.round(start * PPQ), [0x90 | ch, pitch, 90]])
      offs.push([Math.round((start + dur) * PPQ), [0x80 | ch, pitch, 0]])
    }
    chunks.push(chunk([...(t.name ? [[0, text(0x03, t.name)] as [number, number[]]] : []), ...offs, ...ons]))
  }
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, chunks.length, PPQ >> 8, PPQ & 255]
  return new Uint8Array([...head, ...chunks.flat()])
}
