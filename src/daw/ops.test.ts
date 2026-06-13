// P1 v2 features: v1→v2 migration, undo/redo history, clip operations.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DawApp } from './daw-app'
import { migrateProject, type Clip } from './project'

vi.stubGlobal('performance', { now: () => Date.now() })

describe('v1 → v2 migration', () => {
  it('upgrades a v1 project with full defaults', () => {
    const v1 = {
      v: 1,
      name: 'Old Song',
      bpm: 100,
      loop: { on: true, start: 0, end: 8 },
      tracks: [
        {
          id: 't1',
          name: 'Bass',
          mixer: { volume: 0.5, pan: -0.3, mute: false, solo: true },
          clips: [{ id: 'c1', start: 0, length: 4, notes: [{ start: 0, dur: 1, pitch: 36, vel: 0.9 }] }],
        },
      ],
    }
    const p = migrateProject(v1)
    expect(p.v).toBe(2)
    expect(p.key).toEqual({ root: 0, scale: 'chromatic' })
    expect(p.samples).toEqual({})
    const t = p.tracks[0]
    expect(t.kind).toBe('synth')
    expect(t.mixer.volume).toBe(0.5)
    expect(t.mixer.eq).toEqual({ low: 0, mid: 0, high: 0 })
    expect(t.mixer.comp.on).toBe(false)
    expect(t.mixer.sendA).toBe(0)
    expect(t.auto).toEqual({}) // no automation in the v1 fixture → empty map
    expect(t.drums.kit).toBe('808')
    expect(t.sampler.sampleId).toBeNull()
    expect(t.clips[0].notes).toHaveLength(1)
  })

  it('round-trips v2 fields (audio regions, automation, key)', () => {
    const v2 = migrateProject({
      v: 2,
      bpm: 120,
      key: { root: 9, scale: 'minor' },
      loop: { on: false, start: 0, end: 16 },
      samples: { s1: { name: 'vox', duration: 3.2 } },
      tracks: [
        {
          kind: 'audio',
          auto: { volume: [{ beat: 4, value: 0.5 }, { beat: 0, value: 1 }], pan: [] },
          clips: [{ start: 0, length: 8, notes: [], audio: { sampleId: 's1', offsetSec: 0.5, gain: 1.2 } }],
        },
      ],
    })
    expect(v2.key).toEqual({ root: 9, scale: 'minor' })
    expect(v2.samples.s1.duration).toBeCloseTo(3.2)
    const t = v2.tracks[0]
    expect(t.kind).toBe('audio')
    // automation points come back sorted by beat; empty pan lane is dropped
    expect(t.auto.volume?.map(p => p.beat)).toEqual([0, 4])
    expect(t.auto.pan).toBeUndefined()
    expect(t.clips[0].audio).toEqual({ sampleId: 's1', offsetSec: 0.5, gain: 1.2, warp: 'off', origBpm: 120 })
  })
})

describe('clip operations', () => {
  let app: DawApp
  let trackId: string
  let clip: Clip

  beforeEach(() => {
    app = new DawApp()
    trackId = app.project.tracks[0].id
    clip = app.addClip(trackId, 4, 8)!
    clip.notes.push(
      { start: 0, dur: 1, pitch: 60, vel: 0.8 },
      { start: 3.9, dur: 2, pitch: 64, vel: 0.8 },
      { start: 6, dur: 1, pitch: 67, vel: 0.8 },
    )
  })

  it('splits a clip at an absolute beat, dividing and trimming notes', () => {
    const right = app.splitClip(trackId, clip.id, 8)! // 4 beats into the clip
    expect(clip.length).toBe(4)
    expect(right.start).toBe(8)
    expect(right.length).toBe(4)
    // note at 3.9 straddles the cut: stays left, trimmed to the boundary
    expect(clip.notes).toHaveLength(2)
    expect(clip.notes[1].dur).toBeCloseTo(0.1)
    // note at 6 moves right, re-based
    expect(right.notes).toHaveLength(1)
    expect(right.notes[0].start).toBe(2)
  })

  it('refuses to split outside the clip', () => {
    expect(app.splitClip(trackId, clip.id, 4)).toBeNull()
    expect(app.splitClip(trackId, clip.id, 12)).toBeNull()
  })

  it('duplicates a clip immediately after itself', () => {
    const copy = app.duplicateClip(trackId, clip.id)!
    expect(copy.start).toBe(12)
    expect(copy.notes).toHaveLength(3)
    expect(copy.id).not.toBe(clip.id)
  })

  it('copies and pastes at the playhead on the selected track', () => {
    app.selectClip(trackId, clip.id)
    expect(app.copyClip()).toBe(true)
    const pasted = app.pasteClip()!
    expect(pasted.start).toBe(0) // playhead at 0
    expect(pasted.notes).toHaveLength(3)
  })

  it('quantizes note starts to the grid', () => {
    clip.notes[1].start = 3.9
    app.quantizeClip(trackId, clip.id, 0.25)
    expect(clip.notes[1].start).toBe(4) // snapped
    expect(clip.notes.every(n => Math.abs(n.start / 0.25 - Math.round(n.start / 0.25)) < 1e-9)).toBe(true)
  })

  it('transposes and clamps pitch', () => {
    app.transposeClip(trackId, clip.id, 12)
    expect(clip.notes.map(n => n.pitch)).toEqual([72, 76, 79])
  })
})

describe('undo/redo history', () => {
  it('undoes and redoes a clip add', () => {
    const app = new DawApp()
    const trackId = app.project.tracks[0].id
    expect(app.project.tracks[0].clips).toHaveLength(0)
    app.addClip(trackId, 0, 4)
    expect(app.project.tracks[0].clips).toHaveLength(1)
    app.undo()
    expect(app.project.tracks[0].clips).toHaveLength(0)
    app.redo()
    expect(app.project.tracks[0].clips).toHaveLength(1)
  })

  it('undoes a track removal and restores selection safety', () => {
    const app = new DawApp()
    const id = app.project.tracks[1].id
    app.removeTrack(id)
    expect(app.project.tracks).toHaveLength(3)
    app.undo()
    expect(app.project.tracks).toHaveLength(4)
    expect(app.project.tracks[1].id).toBe(id)
  })

  it('coalesces same-label checkpoints into one undo step', () => {
    const app = new DawApp()
    const trackId = app.project.tracks[0].id
    app.setMixer(trackId, { volume: 0.5 })
    app.setMixer(trackId, { volume: 0.3 })
    app.setMixer(trackId, { volume: 0.1 })
    app.undo()
    expect(app.project.tracks[0].mixer.volume).toBe(0.8) // back to the start in ONE step
  })

  it('a new mutation clears the redo stack', () => {
    const app = new DawApp()
    const trackId = app.project.tracks[0].id
    app.addClip(trackId, 0, 4)
    app.undo()
    app.addClip(trackId, 8, 4)
    expect(app.history.canRedo()).toBe(false)
  })
})
