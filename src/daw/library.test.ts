import { describe, expect, it } from 'vitest'
import { demoSong } from './persist'
import { fileBase, hasContent, LIBRARY_KEY, SongLibrary, type LibraryStorage } from './library'
import { defaultProject, type Project } from './project'
import { buildTemplate, emptySong, TEMPLATE_IDS } from './templates'

class MemStorage implements LibraryStorage {
  data = new Map<string, string>()
  failWith: Error | null = null
  getItem(k: string): string | null {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    if (this.failWith) throw this.failWith
    this.data.set(k, v)
  }
}

const quota = (): Error => Object.assign(new Error('full'), { name: 'QuotaExceededError' })

function song(name: string, pitch = 60): Project {
  const p = defaultProject()
  p.name = name
  p.tracks[0].clips = [{ id: 'c' + name, start: 0, length: 4, notes: [{ start: 0, dur: 1, pitch, vel: 0.8 }] }]
  return p
}

function lib(storage = new MemStorage()): { storage: MemStorage; lib: SongLibrary } {
  const l = new SongLibrary(storage)
  l.untouched = [demoSong(), ...TEMPLATE_IDS.map(buildTemplate)]
  return { storage, lib: l }
}

describe('song library', () => {
  it('remembers a switch to a new song across a reload, so the old song is not overwritten', () => {
    const { storage, lib: l } = lib()
    expect(l.update(song('A'), 1000)).toBe('ok')
    l.setCurrent(null)
    const { lib: reloaded } = lib(storage)
    expect(reloaded.currentId()).toBeNull()
    expect(reloaded.update(song('B'), 2000)).toBe('ok')
    expect(reloaded.list().map(s => s.name)).toEqual(['B', 'A'])
  })

  it('lists newest first and updates the current song in place', () => {
    const { lib: l } = lib()
    expect(l.update(song('A'), 1000)).toBe('ok')
    l.setCurrent(null)
    expect(l.update(song('B'), 2000)).toBe('ok')
    expect(l.list().map(s => s.name)).toEqual(['B', 'A'])
    const edited = song('B', 62)
    expect(l.update(edited, 3000)).toBe('ok')
    expect(l.list()).toHaveLength(2)
    expect(l.list()[0].updatedAt).toBe(3000)
  })

  it('does not list empty songs, the untouched demo or untouched templates', () => {
    const { lib: l, storage } = lib()
    expect(l.update(emptySong())).toBe('skipped')
    expect(l.update(demoSong())).toBe('skipped')
    for (const id of TEMPLATE_IDS) expect(l.update(buildTemplate(id))).toBe('skipped')
    expect(storage.data.has(LIBRARY_KEY)).toBe(false)
    const changed = buildTemplate('lofi')
    changed.bpm = 90
    expect(l.update(changed)).toBe('ok')
  })

  it('keeps the date of a song that has not changed', () => {
    const { lib: l } = lib()
    const a = song('A')
    l.update(a, 1000)
    l.update(a, 5000)
    expect(l.list()[0].updatedAt).toBe(1000)
  })

  it('survives a reload and remembers which song is open', () => {
    const { lib: l, storage } = lib()
    l.update(song('A'), 1000)
    const again = new SongLibrary(storage)
    expect(again.list()).toHaveLength(1)
    expect(again.currentId()).toBe(again.list()[0].id)
  })

  it('adopts the saved session once, on first run only', () => {
    const { lib: l, storage } = lib()
    expect(l.adoptSession(song('Old session'), 10)).toBe('ok')
    expect(l.list().map(s => s.name)).toEqual(['Old session'])
    const second = new SongLibrary(storage)
    second.untouched = l.untouched
    expect(second.adoptSession(song('Other'), 20)).toBe('skipped')
    expect(second.list()).toHaveLength(1)
  })

  it('does not adopt an untouched demo session', () => {
    const { lib: l, storage } = lib()
    expect(l.adoptSession(demoSong())).toBe('skipped')
    expect(storage.data.has(LIBRARY_KEY)).toBe(false)
  })

  it('reports a full browser without throwing and keeps what was stored', () => {
    const { lib: l, storage } = lib()
    l.update(song('A'), 1000)
    storage.failWith = quota()
    expect(l.update(song('A', 65), 2000)).toBe('full')
    storage.failWith = new Error('other')
    expect(l.update(song('A', 67), 3000)).toBe('error')
    expect(l.list()[0].project.tracks[0].clips[0].notes[0].pitch).toBe(60)
  })

  it('knows whether the open song is safely kept', () => {
    const { lib: l } = lib()
    const a = song('A')
    expect(l.isKept(a)).toBe(false)
    l.update(a)
    expect(l.isKept(a)).toBe(true)
    a.tracks[0].clips[0].notes.push({ start: 1, dur: 1, pitch: 64, vel: 0.8 })
    expect(l.isKept(a)).toBe(false)
  })

  it('removes a song, and stays out of the open song if it was deleted', () => {
    const { lib: l } = lib()
    l.update(song('A'), 1000)
    const id = l.currentId()!
    expect(l.remove(id)).toBe('ok')
    expect(l.list()).toHaveLength(0)
    expect(l.update(song('A', 61))).toBe('skipped')
    l.setCurrent(null)
    expect(l.update(song('C'))).toBe('ok')
  })

  it('opens an independent copy', () => {
    const { lib: l } = lib()
    l.update(song('A'))
    const id = l.list()[0].id
    const copy = l.open(id)!
    copy.name = 'changed'
    expect(l.get(id)!.project.name).toBe('A')
    expect(l.open('nope')).toBeNull()
  })

  it('ignores a damaged stored list', () => {
    const storage = new MemStorage()
    storage.data.set(LIBRARY_KEY, '{not json')
    expect(new SongLibrary(storage).list()).toEqual([])
    storage.data.set(LIBRARY_KEY, JSON.stringify({ songs: [{ id: 1 }, { id: 'x', updatedAt: 1, project: { v: 9 } }] }))
    expect(new SongLibrary(storage).list()).toEqual([])
  })
})

