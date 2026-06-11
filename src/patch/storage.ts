import { migrate, type Patch } from './schema'

// localStorage persistence: named user patches + autosaved session.
// All quota/availability failures are swallowed; persistence is best-effort.

const PATCHES_KEY = 'synth.patches.v1'
const SESSION_KEY = 'synth.session.v1'

export interface SavedPatch {
  id: string
  savedAt: number
  patch: Patch
}

export function loadUserPatches(): SavedPatch[] {
  try {
    const raw = localStorage.getItem(PATCHES_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as SavedPatch[]
    return list
      .map(entry => {
        try {
          return { ...entry, patch: migrate(entry.patch) }
        } catch {
          return null
        }
      })
      .filter((e): e is SavedPatch => e !== null)
  } catch {
    return []
  }
}

// Upserts by patch name so re-saving "My Bass" overwrites it.
export function saveUserPatch(patch: Patch): SavedPatch[] {
  const list = loadUserPatches().filter(e => e.patch.name !== patch.name)
  list.push({ id: cryptoId(), savedAt: Date.now(), patch })
  persist(list)
  return list
}

export function deleteUserPatch(id: string): SavedPatch[] {
  const list = loadUserPatches().filter(e => e.id !== id)
  persist(list)
  return list
}

export function saveSession(patch: Patch): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(patch))
  } catch {
    // quota or private mode; session restore just won't happen
  }
}

export function loadSession(): Patch | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? migrate(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function persist(list: SavedPatch[]): void {
  try {
    localStorage.setItem(PATCHES_KEY, JSON.stringify(list))
  } catch {
    // best-effort
  }
}

function cryptoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p${Date.now()}${Math.floor(Math.random() * 1e6)}`
}
