import { describe, expect, it } from 'vitest'
import type { Clip } from './project'
import { quantizeLaunch, sessionAudioEvents, sessionNoteEvents } from './session'

const noteClip = (length: number, notes: { start: number; pitch: number }[]): Clip => ({
  id: 'c', start: 0, length, notes: notes.map(n => ({ ...n, dur: 0.5, vel: 0.8 })),
})

describe('session clip launch', () => {
  it('quantizes a launch to the next bar', () => {
    expect(quantizeLaunch(0, 4)).toBe(0)
    expect(quantizeLaunch(1.5, 4)).toBe(4)
    expect(quantizeLaunch(4, 4)).toBe(4)
    expect(quantizeLaunch(4.1, 4)).toBe(8)
  })

  it('loops a clip every clip.length beats from the launch beat', () => {
    const clip = noteClip(2, [{ start: 0, pitch: 60 }, { start: 1, pitch: 64 }])
    // launched at beat 4, window [4, 10) → loops at 4,6,8
    const evs = sessionNoteEvents(clip, 't', 4, 4, 10)
    expect(evs.map(e => e.startBeat)).toEqual([4, 5, 6, 7, 8, 9])
    expect(evs.map(e => e.pitch)).toEqual([60, 64, 60, 64, 60, 64])
  })

  it('only emits events inside the query window', () => {
    const clip = noteClip(2, [{ start: 0, pitch: 60 }])
    const evs = sessionNoteEvents(clip, 't', 0, 5, 7)
    expect(evs.map(e => e.startBeat)).toEqual([6]) // loop hits at 0,2,4,6,8 → only 6 in [5,7)
  })

  it('never emits before the launch beat', () => {
    const clip = noteClip(4, [{ start: 0, pitch: 60 }])
    expect(sessionNoteEvents(clip, 't', 8, 0, 8)).toEqual([]) // window ends at launch
  })

  it('re-triggers an audio clip each loop', () => {
    const clip: Clip = { id: 'a', start: 0, length: 4, notes: [], audio: { sampleId: 's', offsetSec: 0, gain: 1, warp: 'off', origBpm: 120, fadeIn: 0, fadeOut: 0 } }
    const evs = sessionAudioEvents(clip, 't', 0, 0, 9)
    expect(evs.map(e => e.startBeat)).toEqual([0, 4, 8])
    expect(evs.every(e => e.durBeats === 4)).toBe(true)
  })
})
