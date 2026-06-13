import { describe, expect, it } from 'vitest'
import { MidiRouter, parseMidiMessage, type MidiHandlers } from './midi'

describe('parseMidiMessage', () => {
  it('decodes note on/off, velocity-0 as off, bend, and sustain CC64', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({ type: 'noteOn', note: 60, velocity: 100 / 127 })
    expect(parseMidiMessage([0x80, 60, 0])).toEqual({ type: 'noteOff', note: 60 })
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: 'noteOff', note: 60 })
    expect(parseMidiMessage([0xe0, 0, 64])).toEqual({ type: 'bend', semitones: 0 })
    expect(parseMidiMessage([0xb0, 64, 127])).toEqual({ type: 'sustain', down: true })
    expect(parseMidiMessage([0xb0, 64, 0])).toEqual({ type: 'sustain', down: false })
    expect(parseMidiMessage([0xb0, 7, 100])).toBeNull() // other CC ignored
    expect(parseMidiMessage([0x90])).toBeNull()
  })

  it('reads bend on both sides of center', () => {
    expect((parseMidiMessage([0xe0, 0, 0]) as { semitones: number }).semitones).toBeCloseTo(-2)
    expect((parseMidiMessage([0xe0, 127, 127]) as { semitones: number }).semitones).toBeGreaterThan(1.9)
  })
})

describe('MidiRouter sustain', () => {
  function spy(): { h: MidiHandlers; log: string[] } {
    const log: string[] = []
    return {
      log,
      h: {
        noteOn: (n, v) => log.push(`on ${n} ${v.toFixed(2)}`),
        noteOff: n => log.push(`off ${n}`),
        bend: s => log.push(`bend ${s}`),
      },
    }
  }

  it('passes through notes when the pedal is up', () => {
    const { h, log } = spy()
    const r = new MidiRouter(h)
    r.handle({ type: 'noteOn', note: 60, velocity: 1 })
    r.handle({ type: 'noteOff', note: 60 })
    expect(log).toEqual(['on 60 1.00', 'off 60'])
  })

  it('holds released notes while the pedal is down, then frees them', () => {
    const { h, log } = spy()
    const r = new MidiRouter(h)
    r.handle({ type: 'sustain', down: true })
    r.handle({ type: 'noteOn', note: 60, velocity: 1 })
    r.handle({ type: 'noteOff', note: 60 }) // key up — but pedal held
    expect(log).toEqual(['on 60 1.00'])
    r.handle({ type: 'sustain', down: false }) // pedal up → release
    expect(log).toEqual(['on 60 1.00', 'off 60'])
  })

  it('keeps a re-pressed note sounding after pedal release', () => {
    const { h, log } = spy()
    const r = new MidiRouter(h)
    r.handle({ type: 'sustain', down: true })
    r.handle({ type: 'noteOn', note: 64, velocity: 1 })
    r.handle({ type: 'noteOff', note: 64 })
    r.handle({ type: 'noteOn', note: 64, velocity: 0.8 }) // pressed again
    r.handle({ type: 'sustain', down: false })
    // still physically down, so no note-off emitted on release
    expect(log).toEqual(['on 64 1.00', 'on 64 0.80'])
  })
})
