import { describe, expect, it } from 'vitest'
import { defaultProject, migrateProject, projectEndBeat, PROJECT_VERSION } from './project'

describe('project schema', () => {
  it('round-trips the default project through migrate', () => {
    const p = defaultProject()
    const back = migrateProject(JSON.parse(JSON.stringify(p)))
    expect(back).toEqual(p)
  })

  it('fills broken fields with sane values', () => {
    const p = migrateProject({
      v: PROJECT_VERSION,
      bpm: 9999,
      loop: { on: 'yes', start: -5, end: 0 },
      tracks: [{ clips: [{ length: 4, notes: [{ pitch: 300, vel: 9, start: -1, dur: 0 }] }] }],
    })
    expect(p.bpm).toBe(240)
    expect(p.loop.start).toBe(0)
    expect(p.tracks[0].name).toBe('Track 1')
    expect(p.tracks[0].patch.v).toBe(1)
    const note = p.tracks[0].clips[0].notes[0]
    expect(note.pitch).toBeLessThanOrEqual(127)
    expect(note.vel).toBeLessThanOrEqual(1)
    expect(note.dur).toBeGreaterThan(0)
  })

  it('rejects non-projects and wrong versions', () => {
    expect(() => migrateProject(null)).toThrow()
    expect(() => migrateProject({ v: 99 })).toThrow()
  })

  it('drops zero-length clips and computes the song end', () => {
    const p = defaultProject()
    p.tracks[0].clips = [{ id: 'a', start: 8, length: 4, notes: [] }]
    expect(projectEndBeat(p)).toBe(12)
    const migrated = migrateProject(
      JSON.parse(JSON.stringify({ ...p, tracks: [{ ...p.tracks[0], clips: [{ start: 0, length: 0, notes: [] }] }] })),
    )
    expect(migrated.tracks[0].clips).toHaveLength(0)
  })
})