describe('song helpers', () => {
  it('detects content', () => {
    expect(hasContent(emptySong())).toBe(false)
    expect(hasContent(song('A'))).toBe(true)
  })

  it('builds safe file names with a fallback', () => {
    expect(fileBase('My first song!')).toBe('My-first-song')
    expect(fileBase('')).toBe('tracks')
    expect(fileBase('  ')).toBe('tracks')
    expect(fileBase('!!!')).toBe('tracks')
  })
})

describe('remix copies', () => {
  it('keeps an untouched starter immediately and updates that same new entry', () => {
    const { lib: l, storage } = lib()
    const original = song('Mine')
    expect(l.update(original)).toBe('ok')
    const previous = l.currentId()
    const copy = demoSong()
    expect(l.createCopy(copy)).toBe('ok')
    expect(l.currentId()).not.toBe(previous)
    expect(l.list()).toHaveLength(2)
    copy.bpm++
    expect(l.update(copy)).toBe('ok')
    expect(l.list()).toHaveLength(2)
    const reloaded = new SongLibrary(storage)
    expect(reloaded.get(previous!)?.name).toBe('Mine')
    expect(reloaded.get(l.currentId()!)?.project.bpm).toBe(copy.bpm)
  })
})

describe('kept copies and lost sessions', () => {
  it('never writes an untouched demo over a kept song (the session was lost on reload)', () => {
    const { lib: l } = lib()
    expect(l.update(song('A'), 1000)).toBe('ok')
    const id = l.currentId()!
    expect(l.update(demoSong(), 2000)).toBe('skipped')
    expect(l.get(id)?.name).toBe('A')
    expect(l.list()).toHaveLength(1)
  })

  it('keeps saving a remixed starter copy, even a change only the mixer can hear', () => {
    const { lib: l, storage } = lib()
    const copy = demoSong()
    expect(l.createCopy(copy, 1000)).toBe('ok')
    const id = l.currentId()
    copy.tracks[0].mixer.volume = 0.3
    expect(l.update(copy, 2000)).toBe('ok')
    const reloaded = new SongLibrary(storage)
    expect(reloaded.list()).toHaveLength(1)
    expect(reloaded.get(id!)?.project.tracks[0].mixer.volume).toBe(0.3)
  })
})
