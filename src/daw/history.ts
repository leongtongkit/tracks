// Snapshot undo/redo. A checkpoint is taken BEFORE each mutation; consecutive
// checkpoints with the same label inside a short window coalesce so drags and
// dial turns become one undo step. Snapshots are project JSON only — sample
// binaries live in the append-only SampleStore, so restoring a snapshot just
// re-resolves sample ids.

import type { DawApp } from './daw-app'
import { migrateProject } from './project'

const LIMIT = 100
const COALESCE_MS = 1200

interface Snapshot {
  label: string
  json: string
  at: number
}

export class History {
  private readonly undoStack: Snapshot[] = []
  private readonly redoStack: Snapshot[] = []
  private readonly app: DawApp

  constructor(app: DawApp) {
    this.app = app
  }

  checkpoint(label: string): void {
    const now = performance.now()
    const top = this.undoStack[this.undoStack.length - 1]
    if (top && top.label === label && now - top.at < COALESCE_MS) {
      top.at = now
      this.redoStack.length = 0
      return
    }
    this.undoStack.push({ label, json: this.serialize(), at: now })
    if (this.undoStack.length > LIMIT) this.undoStack.shift()
    this.redoStack.length = 0
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  undo(): void {
    const snap = this.undoStack.pop()
    if (!snap) return
    this.redoStack.push({ label: snap.label, json: this.serialize(), at: 0 })
    this.restore(snap.json)
  }

  redo(): void {
    const snap = this.redoStack.pop()
    if (!snap) return
    this.undoStack.push({ label: snap.label, json: this.serialize(), at: 0 })
    this.restore(snap.json)
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }

  private serialize(): string {
    this.app.song?.collectPatches(this.app.project)
    return JSON.stringify(this.app.project)
  }

  private restore(json: string): void {
    const app = this.app
    const project = migrateProject(JSON.parse(json))
    app.project = project
    if (app.selectedClip && !app.clip(app.selectedClip)) app.selectedClip = null
    if (app.armedTrackId && !project.tracks.some(t => t.id === app.armedTrackId)) {
      app.armedTrackId = project.tracks[0]?.id ?? null
    }
    if (app.song) {
      void app.song.syncTracks(project)
      // checkpoints contain the latest live patches (serialize() collects them),
      // so pushing each snapshot patch back into its store is lossless
      for (const track of project.tracks) {
        app.song.store(track.id)?.loadPatch(track.patch)
      }
    }
    app.emit('project', 'tracks', 'clips', 'selection', 'mixer')
  }
}
