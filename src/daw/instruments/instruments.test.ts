import { describe, expect, it } from 'vitest'
import { DRUM_NAMES } from '../ui/piano-roll'
import { DRUM_ORDER, DRUM_PITCHES, pitchToDrum } from './drums'

describe('drum machine mapping', () => {
  it('maps every labeled piano-roll row to a drum voice', () => {
    for (const pitch of Object.keys(DRUM_NAMES).map(Number)) {
      expect(DRUM_PITCHES[pitch]).toBeDefined()
    }
  })

  it('every drum in the editor order has a pitch entry', () => {
    for (const { id, pitch } of DRUM_ORDER) {
      expect(DRUM_PITCHES[pitch]).toBe(id)
    }
  })

  it('folds unmapped pitches to the nearest drum so live keys always sound', () => {
    expect(pitchToDrum(36)).toBe('kick')
    expect(pitchToDrum(35)).toBe('kick')
    expect(pitchToDrum(0)).toBe('kick')
    expect(pitchToDrum(43)).toBe('hatc') // 42 closer than 45 (tie goes low)
    expect(pitchToDrum(127)).toBe('clave')
  })
})
