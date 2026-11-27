// "My songs in this browser": every song kept here, in one localStorage key.
// Project JSON only; sample audio stays in IndexedDB (see samples.ts) and is
// never deleted from here, because another song may use it. Pure logic with an
// injected storage so it can be tested without a browser.

import { isSongInProgress } from './analytics'
import { migrateProject, newId, type Project } from './project'

export const LIBRARY_KEY = 'tracks.songs.v1'

export interface SongEntry {
  id: string
  name: string
  updatedAt: number // ms since epoch
  project: Project
}

export type LibraryStorage = Pick<Storage, 'getItem' | 'setItem'>
export type WriteStatus = 'ok' | 'skipped' | 'full' | 'error'

interface Envelope {
  current: string | null
  songs: SongEntry[]
}

// the song name as a safe file name base; 'tracks' when nothing usable is left
export function fileBase(name: string): string {
  return name.replaceAll(/\W+/g, '-').replaceAll(/^-+|-+$/g, '') || 'tracks'
}

export function hasContent(p: Project): boolean {
  return p.tracks.some(t => t.clips.some(c => !!c.audio || (c.notes ?? []).length > 0))
}

export function isQuotaError(e: unknown): boolean {
  const x = e as { name?: string; code?: number } | null
  return !!x && (/quota/i.test(String(x.name)) || x.code === 22 || x.code === 1014)
}

export class SongLibrary {
  private envelope: Envelope
  private detached = false // the open song was deleted from the list: stay out of it
  // songs that are not worth listing while untouched (demo and templates)
  untouched: Project[] = []

  constructor(private readonly storage: LibraryStorage) {
    this.envelope = this.read()
  }

  private read(): Envelope {
    try {
      const raw = this.storage.getItem(LIBRARY_KEY)
      if (!raw) return { current: null, songs: [] }
      const parsed = JSON.parse(raw) as { current?: unknown; songs?: unknown }
      const songs: SongEntry[] = []
      for (const s of Array.isArray(parsed.songs) ? parsed.songs : []) {
        const o = s as Partial<SongEntry> | null
        if (!o || typeof o.id !== 'string' || typeof o.updatedAt !== 'number') continue
        try {
          const project = migrateProject(o.project)
          songs.push({ id: o.id, name: typeof o.name === 'string' ? o.name : project.name, updatedAt: o.updatedAt, project })
        } catch {
          // skip an unreadable entry, keep the rest
        }
      }
      const current = typeof parsed.current === 'string' && songs.some(s => s.id === parsed.current) ? parsed.current : null
      return { current, songs }
    } catch {
      return { current: null, songs: [] }
    }
  }

  private write(env: Envelope): WriteStatus {
    try {
      this.storage.setItem(LIBRARY_KEY, JSON.stringify(env))
      this.envelope = env
      return 'ok'
    } catch (e) {
      return isQuotaError(e) ? 'full' : 'error'
    }
  }

  exists(): boolean {
    try {
      return this.storage.getItem(LIBRARY_KEY) !== null
    } catch {
      return false
    }
  }

  // newest first
  list(): SongEntry[] {
    return [...this.envelope.songs].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): SongEntry | undefined {
    return this.envelope.songs.find(s => s.id === id)
  }

  currentId(): string | null {
    return this.detached ? null : this.envelope.current
  }

  // The song being edited is a different one now (new song, opened file).
  // Stored right away: a stale pointer would let the next autosave after a
  // reload overwrite the song that was open before.
  setCurrent(id: string | null): void {
    this.detached = false
    const env = { ...this.envelope, current: id }
    if (this.write(env) !== 'ok') this.envelope = env
  }

  // empty songs and untouched demo/template songs are not worth listing
  worthKeeping(p: Project): boolean {
    return hasContent(p) && this.untouched.every(u => isSongInProgress(p, u))
  }

  // Write the open song's entry (create it if it has none yet). Callers decide
  // whether this may run at all (autosave on); this never reads settings.
  update(project: Project, now = Date.now()): WriteStatus {
    if (!this.worthKeeping(project) && !this.keptCopyOpen()) return 'skipped'
    if (this.detached) return 'skipped'
    const copy = migrateProject(JSON.parse(JSON.stringify(project)))
    if (this.isKept(copy)) return 'ok' // unchanged since it was kept: keep its date
    const songs = this.envelope.songs.filter(s => s.id !== this.envelope.current)
    const id = this.envelope.current && this.get(this.envelope.current) ? this.envelope.current : newId()
    songs.push({ id, name: copy.name, updatedAt: now, project: copy })
    return this.write({ current: id, songs })
  }

  // The open entry was kept on purpose while it still looks untouched (a
  // remix of a starter song): keep saving its changes. Any other entry keeps
  // the rule above, so a demo that opens in place of a lost session never
  // overwrites the song it points at.
  private keptCopyOpen(): boolean {
    const cur = this.currentId()
    const entry = cur ? this.get(cur) : undefined
    return !!entry && !this.worthKeeping(entry.project)
  }

  // A song opened from a share link: always its own new entry, made current,
  // even when it equals the demo or a starter song.
  createCopy(project: Project, now = Date.now()): WriteStatus {
    const copy = migrateProject(JSON.parse(JSON.stringify(project)))
    const id = newId()
    const status = this.write({ current: id, songs: [...this.envelope.songs, { id, name: copy.name, updatedAt: now, project: copy }] })
    if (status === 'ok') this.detached = false
    return status
  }

  // A song is safely kept when its entry holds exactly what is open now.
  isKept(project: Project): boolean {
    const cur = this.currentId()
    const entry = cur ? this.get(cur) : undefined
    if (!entry) return false
    return JSON.stringify(entry.project) === JSON.stringify(migrateProject(JSON.parse(JSON.stringify(project))))
  }

  // First run with the library: the saved session, if it is a song in progress,
  // becomes the first entry so nothing is lost.
  adoptSession(session: Project | null, now = Date.now()): WriteStatus {
    if (this.exists() || !session) return 'skipped'
    return this.update(session, now)
  }

  remove(id: string): WriteStatus {
    if (!this.get(id)) return 'skipped'
    const wasCurrent = this.envelope.current === id
    const status = this.write({ current: wasCurrent ? null : this.envelope.current, songs: this.envelope.songs.filter(s => s.id !== id) })
    if (status === 'ok' && wasCurrent) this.detached = true
    return status
  }

  // an independent copy of a kept song, ready to open
  open(id: string): Project | null {
    const entry = this.get(id)
    return entry ? migrateProject(JSON.parse(JSON.stringify(entry.project))) : null
  }
}
