// P4: audio clip scheduling math + WAV round-trip.
import { describe, expect, it } from 'vitest'
import { decodeWav, encodeWav } from '../record/wav'
import { newTrack, warpRate, type Clip } from './project'
import { collectAudioEvents, straddlingAudio } from './transport'

function audioTrack(clips: Partial<Clip>[]): ReturnType<typeof newTrack> {
  const t = newTrack('A', { kind: 'audio' })
  t.clips = clips.map((c, i) => ({
    id: `c${i}`,
    start: 0,
    length: 4,
    notes: [],
    audio: { sampleId: 's1', offsetSec: 0, gain: 1, warp: 'off' as const, origBpm: 120 },
    ...c,
  }))
  return t
}

describe('audio clip scheduling', () => {
  it('collects clips starting inside the window only', () => {
    const t = audioTrack([{ start: 0 }, { start: 4 }, { start: 8 }])
    const evs = collectAudioEvents([t], 3.5, 8)
    expect(evs.map(e => e.startBeat)).toEqual([4])
    expect(evs[0].durBeats).toBe(4)
  })

  it('ignores note clips', () => {
    const t = newTrack('N')
    t.clips = [{ id: 'n', start: 0, length: 4, notes: [] }]
    expect(collectAudioEvents([t], 0, 8)).toEqual([])
  })

  it('finds straddling clips with correct offsets', () => {
    const t = audioTrack([{ start: 2, length: 8 }])
    const s = straddlingAudio([t], 5)
    expect(s).toHaveLength(1)
    expect(s[0].intoBeats).toBe(3)
    expect(s[0].remainBeats).toBe(5)
    expect(straddlingAudio([t], 2)).toHaveLength(0) // boundary start is not straddling
    expect(straddlingAudio([t], 10)).toHaveLength(0)
  })
})

describe('tempo warp', () => {
  it('rate follows project bpm only when warp is on', () => {
    const region = { sampleId: 's', offsetSec: 0, gain: 1, warp: 'off' as 'off' | 'repitch' | 'stretch', origBpm: 100 }
    expect(warpRate(region, 150)).toBe(1)
    region.warp = 'repitch'
    expect(warpRate(region, 150)).toBeCloseTo(1.5)
    expect(warpRate(region, 50)).toBeCloseTo(0.5)
    region.warp = 'stretch'
    expect(warpRate(region, 150)).toBeCloseTo(1.5) // same magnitude; pitch preserved at playback
  })
})

describe('wav round-trip', () => {
  it('encode → decode preserves shape and samples within 16-bit error', () => {
    const n = 1000
    const left = new Float32Array(n)
    const right = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      left[i] = Math.sin(i / 20) * 0.8
      right[i] = Math.cos(i / 15) * 0.5
    }
    const dec = decodeWav(encodeWav(left, right, 48000))
    expect(dec.sampleRate).toBe(48000)
    expect(dec.left.length).toBe(n)
    for (const i of [0, 1, 500, 999]) {
      expect(Math.abs(dec.left[i] - left[i])).toBeLessThan(1 / 16384)
      expect(Math.abs(dec.right[i] - right[i])).toBeLessThan(1 / 16384)
    }
  })

  it('rejects non-wav data', () => {
    expect(() => decodeWav(new ArrayBuffer(64))).toThrow()
  })
})
