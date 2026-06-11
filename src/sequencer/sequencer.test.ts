// Node has no localStorage; the class guards every access, so tests run clean.
import { describe, expect, it } from 'vitest'
import { Sequencer, STEP_COUNT } from './sequencer'

function makeSeq(bpm = 120) {
  const events: { type: string; note?: number; t: number }[] = []
  const seq = new Sequencer({
    events: {
      noteOn: (note, t) => events.push({ type: 'on', note, t }),
      noteOff: (note, t) => events.push({ type: 'off', note, t }),
    },
    getNow: () => 0,
    getBpm: () => bpm,
    getBaseNote: () => 60,
  })
  return { seq, events }
}

describe('sequencer scheduling', () => {
  it('books steps at exact 16th-note spacing with no drift', () => {
    const { seq } = makeSeq(120) // step = 0.125 s
    seq.playing = true
    ;(seq as unknown as { nextStepTime: number }).nextStepTime = 0
    const booked: { index: number; time: number }[] = []
    // simulate 4 seconds of pump calls at 25 ms cadence
    for (let now = 0; now < 4; now += 0.025) {
      booked.push(...seq.pump(now))
    }
    expect(booked.length).toBe(Math.floor((4 + 0.12) / 0.125) + 1)
    for (let i = 1; i < booked.length; i++) {
      expect(booked[i].time - booked[i - 1].time).toBeCloseTo(0.125, 9)
      expect(booked[i].index).toBe(i % STEP_COUNT)
    }
    // cumulative position after N steps is exactly N * duration (no drift)
    const last = booked[booked.length - 1]
    expect(last.time).toBeCloseTo((booked.length - 1) * 0.125, 9)
  })

  it('emits gate-length noteOff for every noteOn', () => {
    const { seq, events } = makeSeq(100)
    seq.playing = true
    ;(seq as unknown as { nextStepTime: number }).nextStepTime = 0
    seq.pump(0.5)
    const ons = events.filter(e => e.type === 'on')
    const offs = events.filter(e => e.type === 'off')
    expect(ons.length).toBeGreaterThan(0)
    expect(offs.length).toBe(ons.length)
    const dur = 60 / 100 / 4
    for (let i = 0; i < ons.length; i++) {
      expect(offs[i].t - ons[i].t).toBeCloseTo(dur * 0.5, 9)
    }
  })

  it('skips silent steps but keeps the grid moving', () => {
    const { seq, events } = makeSeq(120)
    for (let i = 0; i < STEP_COUNT; i++) seq.setStep(i, { on: i % 4 === 0 })
    seq.playing = true
    ;(seq as unknown as { nextStepTime: number }).nextStepTime = 0
    const booked = seq.pump(2) // a full bar+ in one pump
    const ons = events.filter(e => e.type === 'on')
    expect(booked.length).toBeGreaterThanOrEqual(16)
    expect(ons.length).toBe(Math.ceil(booked.length / 4))
  })

  it('respects per-step pitch relative to the base note', () => {
    const { seq, events } = makeSeq(120)
    seq.setStep(0, { on: true, semi: 7 })
    seq.playing = true
    ;(seq as unknown as { nextStepTime: number }).nextStepTime = 0
    seq.pump(0.01)
    expect(events.find(e => e.type === 'on')?.note).toBe(67)
  })
})
