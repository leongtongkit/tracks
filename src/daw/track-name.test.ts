import { describe, expect, it, vi } from 'vitest'
import { DawApp } from './daw-app'
import { defaultProject, migrateProject } from './project'

vi.stubGlobal('performance', { now: () => Date.now() })

describe('synth track name follows its preset', () => {
  it('a new synth track is named after its preset and follows later presets', () => {
    const app = new DawApp()
    const t = app.addTrack('synth')
    expect(t.nameFromPreset).toBe(true)
    app.presetLoaded(t.id, 'Glass Bell')
    expect(app.track(t.id)?.name).toBe('Glass Bell')
  })

  it('keeps a name the user typed', () => {
    const app = new DawApp()
    const t = app.addTrack('synth')
    app.renameTrack(t.id, 'My lead')
    expect(app.track(t.id)?.nameFromPreset).toBeUndefined()
    app.presetLoaded(t.id, 'Glass Bell')
    expect(app.track(t.id)?.name).toBe('My lead')
  })

  it('leaves existing tracks alone', () => {
    const app = new DawApp()
    const t = app.project.tracks[0]
    const before = t.name
    app.presetLoaded(t.id, 'Glass Bell')
    expect(t.name).toBe(before)
  })

  it('survives save and open, and missing means false', () => {
    const p = defaultProject()
    p.tracks[0].nameFromPreset = true
    const back = migrateProject(JSON.parse(JSON.stringify(p)))
    expect(back.tracks[0].nameFromPreset).toBe(true)
    expect(back.tracks[1].nameFromPreset).toBeUndefined()
    const old = migrateProject({ v: 1, tracks: [{ id: 'a', name: 'Bass' }] })
    expect(old.tracks[0].nameFromPreset).toBeUndefined()
    expect(old.tracks[0].name).toBe('Bass')
  })
})
