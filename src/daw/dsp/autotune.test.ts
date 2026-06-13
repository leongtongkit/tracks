import { describe, expect, it } from 'vitest'
import { autotuneChannel, detectPitch, normalizeChannels, reverseChannels, snapToScale } from './autotune'

const RATE = 44100

function sine(freq: number, seconds: number, amp = 0.7): Float32Array {
  const out = new Float32Array(Math.floor(RATE * seconds))
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((i / RATE) * freq * 2 * Math.PI) * amp
  return out
}

const cents = (f: number, ref: number): number => 1200 * Math.log2(f / ref)

describe('pitch detection', () => {
  it('finds a sine within a few cents', () => {
    const f = detectPitch(sine(220, 0.5), 4000, 2048, RATE)
    expect(Math.abs(cents(f, 220))).toBeLessThan(10)
  })

  it('returns 0 for silence and noise-free unvoiced input', () => {
    expect(detectPitch(new Float32Array(20000), 0, 2048, RATE)).toBe(0)
  })
})

describe('scale snapping', () => {
  it('snaps chromatic to the nearest semitone', () => {
    expect(snapToScale(69.4, 0, 'chromatic')).toBe(69)
    expect(snapToScale(69.6, 0, 'chromatic')).toBe(70)
  })

  it('snaps to A minor members only', () => {
    // A minor (root 9): A B C D E F G — C#4 (61) is not in it
    expect(snapToScale(61, 9, 'minor')).toBe(60) // C
    expect(snapToScale(61.8, 9, 'minor')).toBe(62) // D
  })
})

describe('autotune', () => {
  it('pulls a sharp note onto pitch', () => {
    // 452 Hz is ~47 cents sharp of A4; hard chromatic snap should land near 440
    const input = sine(452, 1)
    const out = autotuneChannel(input, RATE, { root: 0, scale: 'chromatic', retuneMs: 5, amount: 1 })
    expect(out.length).toBe(input.length)
    const f = detectPitch(out, 8192, 4096, RATE)
    const errBefore = Math.abs(cents(452, 440))
    const errAfter = Math.abs(cents(f, 440))
    expect(errAfter).toBeLessThan(20)
    expect(errAfter).toBeLessThan(errBefore / 2)
  })

  it('amount 0 leaves pitch alone', () => {
    const input = sine(452, 0.6)
    const out = autotuneChannel(input, RATE, { root: 0, scale: 'chromatic', retuneMs: 5, amount: 0 })
    const f = detectPitch(out, 8192, 4096, RATE)
    expect(Math.abs(cents(f, 452))).toBeLessThan(15)
  })

  it('does not blow up amplitude or produce NaN', () => {
    const input = sine(300, 1)
    const out = autotuneChannel(input, RATE, { root: 0, scale: 'major', retuneMs: 50, amount: 1 })
    let peak = 0
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true)
      peak = Math.max(peak, Math.abs(v))
    }
    expect(peak).toBeLessThan(1.2)
    expect(peak).toBeGreaterThan(0.3)
  }, 20000) // heavy WSOLA render — generous timeout so it doesn't flake under parallel load
})

describe('clip utilities', () => {
  it('normalize scales the loudest channel to target', () => {
    const a = new Float32Array([0.1, -0.2, 0.05])
    const b = new Float32Array([0.05, 0.1, -0.49])
    normalizeChannels([a, b])
    expect(Math.max(...[...a, ...b].map(Math.abs))).toBeCloseTo(0.98, 5)
  })

  it('reverse flips samples in place', () => {
    const a = new Float32Array([1, 2, 3])
    reverseChannels([a])
    expect([...a]).toEqual([3, 2, 1])
  })
})
