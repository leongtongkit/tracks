// Runtime home of audio sample data. AudioBuffers live in memory keyed by id;
// each is also persisted to IndexedDB (as raw channel arrays) so recordings
// and imports survive a reload. Project JSON stores only {id → name/duration}
// metadata; binary is embedded only when exporting a project file.

export interface StoredSample {
  id: string
  name: string
  buffer: AudioBuffer
}

const DB_NAME = 'tracks-samples'
const STORE = 'samples'

interface SampleRecord {
  id: string
  name: string
  sampleRate: number
  length: number
  channels: ArrayBuffer[]
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise(resolve => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null) // persistence is best-effort
  })
}

export class SampleStore {
  private readonly mem = new Map<string, StoredSample>()
  private db: Promise<IDBDatabase | null> | null = null

  private getDb(): Promise<IDBDatabase | null> {
    this.db ??= openDb()
    return this.db
  }

  get(id: string): AudioBuffer | undefined {
    return this.mem.get(id)?.buffer
  }

  name(id: string): string | undefined {
    return this.mem.get(id)?.name
  }

  has(id: string): boolean {
    return this.mem.has(id)
  }

  ids(): string[] {
    return [...this.mem.keys()]
  }

  // Register a buffer under an id and persist it (best-effort).
  put(id: string, name: string, buffer: AudioBuffer): void {
    this.mem.set(id, { id, name, buffer })
    void this.persist(id, name, buffer)
  }

  async remove(id: string): Promise<void> {
    this.mem.delete(id)
    const db = await this.getDb()
    if (!db) return
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)
  }

  // Rebuild every persisted sample into memory (call once at boot).
  async loadAll(): Promise<void> {
    const db = await this.getDb()
    if (!db) return
    const records = await new Promise<SampleRecord[]>(resolve => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result as SampleRecord[])
      req.onerror = () => resolve([])
    })
    for (const rec of records) {
      if (this.mem.has(rec.id)) continue
      try {
        const buffer = new AudioBuffer({
          length: rec.length,
          numberOfChannels: rec.channels.length,
          sampleRate: rec.sampleRate,
        })
        rec.channels.forEach((ch, i) => buffer.copyToChannel(new Float32Array(ch), i))
        this.mem.set(rec.id, { id: rec.id, name: rec.name, buffer })
      } catch {
        // corrupt record; skip
      }
    }
  }

  private async persist(id: string, name: string, buffer: AudioBuffer): Promise<void> {
    const db = await this.getDb()
    if (!db) return
    const channels: ArrayBuffer[] = []
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i).slice().buffer)
    }
    const rec: SampleRecord = { id, name, sampleRate: buffer.sampleRate, length: buffer.length, channels }
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec)
    } catch {
      // quota or private mode; sample still works for this session
    }
  }
}

// One store for the whole app: live engine, offline render, and editors all
// resolve sample ids against the same memory.
export const sampleStore = new SampleStore()
