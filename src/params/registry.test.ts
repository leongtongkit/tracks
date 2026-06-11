import { describe, expect, it } from 'vitest'
import { CONTINUOUS, denormalize, normalize } from './registry'

describe('param registry tapers', () => {
  it('round-trips normalize/denormalize for every param at 0, 0.5, 1', () => {
    for (const p of CONTINUOUS) {
      for (const n of [0, 0.25, 0.5, 0.75, 1]) {
        const v = denormalize(p, n)
        expect(v).toBeGreaterThanOrEqual(Math.min(p.min, p.max))
        expect(v).toBeLessThanOrEqual(Math.max(p.min, p.max))
        expect(normalize(p, v)).toBeCloseTo(n, 6)
      }
    }
  })

  it('defaults sit inside their ranges', () => {
    for (const p of CONTINUOUS) {
      expect(p.default).toBeGreaterThanOrEqual(p.min)
      expect(p.default).toBeLessThanOrEqual(p.max)
    }
  })

  it('log tapers map midpoint geometrically', () => {
    const cutoff = CONTINUOUS.find(p => p.path === 'filter.cutoff')!
    const mid = denormalize(cutoff, 0.5)
    expect(mid).toBeCloseTo(Math.sqrt(cutoff.min * cutoff.max), 3)
  })
})
