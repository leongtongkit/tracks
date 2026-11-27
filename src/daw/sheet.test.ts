import abcjs from 'abcjs'
import { describe, expect, it } from 'vitest'
import { parseAbc } from './abc'
import { demoSong } from './persist'
import { defaultProject, newTrack, type Project } from './project'
import { defaultParts, keyName, notationAbc } from './sheet'
import { buildTemplate, TEMPLATE_IDS } from './templates'

const songs: [string, Project][] = [['demo', demoSong()], ...TEMPLATE_IDS.map(id => [id, buildTemplate(id)] as [string, Project])]

// abcjs's own parser: what the dialog draws must read without a warning
function abcjsWarnings(text: string): string[] {
  const tunes = abcjs.parseOnly(text)
  expect(tunes).toHaveLength(1)
  return tunes[0].warnings ?? []
}

describe('sheet music view', () => {
  for (const [name, song] of songs) {
    it(`draws every note track of the ${name} song`, () => {
      const parts = defaultParts(song)
      expect(parts.melody).not.toBeNull()
      const first = notationAbc(song, parts.melody!, parts.chords)
      expect(first.error).toBeUndefined()
      expect(first.notes).toBeGreaterThan(0)
      expect(abcjsWarnings(first.text)).toEqual([])
      expect(first.text).toContain(`T:${song.name}`)
      for (const t of song.tracks.filter(t => t.kind !== 'drums' && t.clips.some(c => c.notes.length))) {
        const sheet = notationAbc(song, t.id, parts.chords === t.id ? null : parts.chords)
        expect(sheet.error, t.name).toBeUndefined()
        expect(abcjsWarnings(sheet.text), t.name).toEqual([])
        expect(sheet.text).toContain(`name="${t.name}"`)
        expect(sheet.text).not.toContain('V: Ins')
        // the same notes as the exported file: our own parser reads them back
        expect(parseAbc(sheet.text).voices.find(v => v.notes.length)?.notes.length, t.name).toBe(sheet.notes)
      }
    })
  }

  it('starts from the selected track, else a melody-like one, never drums', () => {
    const rock = buildTemplate('rock')
    expect(rock.tracks.find(t => t.id === defaultParts(rock).melody)?.name).toBe('Lead')
    const bass = rock.tracks.find(t => t.name === 'Bass')!
    expect(defaultParts(rock, bass.id).melody).toBe(bass.id)
    const drums = rock.tracks.find(t => t.kind === 'drums')!
    expect(defaultParts(rock, drums.id).melody).not.toBe(drums.id)
    const hiphop = buildTemplate('hiphop')
    expect(hiphop.tracks.find(t => t.id === defaultParts(hiphop).melody)?.name).toBe('Hook')
  })

  it('picks a track that reads as block chords for the chord names', () => {
    const lofi = buildTemplate('lofi')
    const keys = lofi.tracks.find(t => t.name === 'Keys')!
    const parts = defaultParts(lofi, keys.id)
    expect(lofi.tracks.find(t => t.id === parts.chords)?.name).toBe('Pad')
    expect(notationAbc(lofi, keys.id, parts.chords).chords).toBe(8)
  })

  it('names a chord only when it changes', () => {
    const demo = demoSong()
    const parts = defaultParts(demo)
    const symbols = [...notationAbc(demo, parts.melody!, parts.chords).text.matchAll(/"([^"]*)"/g)].map(m => m[1])
    expect(symbols.length).toBeGreaterThan(1)
    symbols.slice(1).forEach((s, i) => expect(s).not.toBe(symbols[i]))
  })

  it('writes low parts in bass clef', () => {
    const lofi = buildTemplate('lofi')
    const bass = lofi.tracks.find(t => t.name === 'Bass')!
    expect(notationAbc(lofi, bass.id).clef).toBe('bass')
    expect(notationAbc(lofi, bass.id).text).toContain('V: Vocal clef=bass name="Bass"')
  })

  it('keeps names that would break ABC out of the header', () => {
    const p = defaultProject()
    p.name = 'My "best" 100% song\\'
    const t = newTrack('Lead "1"', { preset: 'Retro Solo' })
    t.clips = [{ id: 'c', start: 0, length: 4, notes: [{ start: 0, dur: 1, pitch: 72, vel: 0.8 }] }]
    p.tracks = [t]
    const sheet = notationAbc(p, t.id)
    expect(sheet.text).toContain('T:My best 100 song')
    expect(sheet.text).toContain('name="Lead 1"')
    expect(abcjsWarnings(sheet.text)).toEqual([])
  })

  it('says no notes instead of drawing an empty staff', () => {
    const p = defaultProject()
    expect(defaultParts(p)).toEqual({ melody: null, chords: null })
    expect(notationAbc(p, p.tracks[0].id).error).toBeTruthy()
  })

  it('names the key in words', () => {
    expect(keyName({ root: 9, scale: 'minor' })).toBe('A minor')
    expect(keyName({ root: 3, scale: 'major' })).toBe('E♭ major')
    expect(keyName({ root: 0, scale: 'chromatic' })).toBe('No key set (written in C)')
  })
})
