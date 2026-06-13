import { describe, expect, it } from 'vitest'
import { detectPitch } from './autotune'
import { timeStretch } from './stretch'

const RATE = 44100

function sine(freq: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(RATE * seconds))
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((i / RATE) * freq * 2 * Math.PI) * 0.7
  return out
}

const cents = (f: number, ref: number): number => 1200 * Math.log2(f / ref)

describe('time-stretch', () => {
  it('lengthens by the factor while preserving pitch', () => {
    const input = sine(220, 1)
    const out = timeStretch(input, 1.5)
    expect(out.length).toBeGreaterThan(input.length * 1.45)
    expect(out.length).toBeLessThan(input.length * 1.55)
    const f = detectPitch(out, 8192, 4096, RATE)
    expect(Math.abs(cents(f, 220))).toBeLessThan(20) // pitch unchanged
  })

  it('shortens by the factor while preserving pitch', () => {
    const input = sine(330, 1)
    const out = timeStretch(input, 0.5)
    expect(out.length).toBeGreaterThan(input.length * 0.45)
    expect(out.length).toBeLessThan(input.length * 0.55)
    const f = detectPitch(out, 4096, 4096, RATE)
    expect(Math.abs(cents(f, 330))).toBeLessThan(20)
  }, 20000)

  it('is a no-op at factor 1 and produces finite, non-clipping output', () => {
    const input = sine(440, 0.5)
    expect(timeStretch(input, 1).length).toBe(input.length)
    const out = timeStretch(input, 2)
    let peak = 0
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true)
      peak = Math.max(peak, Math.abs(v))
    }
    expect(peak).toBeLessThan(1.1)
    expect(peak).toBeGreaterThan(0.3)
  }, 20000)
})
