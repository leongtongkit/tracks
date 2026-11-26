import { describe, expect, it } from 'vitest'
import { drumRows, isStepOn, noteInStep, pageCount, stepAtBeat, stepInClip, stepStart, toggleStep } from './step-grid'
import type { Note } from './project'

const note = (pitch: number, start: number): Note => ({ pitch, start, dur: 0.25, vel: 0.8 })

describe('step grid', () => {
  it('puts kick, snare and hats on top, then every other drum once', () => {
    const rows = drumRows()
    expect(rows.slice(0, 4).map(r => r.label)).toEqual(['Kick', 'Snare', 'Hat Closed', 'Hat Open'])
    expect(rows).toHaveLength(14)
    expect(new Set(rows.map(r => r.pitch)).size).toBe(14)
  })

  it('toggles a step on then off', () => {
    const on = toggleStep([], 36, 0, 4, 4)
    expect(on.result).toBe('added')
    expect(on.notes).toEqual([{ pitch: 36, start: 1, dur: 0.25, vel: 0.8 }])
    const off = toggleStep(on.notes, 36, 0, 4, 4)
    expect(off.result).toBe('removed')
    expect(off.notes).toEqual([])
  })

  it('leaves other pitches alone', () => {
    const base = [note(38, 1)]
    const res = toggleStep(base, 36, 0, 4, 4)
    expect(res.notes).toHaveLength(2)
    expect(toggleStep(res.notes, 36, 0, 4, 4).notes).toEqual(base)
  })

  it('shows an off-grid note as on in the step it starts in and removes it', () => {
    const notes = [note(36, 0.3)]
    expect(isStepOn(notes, 36, 0, 1)).toBe(true)
    expect(isStepOn(notes, 36, 0, 0)).toBe(false)
    expect(isStepOn(notes, 36, 0, 2)).toBe(false)
    expect(toggleStep(notes, 36, 0, 1, 4).notes).toEqual([])
  })

  it('removes every note of the pitch inside the step', () => {
    const notes = [note(36, 0.25), note(36, 0.3), note(36, 0.5)]
    expect(toggleStep(notes, 36, 0, 1, 4).notes).toEqual([note(36, 0.5)])
  })

  it('uses clip-relative offsets on later bars', () => {
    expect(stepStart(1, 0)).toBe(4)
    expect(stepStart(2, 3)).toBe(8.75)
    const res = toggleStep([], 42, 1, 2, 8)
    expect(res.notes[0].start).toBe(4.5)
    expect(isStepOn(res.notes, 42, 1, 2)).toBe(true)
    expect(isStepOn(res.notes, 42, 0, 2)).toBe(false)
    expect(noteInStep(res.notes[0], 1, 2)).toBe(true)
  })

  it('does not act on steps beyond the clip length', () => {
    expect(stepInClip(2, 0, 7)).toBe(true)
    expect(stepInClip(2, 0, 8)).toBe(false)
    expect(toggleStep([], 36, 0, 8, 2)).toEqual({ notes: [], result: 'none' })
    expect(stepInClip(4, 1, 0)).toBe(false)
  })

  it('shortens the note on a clip that ends mid-step', () => {
    const res = toggleStep([], 36, 0, 4, 1.1)
    expect(res.notes[0].dur).toBeCloseTo(0.1)
  })

  it('pages: one per bar, at least one', () => {
    expect(pageCount(4)).toBe(1)
    expect(pageCount(5)).toBe(2)
    expect(pageCount(16)).toBe(4)
    expect(pageCount(1)).toBe(1)
  })

  it('maps a clip beat to its page and step', () => {
    expect(stepAtBeat(8, 0)).toEqual({ page: 0, step: 0 })
    expect(stepAtBeat(8, 4.3)).toEqual({ page: 1, step: 1 })
    expect(stepAtBeat(8, 8)).toBeNull()
    expect(stepAtBeat(8, -1)).toBeNull()
  })
})
