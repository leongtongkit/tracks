import { describe, expect, it } from 'vitest'
import { TempoMap } from './project'

describe('TempoMap', () => {
  it('reduces to constant-tempo math with no events', () => {
    const m = new TempoMap(120, [])
    expect(m.secAtBeat(0)).toBe(0)
    expect(m.secAtBeat(4)).toBeCloseTo(2.0) // 4 beats @ 120 = 2s
    expect(m.secAtBeat(8)).toBeCloseTo(4.0)
    expect(m.beatAtSec(2)).toBeCloseTo(4)
    expect(m.bpmAtBeat(100)).toBe(120)
  })

  it('integrates piecewise tempo segments', () => {
    const m = new TempoMap(120, [{ beat: 4, bpm: 60 }])
    expect(m.secAtBeat(4)).toBeCloseTo(2.0) // first 4 beats @120
    expect(m.secAtBeat(8)).toBeCloseTo(6.0) // + 4 beats @60 (1s each)
    expect(m.bpmAtBeat(2)).toBe(120)
    expect(m.bpmAtBeat(6)).toBe(60)
  })

  it('round-trips beat ↔ sec across a tempo change', () => {
    const m = new TempoMap(90, [{ beat: 8, bpm: 140 }, { beat: 16, bpm: 70 }])
    for (const beat of [0, 3.5, 8, 12, 16, 24]) {
      expect(m.beatAtSec(m.secAtBeat(beat))).toBeCloseTo(beat, 6)
    }
  })

  it('is monotonic in time and handles out-of-order / duplicate events', () => {
    const m = new TempoMap(120, [{ beat: 8, bpm: 60 }, { beat: 4, bpm: 240 }, { beat: 4, bpm: 200 }])
    // events sorted; the later same-beat event wins (200 at beat 4)
    expect(m.bpmAtBeat(5)).toBe(200)
    let prev = -1
    for (let b = 0; b <= 16; b += 0.5) {
      const s = m.secAtBeat(b)
      expect(s).toBeGreaterThan(prev)
      prev = s
    }
  })
})
