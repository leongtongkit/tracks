import { describe, expect, it } from 'vitest'
import { exportMidi } from './midi'
import { defaultProject } from './project'

function ascii(bytes: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(off, off + len))
}

describe('midi export', () => {
  it('writes a valid format-1 file with conductor + one track per note track', () => {
    const p = defaultProject()
    p.bpm = 120
    p.tracks[0].clips = [{
      id: 'c', start: 0, length: 4,
      notes: [
        { start: 0, dur: 1, pitch: 60, vel: 0.8 },
        { start: 2, dur: 0.5, pitch: 64, vel: 1 },
      ],
    }]
    const bytes = exportMidi(p)
    expect(ascii(bytes, 0, 4)).toBe('MThd')
    const dv = new DataView(bytes.buffer)
    expect(dv.getUint16(8)).toBe(1) // format 1
    expect(dv.getUint16(10)).toBe(2) // conductor + 1 populated track
    expect(dv.getUint16(12)).toBe(480) // PPQ
    expect(ascii(bytes, 14, 4)).toBe('MTrk')
    // tempo meta: FF 51 03 with 500000 us/beat
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toContain('ff510307a120')
    // note on ch0 pitch 60: 90 3c, then note on pitch 64: 90 40
    expect(hex).toContain('903c')
    expect(hex).toContain('9040')
    // every MTrk ends with FF 2F 00
    expect(hex.endsWith('ff2f00')).toBe(true)
  })

  it('puts drum tracks on channel 10', () => {
    const p = defaultProject()
    p.tracks = [p.tracks[0]]
    p.tracks[0].kind = 'drums'
    p.tracks[0].clips = [{ id: 'd', start: 0, length: 4, notes: [{ start: 0, dur: 0.25, pitch: 36, vel: 1 }] }]
    const hex = [...exportMidi(p)].map(b => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toContain('9924') // 0x90|9, pitch 36
  })

  it('skips empty tracks', () => {
    const p = defaultProject()
    const bytes = exportMidi(p)
    expect(new DataView(bytes.buffer).getUint16(10)).toBe(1) // conductor only
  })
})
