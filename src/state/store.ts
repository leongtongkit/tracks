import { defaultPatch, type Patch } from '../patch/schema'

export type ParamValue = number | string | boolean
export type ParamListener = (value: ParamValue, path: string) => void

// Holds the current patch. UI controls and the engine both subscribe by
// dot-path ('filter.cutoff', 'osc.0.wave'); preset/URL loads notify everything.
export class Store {
  private patch: Patch = defaultPatch()
  private listeners = new Map<string, Set<ParamListener>>()
  private anyListeners = new Set<ParamListener>()

  getPatch(): Patch {
    return this.patch
  }

  get(path: string): ParamValue {
    return resolve(this.patch, path) as ParamValue
  }

  set(path: string, value: ParamValue): void {
    const segs = path.split('.')
    const last = segs.pop()!
    const parent = resolve(this.patch, segs.join('.')) as Record<string, ParamValue>
    if (parent[last] === value) return
    parent[last] = value
    this.notify(path, value)
  }

  loadPatch(patch: Patch): void {
    this.patch = patch
    for (const [path, set] of this.listeners) {
      const value = resolve(this.patch, path)
      if (value !== undefined) {
        for (const fn of set) fn(value as ParamValue, path)
      }
    }
    for (const fn of this.anyListeners) fn('' as ParamValue, '*')
  }

  subscribe(path: string, fn: ParamListener): () => void {
    let set = this.listeners.get(path)
    if (!set) {
      set = new Set()
      this.listeners.set(path, set)
    }
    set.add(fn)
    return () => set.delete(fn)
  }

  // Fires on every set() and once (path '*') on whole-patch loads.
  subscribeAll(fn: ParamListener): () => void {
    this.anyListeners.add(fn)
    return () => this.anyListeners.delete(fn)
  }

  private notify(path: string, value: ParamValue): void {
    const set = this.listeners.get(path)
    if (set) for (const fn of set) fn(value, path)
    for (const fn of this.anyListeners) fn(value, path)
  }
}

function resolve(obj: unknown, path: string): unknown {
  if (path === '') return obj
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}
