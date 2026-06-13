// Runtime home of loaded SoundFonts. Parsed SoundFont objects live in memory
// keyed by id; the raw .sf2 bytes are persisted to IndexedDB so a loaded
// instrument survives a reload. Project JSON stores only {id, name, presetIndex}
// — .sf2 binaries are local to this browser and never embedded in exports
// (Tracks is a local tool; re-load a soundfont if you move a project).

import { parseSf2, type SoundFont } from './dsp/sf2'

const DB_NAME = 'tracks-soundfonts'
const STORE = 'soundfonts'

interface Sf2Record {
  id: string
  name: string
  bytes: ArrayBuffer
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise(resolve => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

interface LoadedSf2 {
  name: string
  sf: SoundFont
}

export class SoundFontStore {
  private readonly mem = new Map<string, LoadedSf2>()
  private db: Promise<IDBDatabase | null> | null = null

  private getDb(): Promise<IDBDatabase | null> {
    this.db ??= openDb()
    return this.db
  }

  get(id: string): SoundFont | undefined {
    return this.mem.get(id)?.sf
  }

  name(id: string): string | undefined {
    return this.mem.get(id)?.name
  }

  has(id: string): boolean {
    return this.mem.has(id)
  }

  // Parse + register raw .sf2 bytes, persisting them (best-effort). Throws if the
  // bytes aren't a valid SoundFont.
  put(id: string, name: string, bytes: ArrayBuffer): SoundFont {
    const sf = parseSf2(bytes)
    this.mem.set(id, { name, sf })
    void this.persist(id, name, bytes)
    return sf
  }

  async remove(id: string): Promise<void> {
    this.mem.delete(id)
    const db = await this.getDb()
    if (!db) return
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)
  }

  async loadAll(): Promise<void> {
    const db = await this.getDb()
    if (!db) return
    const records = await new Promise<Sf2Record[]>(resolve => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result as Sf2Record[])
      req.onerror = () => resolve([])
    })
    for (const rec of records) {
      if (this.mem.has(rec.id)) continue
      try {
        this.mem.set(rec.id, { name: rec.name, sf: parseSf2(rec.bytes) })
      } catch {
        // corrupt / unsupported; skip
      }
    }
  }

  private async persist(id: string, name: string, bytes: ArrayBuffer): Promise<void> {
    const db = await this.getDb()
    if (!db) return
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).put({ id, name, bytes } satisfies Sf2Record)
    } catch {
      // quota / private mode; still usable this session
    }
  }
}

export const soundFontStore = new SoundFontStore()
