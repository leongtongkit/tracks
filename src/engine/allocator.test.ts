import { describe, expect, it } from 'vitest'
import { chooseSlot, midiToFreq, NoteStack, type SlotInfo } from './allocator'

const slot = (over: Partial<SlotInfo> = {}): SlotInfo => ({
  state: 'free',
  note: -1,
  startTime: 0,
  releaseEnd: 0,
  ...over,
})

describe('chooseSlot', () => {
  it('prefers a free slot', () => {
    const slots = [slot({ state: 'active', note: 60, startTime: 1 }), slot(), slot()]
    expect(chooseSlot(slots, 62, 2)).toBe(1)
  })

  it('retriggers the slot already playing the same note', () => {
    const slots = [slot({ state: 'active', note: 60, startTime: 1 }), slot(), slot()]
    expect(chooseSlot(slots, 60, 2)).toBe(0)
  })

  it('treats an expired release as free', () => {
    const slots = [
      slot({ state: 'active', note: 60, startTime: 1 }),
      slot({ state: 'releasing', note: 62, startTime: 2, releaseEnd: 5 }),
    ]
    expect(chooseSlot(slots, 64, 6)).toBe(1)
  })

  it('steals the longest-releasing slot before any active slot', () => {
    const slots = [
      slot({ state: 'active', note: 60, startTime: 1 }),
      slot({ state: 'releasing', note: 62, startTime: 3, releaseEnd: 99 }),
      slot({ state: 'releasing', note: 64, startTime: 2, releaseEnd: 99 }),
    ]
    expect(chooseSlot(slots, 65, 4)).toBe(2)
  })

  it('steals the oldest active slot when all are active', () => {
    const slots = [
      slot({ state: 'active', note: 60, startTime: 5 }),
      slot({ state: 'active', note: 62, startTime: 1 }),
      slot({ state: 'active', note: 64, startTime: 3 }),
    ]
    expect(chooseSlot(slots, 65, 6)).toBe(1)
  })
})

describe('NoteStack', () => {
  it('falls back to the most recent still-held note', () => {
    const s = new NoteStack()
    s.push(60)
    s.push(64)
    s.push(67)
    s.remove(67)
    expect(s.top()).toBe(64)
    s.remove(60)
    expect(s.top()).toBe(64)
    s.remove(64)
    expect(s.top()).toBeNull()
  })

  it('re-pushing a held note moves it to the top', () => {
    const s = new NoteStack()
    s.push(60)
    s.push(64)
    s.push(60)
    s.remove(60)
    expect(s.top()).toBe(64)
    expect(s.size).toBe(1)
  })
})

describe('midiToFreq', () => {
  it('maps A4 (69) to 440 and C4 (60) to ~261.63', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6)
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3)
    expect(midiToFreq(81)).toBeCloseTo(880, 6)
  })
})
