import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

describe('WAV encoder', () => {
  it('writes a valid RIFF/WAVE header with correct sizes', () => {
    const n = 1000
    const buf = encodeWav(new Float32Array(n), new Float32Array(n), 44100)
    const view = new DataView(buf)
    const ascii = (off: number, len: number) =>
      String.fromCharCode(...new Uint8Array(buf, off, len))
    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(36, 4)).toBe('data')
    expect(buf.byteLength).toBe(44 + n * 4)
    expect(view.getUint32(4, true)).toBe(36 + n * 4)
    expect(view.getUint16(22, true)).toBe(2) // stereo
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(34, true)).toBe(16) // bit depth
    expect(view.getUint32(40, true)).toBe(n * 4)
  })

  it('converts samples to PCM16 with clipping', () => {
    const left = new Float32Array([0, 0.5, 1, 2, -1, -2])
    const right = new Float32Array(6)
    const view = new DataView(encodeWav(left, right, 48000))
    const sample = (i: number) => view.getInt16(44 + i * 4, true)
    expect(sample(0)).toBe(0)
    expect(sample(1)).toBe(Math.round(0.5 * 0x7fff))
    expect(sample(2)).toBe(0x7fff)
    expect(sample(3)).toBe(0x7fff) // clipped
    expect(sample(4)).toBe(-0x8000)
    expect(sample(5)).toBe(-0x8000) // clipped
  })

  it('duration math holds: frames / sampleRate', () => {
    const sr = 44100
    const seconds = 2.5
    const n = Math.round(sr * seconds)
    const buf = encodeWav(new Float32Array(n), new Float32Array(n), sr)
    const view = new DataView(buf)
    const dataBytes = view.getUint32(40, true)
    expect(dataBytes / 4 / sr).toBeCloseTo(seconds, 6)
  })
})
