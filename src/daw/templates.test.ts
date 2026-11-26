import { describe, expect, it } from 'vitest'
import { PRESETS } from '../patch/presets'
import { migrateProject } from './project'
import { buildTemplate, emptySong, isTemplateId, TEMPLATE_IDS } from './templates'

describe('starter songs', () => {
  for (const id of TEMPLATE_IDS) {
    it(`${id} is a complete, editable song`, () => {
      const p = buildTemplate(id)
      const back = migrateProject(JSON.parse(JSON.stringify(p)))
      expect(back).toEqual(p)

      const withNotes = p.tracks.filter(t => t.clips.some(c => c.notes.length > 0))
      expect(withNotes.length).toBeGreaterThanOrEqual(3)
      expect(p.tracks.some(t => t.kind === 'drums')).toBe(true)
      expect(p.tracks.every(t => t.kind === 'synth' || t.kind === 'drums')).toBe(true)
      expect(p.bpm).toBeGreaterThanOrEqual(75)
      expect(p.bpm).toBeLessThanOrEqual(145)
      expect(p.key.scale).not.toBe('chromatic')

      let end = 0
      for (const t of p.tracks) for (const c of t.clips) for (const n of c.notes) end = Math.max(end, c.start + n.start + n.dur)
      expect(p.loop.on).toBe(true)
      expect(p.loop.start).toBe(0)
      expect(p.loop.end).toBeGreaterThanOrEqual(end)
      expect(p.loop.end / 4).toBeGreaterThanOrEqual(4)
      expect(p.loop.end / 4).toBeLessThanOrEqual(8)
    })
  }

  it('uses only built-in presets and the drum kits', () => {
    const names = new Set(PRESETS.map(p => p.name))
    for (const id of TEMPLATE_IDS) {
      const p = buildTemplate(id)
      for (const t of p.tracks) {
        if (t.kind === 'drums') expect(['808', '909']).toContain(t.drums.kit)
      }
      expect(p.name.length).toBeGreaterThan(0)
    }
    // every preset named in a template exists (newTrack silently falls back otherwise)
    const src = ['EP Glow', 'Upright Bass', 'Warm Pad', 'House Stab', 'Fat Saw', 'Kalimba', 'Sub Sine', 'Fifth Stack', 'Square Growl', 'Retro Solo', 'Chip Square', 'Pop Pluck']
    for (const n of src) expect(names.has(n)).toBe(true)
  })

  it('gives each style the tempo and drums asked for', () => {
    expect(buildTemplate('lofi').bpm).toBe(80)
    expect(buildTemplate('house').bpm).toBe(124)
    expect(buildTemplate('hiphop').bpm).toBe(90)
    expect(buildTemplate('rock').bpm).toBe(120)
    expect(buildTemplate('game').bpm).toBe(140)
    const kit = (id: Parameters<typeof buildTemplate>[0]): string => buildTemplate(id).tracks.find(t => t.kind === 'drums')!.drums.kit
    expect(kit('house')).toBe('909')
    expect(kit('lofi')).toBe('808')
    const house = buildTemplate('house').tracks.find(t => t.kind === 'drums')!.clips[0].notes
    expect(house.filter(n => n.pitch === 36)).toHaveLength(32) // four on the floor, 8 bars
  })

  it('returns a fresh project each time', () => {
    expect(buildTemplate('lofi').tracks[0].id).not.toBe(buildTemplate('lofi').tracks[0].id)
  })

  it('has an empty song and recognises template ids', () => {
    const e = emptySong()
    expect(e.tracks.every(t => t.clips.length === 0)).toBe(true)
    expect(isTemplateId('lofi')).toBe(true)
    expect(isTemplateId('metal')).toBe(false)
    expect(isTemplateId(null)).toBe(false)
  })
})
