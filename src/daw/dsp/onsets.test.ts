import { describe, expect, it } from 'vitest'
import { detectOnsets } from './onsets'

const RATE = 44100

describe('onset detection', () => {
  it('finds hits at their actual positions', () => {
    const n = RATE * 2
    const data = new Float32Array(n)
    const hits = [0, 0.5, 1.0, 1.5].map(t => Math.floor(t * RATE))
    for (const at of hits) {
      for (let i = 0; i < 2000; i++) {
        data[at + i] += Math.sin(i * 0.9) * Math.exp(-i / 300) * 0.8
      }
    }
    const found = detectOnsets(data, RATE)
    expect(found.length).toBe(4)
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(found[i] - hits[i])).toBeLessThan(RATE * 0.02) // within 20ms
    }
  })

  it('caps at the requested maximum and keeps time order', () => {
    const n = RATE * 3
    const data = new Float32Array(n)
    for (let h = 0; h < 24; h++) {
      const at = Math.floor(h * 0.12 * RATE)
      for (let i = 0; i < 800; i++) data[at + i] += Math.sin(i * 1.3) * Math.exp(-i / 150) * 0.7
    }
    const found = detectOnsets(data, RATE, 16)
    expect(found.length).toBeLessThanOrEqual(16)
    for (let i = 1; i < found.length; i++) expect(found[i]).toBeGreaterThan(found[i - 1])
  })

  it('returns just the start for silence', () => {
    expect(detectOnsets(new Float32Array(RATE), RATE)).toEqual([0])
  })
})
