// P1 v2 features: v1→v2 migration, undo/redo history, clip operations.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DawApp } from './daw-app'
import { beatsPerBar, migrateProject, type Clip } from './project'

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
    // no eq in the v1 fixture → the three default flat bands
    expect(t.mixer.eq).toHaveLength(3)
    expect(t.mixer.eq.map(b => [b.type, b.gain])).toEqual([['lowshelf', 0], ['peaking', 0], ['highshelf', 0]])
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
    expect(t.clips[0].audio).toEqual({ sampleId: 's1', offsetSec: 0.5, gain: 1.2, warp: 'off', origBpm: 120, fadeIn: 0, fadeOut: 0 })
  })

  it('migrates the legacy 3-band EQ object into parametric bands', () => {
    const p = migrateProject({
      v: 2,
      bpm: 120,
      tracks: [{ kind: 'synth', mixer: { eq: { low: 4, mid: -3, high: 6 } } }],
    })
    const eq = p.tracks[0].mixer.eq
    expect(eq).toHaveLength(3)
    expect(eq.map(b => b.gain)).toEqual([4, -3, 6])
    expect(eq.map(b => b.type)).toEqual(['lowshelf', 'peaking', 'highshelf'])
  })

  it('migrates time signature and markers, defaulting when absent', () => {
    const p = migrateProject({
      v: 2,
      bpm: 120,
      timeSig: { num: 6, den: 8 },
      markers: [{ beat: 16, name: 'Chorus' }, { beat: 0, name: 'Intro' }],
      tracks: [{ kind: 'synth' }],
    })
    expect(p.timeSig).toEqual({ num: 6, den: 8 })
    expect(beatsPerBar(p.timeSig)).toBe(3) // 6/8 = three quarter-note beats
    expect(p.markers.map(m => m.name)).toEqual(['Intro', 'Chorus']) // sorted by beat
    const legacy = migrateProject({ v: 2, bpm: 120, tracks: [{ kind: 'synth' }] })
    expect(legacy.timeSig).toEqual({ num: 4, den: 4 })
    expect(legacy.markers).toEqual([])
  })

  it('accepts a soundfont track and its patch', () => {
    const p = migrateProject({
      v: 2,
      bpm: 120,
      tracks: [{ kind: 'soundfont', soundfont: { id: 'sfA', name: 'piano.sf2', presetIndex: 3 } }],
    })
    expect(p.tracks[0].kind).toBe('soundfont')
    expect(p.tracks[0].soundfont).toEqual({ id: 'sfA', name: 'piano.sf2', presetIndex: 3 })
    // a track with no soundfont field gets a null default
    const legacy = migrateProject({ v: 2, bpm: 120, tracks: [{ kind: 'synth' }] })
    expect(legacy.tracks[0].soundfont).toEqual({ id: null, name: '', presetIndex: 0 })
  })

  it('normalises a single-take audio clip and round-trips multi-take comping', () => {
    const p = migrateProject({
      v: 2,
      bpm: 120,
      samples: { a: { name: 'a', duration: 1 }, b: { name: 'b', duration: 1 } },
      tracks: [
        {
          kind: 'audio',
          clips: [
            { start: 0, length: 4, notes: [], audio: { sampleId: 'a' } },
            { start: 4, length: 4, notes: [], activeTake: 1, takes: [{ sampleId: 'a' }, { sampleId: 'b' }], audio: { sampleId: 'a' } },
          ],
        },
      ],
    })
    const [single, comp] = p.tracks[0].clips
    // a plain audio clip gains a one-element takes list
    expect(single.takes).toHaveLength(1)
    expect(single.takes?.[0].sampleId).toBe('a')
    expect(single.activeTake).toBe(0)
    // multi-take clip keeps both takes and active=1 → audio mirrors takes[1]
    expect(comp.takes?.map(t => t.sampleId)).toEqual(['a', 'b'])
    expect(comp.activeTake).toBe(1)
    expect(comp.audio?.sampleId).toBe('b')
  })

  it('accepts a bus track kind and output routing', () => {
    const p = migrateProject({
      v: 2,
      bpm: 120,
      tracks: [
        { kind: 'synth', mixer: { output: 'busX' } },
        { id: 'busX', kind: 'bus' },
      ],
    })
    expect(p.tracks[0].mixer.output).toBe('busX')
    expect(p.tracks[1].kind).toBe('bus')
    // a project with no output field defaults to master
    const legacy = migrateProject({ v: 2, bpm: 120, tracks: [{ kind: 'synth' }] })
    expect(legacy.tracks[0].mixer.output).toBe('master')
  })

  it('round-trips a parametric EQ band array', () => {
    const p = migrateProject({
      v: 2,
      bpm: 120,
      tracks: [{ kind: 'synth', mixer: { eq: [{ type: 'highpass', freq: 80, gain: 0, q: 0.7, on: true }, { type: 'peaking', freq: 2500, gain: 5, q: 3, on: false }] } }],
    })
    const eq = p.tracks[0].mixer.eq
    expect(eq).toHaveLength(2)
    expect(eq[0]).toEqual({ type: 'highpass', freq: 80, gain: 0, q: 0.7, on: true })
    expect(eq[1].on).toBe(false)
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

  it('swings off-beat grid cells on quantize', () => {
    clip.notes = [
      { start: 0.05, dur: 0.5, pitch: 60, vel: 0.8 },
      { start: 1.1, dur: 0.5, pitch: 62, vel: 0.8 },
      { start: 2.05, dur: 0.5, pitch: 64, vel: 0.8 },
      { start: 2.95, dur: 0.5, pitch: 65, vel: 0.8 },
    ]
    app.quantizeClip(trackId, clip.id, 1, 0.5) // off-beat delay = 1 * 0.5 * 0.5 = 0.25
    expect(clip.notes.map(n => n.start)).toEqual([0, 1.25, 2, 3.25]) // odd cells (1,3) pushed late
    // straight quantize (swing 0) lands exactly on the grid
    clip.notes = [{ start: 1.1, dur: 0.5, pitch: 60, vel: 0.8 }]
    app.quantizeClip(trackId, clip.id, 1, 0)
    expect(clip.notes[0].start).toBe(1)
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
