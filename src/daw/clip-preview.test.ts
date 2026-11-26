import { describe, expect, it } from 'vitest'
import { previewRects } from './clip-preview'

const n = (pitch: number, start: number, dur = 1, vel = 0.8) => ({ pitch, start, dur, vel })

describe('clip preview', () => {
  it('draws nothing for an empty clip', () => {
    expect(previewRects([], 4, 100, 30)).toEqual([])
  })

  it('puts later notes further right and higher notes higher up', () => {
    const [a, b] = previewRects([n(60, 0), n(72, 2)], 4, 100, 30)
    expect(b.x).toBeGreaterThan(a.x)
    expect(b.y).toBeLessThan(a.y)
    expect(b.x).toBeCloseTo(50)
  })

  it('stays inside the box', () => {
    const rects = previewRects([n(30, 0, 8), n(90, 3.9, 5)], 4, 100, 30)
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(100.001)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.y + r.h).toBeLessThanOrEqual(30.001)
    }
  })

  it('centres a single pitch and scales to the clip own range', () => {
    const [r] = previewRects([n(60, 0)], 4, 100, 30)
    expect(r.y + r.h / 2).toBeCloseTo(15, 0)
    const narrow = previewRects([n(60, 0), n(62, 1)], 4, 100, 30)
    const wide = previewRects([n(40, 0), n(80, 1)], 4, 100, 30)
    expect(narrow[0].y - narrow[1].y).toBeLessThanOrEqual(wide[0].y - wide[1].y)
  })

  it('scales with the clip width when it is resized', () => {
    const small = previewRects([n(60, 2)], 4, 100, 30)[0]
    const big = previewRects([n(60, 2)], 4, 200, 30)[0]
    expect(big.x).toBeCloseTo(small.x * 2)
  })

  it('skips notes that start past the clip end', () => {
    expect(previewRects([n(60, 5)], 4, 100, 30)).toEqual([])
  })
})
