import { describe, expect, it } from 'vitest'
import { defaultProject, newTrack, type Project } from './project'
import { collectEvents, Transport } from './transport'

function projectWith(notes: { start: number; dur: number; pitch: number }[], opts: Partial<Project> = {}): Project {
  const p = defaultProject()
  p.tracks = [newTrack('T1', 'Fat Saw')]
  p.tracks[0].clips = [
    { id: 'c1', start: 0, length: 8, notes: notes.map(n => ({ ...n, vel: 0.8 })) },
  ]
  return { ...p, ...opts }
}

describe('collectEvents', () => {
  it('returns events inside the window with absolute beats', () => {
    const p = projectWith([
      { start: 0, dur: 1, pitch: 60 },
      { start: 2, dur: 1, pitch: 64 },
      { start: 7.5, dur: 1, pitch: 67 },
    ])
    const evs = collectEvents(p.tracks, 0, 4)
    expect(evs.map(e => e.pitch)).toEqual([60, 64])
    expect(evs[1].startBeat).toBe(2)
  })

  it('trims note duration to the clip boundary and drops notes past it', () => {
    const p = projectWith([
      { start: 7, dur: 4, pitch: 60 }, // rings past clip end (8)
      { start: 9, dur: 1, pitch: 64 }, // outside the 8-beat clip
    ])
    const evs = collectEvents(p.tracks, 0, 16)
    expect(evs).toHaveLength(1)
    expect(evs[0].durBeats).toBe(1)
  })

  it('offsets by clip start on the timeline', () => {
    const p = projectWith([{ start: 1, dur: 1, pitch: 60 }])
    p.tracks[0].clips[0].start = 16
    expect(collectEvents(p.tracks, 0, 16)).toHaveLength(0)
    const evs = collectEvents(p.tracks, 16, 20)
    expect(evs[0].startBeat).toBe(17)
  })
})

function makeTransport(project: Project) {
  let now = 0
  const log: { type: string; pitch?: number; t: number }[] = []
  const transport = new Transport({
    getNow: () => now,
    getProject: () => project,
    events: {
      noteOn: (_id, pitch, _v, t) => log.push({ type: 'on', pitch, t }),
      noteOff: (_id, pitch, t) => log.push({ type: 'off', pitch, t }),
    },
  })
  return { transport, log, setNow: (t: number) => (now = t) }
}

describe('Transport', () => {
  it('schedules notes at exact beat times for the song BPM', () => {
    const p = projectWith([
      { start: 0, dur: 1, pitch: 60 },
      { start: 4, dur: 1, pitch: 64 },
    ], { bpm: 120 }) // spb = 0.5
    const { transport, log, setNow } = makeTransport(p)
    transport.start(0)
    for (let t = 0; t <= 3; t += 0.025) {
      setNow(t)
      transport.pump(t)
    }
    const ons = log.filter(e => e.type === 'on')
    expect(ons).toHaveLength(2)
    const t0 = ons[0].t
    expect(ons[1].t - t0).toBeCloseTo(4 * 0.5, 6)
  })

  it('loops: events repeat each pass and wrap timing is seamless', () => {
    const p = projectWith([{ start: 0, dur: 0.5, pitch: 60 }], {
      bpm: 120,
      loop: { on: true, start: 0, end: 2 }, // 1s per pass
    })
    const { transport, log, setNow } = makeTransport(p)
    transport.start(0)
    for (let t = 0; t <= 3.6; t += 0.025) {
      setNow(t)
      transport.pump(t)
    }
    const ons = log.filter(e => e.type === 'on')
    expect(ons.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < ons.length; i++) {
      expect(ons[i].t - ons[i - 1].t).toBeCloseTo(1, 6) // exact 1s loop period
    }
  })

  it('position tracks beats while playing and freezes on stop', () => {
    const p = projectWith([], { bpm: 60 }) // 1 beat per second
    const { transport, setNow } = makeTransport(p)
    transport.start(0)
    const t0 = transport.beatToTime(0)
    setNow(t0 + 2.0)
    expect(transport.positionBeat()).toBeCloseTo(2, 6)
    transport.stop()
    setNow(t0 + 10)
    expect(transport.positionBeat()).toBeCloseTo(2, 6)
  })

  it('reanchor keeps position steady through a BPM change', () => {
    const p = projectWith([], { bpm: 120 })
    const { transport, setNow } = makeTransport(p)
    transport.start(0)
    const t0 = transport.beatToTime(0)
    setNow(t0 + 1) // 2 beats at 120
    expect(transport.positionBeat()).toBeCloseTo(2, 6)
    p.bpm = 60
    transport.reanchor()
    expect(transport.positionBeat()).toBeCloseTo(2, 4)
    setNow(t0 + 2) // 1 more second at 60 bpm = +1 beat
    expect(transport.positionBeat()).toBeCloseTo(3, 4)
  })
})
