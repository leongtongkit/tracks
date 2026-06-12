import { describe, expect, it } from 'vitest'
import { autoValueAt, scheduleAutomation } from './automation'

const pts = [
  { beat: 4, value: 1 },
  { beat: 8, value: 0.5 },
  { beat: 12, value: 0.8 },
]

describe('autoValueAt', () => {
  it('holds edges and interpolates linearly', () => {
    expect(autoValueAt(pts, 0, 1)).toBe(1) // before first → first value
    expect(autoValueAt(pts, 6, 1)).toBeCloseTo(0.75)
    expect(autoValueAt(pts, 8, 1)).toBe(0.5)
    expect(autoValueAt(pts, 10, 1)).toBeCloseTo(0.65)
    expect(autoValueAt(pts, 99, 1)).toBe(0.8) // after last → last value
  })

  it('returns the fallback with no points', () => {
    expect(autoValueAt([], 5, 0.42)).toBe(0.42)
  })
})

interface Call {
  kind: 'set' | 'ramp'
  v: number
  t: number
}

function fakeParam(calls: Call[]): AudioParam {
  return {
    setValueAtTime: (v: number, t: number) => calls.push({ kind: 'set', v, t }),
    linearRampToValueAtTime: (v: number, t: number) => calls.push({ kind: 'ramp', v, t }),
  } as unknown as AudioParam
}

describe('scheduleAutomation', () => {
  const beatToTime = (b: number): number => b * 0.5

  it('anchors the slice start then ramps through interior points and the end', () => {
    const calls: Call[] = []
    scheduleAutomation(fakeParam(calls), pts, 6, 10, beatToTime, 1)
    expect(calls[0]).toEqual({ kind: 'set', v: 0.75, t: 3 })
    expect(calls[1]).toEqual({ kind: 'ramp', v: 0.5, t: 4 })
    expect(calls[2].kind).toBe('ramp')
    expect(calls[2].v).toBeCloseTo(0.65)
    expect(calls[2].t).toBe(5)
    // times strictly increase
    for (let i = 1; i < calls.length; i++) expect(calls[i].t).toBeGreaterThan(calls[i - 1].t)
  })

  it('does nothing with no points', () => {
    const calls: Call[] = []
    scheduleAutomation(fakeParam(calls), [], 0, 8, beatToTime, 1)
    expect(calls).toHaveLength(0)
  })
})
