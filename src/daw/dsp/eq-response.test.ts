import { describe, expect, it } from 'vitest'
import type { EqBand } from '../project'
import { bandDb, eqResponseDb, logFreqs } from './eq-response'

const band = (b: Partial<EqBand>): EqBand => ({ type: 'peaking', freq: 1000, gain: 0, q: 1, on: true, ...b })

describe('eq frequency response', () => {
  it('peaking band boosts at its centre frequency and is ~flat far away', () => {
    const b = band({ type: 'peaking', freq: 1000, gain: 6, q: 1 })
    expect(bandDb(b, 1000, 44100)).toBeCloseTo(6, 1)
    expect(bandDb(b, 60, 44100)).toBeLessThan(0.5)
    expect(bandDb(b, 12000, 44100)).toBeLessThan(0.5)
  })

  it('a cut goes negative at centre', () => {
    expect(bandDb(band({ freq: 800, gain: -9, q: 2 }), 800, 44100)).toBeCloseTo(-9, 0)
  })

  it('low shelf lifts the lows but not the highs', () => {
    const b = band({ type: 'lowshelf', freq: 150, gain: 6, q: 0.7 })
    expect(bandDb(b, 30, 44100)).toBeGreaterThan(5)
    expect(bandDb(b, 10000, 44100)).toBeLessThan(0.5)
  })

  it('high shelf lifts the highs but not the lows', () => {
    const b = band({ type: 'highshelf', freq: 5000, gain: 6, q: 0.7 })
    expect(bandDb(b, 15000, 44100)).toBeGreaterThan(5)
    expect(bandDb(b, 100, 44100)).toBeLessThan(0.5)
  })

  it('lowpass attenuates above cutoff', () => {
    const b = band({ type: 'lowpass', freq: 1000, gain: 0, q: 0.7 })
    expect(bandDb(b, 100, 44100)).toBeGreaterThan(-1)
    expect(bandDb(b, 8000, 44100)).toBeLessThan(-12)
  })

  it('an off band contributes nothing', () => {
    expect(bandDb(band({ gain: 12, on: false }), 1000, 44100)).toBe(0)
  })

  it('stacks band dB additively across the axis', () => {
    const bands: EqBand[] = [band({ type: 'lowshelf', freq: 120, gain: 4, q: 0.7 }), band({ type: 'peaking', freq: 3000, gain: -3, q: 1.5 })]
    const freqs = logFreqs(64)
    const resp = eqResponseDb(bands, freqs, 44100)
    expect(resp.length).toBe(64)
    // sum equals the two bands evaluated separately
    for (let i = 0; i < freqs.length; i++) {
      expect(resp[i]).toBeCloseTo(bandDb(bands[0], freqs[i], 44100) + bandDb(bands[1], freqs[i], 44100), 5)
    }
  })
})
