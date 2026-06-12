// Piano roll: click-drag to draw a note, drag to move (pitch + time), right
// edge to resize, double-click to delete. Snaps to 16ths.

import type { DawApp } from '../daw-app'
import type { Clip, Note } from '../project'

const KEY_H = 13
const PPB = 64 // pixels per beat
const SNAP = 0.25
const PITCH_MAX = 107 // B7 at the top
const PITCH_MIN = 24 // C1 at the bottom
const KEYS_W = 46
const BLACK = new Set([1, 3, 6, 8, 10])

export class PianoRoll {
  readonly el: HTMLElement
  private readonly app: DawApp
  private trackId = ''
  private clip: Clip | null = null
  private notesLayer!: HTMLElement
  private scroller!: HTMLElement
  private lastDur = 1

  constructor(app: DawApp) {
    this.app = app
    this.el = document.createElement('div')
    this.el.className = 'proll'
  }

  show(trackId: string, clip: Clip): void {
    const fresh = this.clip?.id !== clip.id
    this.trackId = trackId
    this.clip = clip
    this.render()
    // the panel attaches this element after show(); scrolling only works once
    // it is in the DOM with real layout, so defer one frame
    if (fresh) requestAnimationFrame(() => this.scrollToContent())
  }

  private rows(): number {
    return PITCH_MAX - PITCH_MIN + 1
  }

  private render(): void {
    const clip = this.clip
    if (!clip) return
    this.el.innerHTML = ''
    this.scroller = document.createElement('div')
    this.scroller.className = 'proll-scroll'

    const inner = document.createElement('div')
    inner.className = 'proll-inner'
    inner.style.width = `${KEYS_W + clip.length * PPB}px`
    inner.style.height = `${this.rows() * KEY_H}px`

    // row stripes + beat lines
    const grid = document.createElement('div')
    grid.className = 'proll-grid'
    grid.style.left = `${KEYS_W}px`
    grid.style.width = `${clip.length * PPB}px`
    grid.style.backgroundSize = `${PPB}px ${KEY_H * 12}px, ${PPB / 4}px ${KEY_H}px, 100% ${KEY_H * 12}px`
    this.bindGrid(grid)
    inner.appendChild(grid)

    // sticky key column
    const keys = document.createElement('div')
    keys.className = 'proll-keys'
    keys.style.width = `${KEYS_W}px`
    for (let pitch = PITCH_MAX; pitch >= PITCH_MIN; pitch--) {
      const row = document.createElement('div')
      row.className = 'proll-key'
      if (BLACK.has(pitch % 12)) row.classList.add('proll-key-black')
      row.style.height = `${KEY_H}px`
      if (pitch % 12 === 0) row.textContent = `C${pitch / 12 - 1}`
      keys.appendChild(row)
    }
    inner.appendChild(keys)

    this.notesLayer = document.createElement('div')
    this.notesLayer.className = 'proll-notes'
    this.notesLayer.style.left = `${KEYS_W}px`
    for (const note of clip.notes) this.notesLayer.appendChild(this.noteEl(note))
    inner.appendChild(this.notesLayer)

    this.scroller.appendChild(inner)
    this.el.appendChild(this.scroller)
  }

  private scrollToContent(): void {
    const clip = this.clip
    if (!clip) return
    const target = clip.notes.length
      ? Math.max(...clip.notes.map(n => n.pitch))
      : 72
    this.scroller.scrollTop = (PITCH_MAX - target) * KEY_H - 60
    this.scroller.scrollLeft = 0
  }

  private posOf(e: PointerEvent): { beat: number; pitch: number } {
    const rect = this.notesLayer.getBoundingClientRect()
    const beat = Math.max(0, Math.floor((e.clientX - rect.left) / PPB / SNAP) * SNAP)
    const pitch = PITCH_MAX - Math.floor((e.clientY - rect.top) / KEY_H)
    return { beat, pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch)) }
  }

  private audition(pitch: number): void {
    this.app.ensureAudio().noteOn(this.trackId, pitch, 0.8)
    setTimeout(() => this.app.song?.noteOff(this.trackId, pitch), 180)
  }

  // draw a new note by pressing on empty grid and dragging right
  private bindGrid(grid: HTMLElement): void {
    let draft: Note | null = null
    let draftEl: HTMLElement | null = null
    grid.addEventListener('pointerdown', e => {
      e.preventDefault()
      const clip = this.clip
      if (!clip) return
      try {
        grid.setPointerCapture(e.pointerId)
      } catch {
        // synthetic
      }
      const { beat, pitch } = this.posOf(e)
      if (beat >= clip.length) return
      draft = { start: beat, dur: Math.min(this.lastDur, clip.length - beat), pitch, vel: 0.8 }
      draftEl = this.noteEl(draft)
      this.notesLayer.appendChild(draftEl)
    })
    grid.addEventListener('pointermove', e => {
      if (!draft || !draftEl || !this.clip) return
      const { beat } = this.posOf(e)
      const dur = Math.max(SNAP, beat + SNAP - draft.start)
      draft.dur = Math.min(dur, this.clip.length - draft.start)
      draftEl.style.width = `${draft.dur * PPB - 1}px`
    })
    const up = (): void => {
      if (!draft || !this.clip) return
      this.clip.notes.push(draft)
      this.lastDur = draft.dur
      this.audition(draft.pitch)
      draft = null
      draftEl = null
      this.app.emit('clips')
      this.render()
    }
    grid.addEventListener('pointerup', up)
    grid.addEventListener('pointercancel', () => {
      draftEl?.remove()
      draft = null
      draftEl = null
    })
  }

  private noteEl(note: Note): HTMLElement {
    const el = document.createElement('div')
    el.className = 'proll-note'
    const place = (): void => {
      el.style.left = `${note.start * PPB}px`
      el.style.top = `${(PITCH_MAX - note.pitch) * KEY_H}px`
      el.style.width = `${note.dur * PPB - 1}px`
      el.style.height = `${KEY_H - 1}px`
    }
    place()
    const grip = document.createElement('div')
    grip.className = 'proll-note-grip'
    el.appendChild(grip)

    let mode: 'move' | 'size' | null = null
    let start = { beat: 0, pitch: 0 }
    let orig = { start: 0, pitch: 0, dur: 0 }
    el.addEventListener('pointerdown', e => {
      e.preventDefault()
      e.stopPropagation()
      mode = e.target === grip ? 'size' : 'move'
      start = this.posOf(e)
      orig = { start: note.start, pitch: note.pitch, dur: note.dur }
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // synthetic
      }
    })
    el.addEventListener('pointermove', e => {
      if (!mode || !this.clip) return
      const pos = this.posOf(e)
      if (mode === 'move') {
        note.start = Math.min(this.clip.length - note.dur, Math.max(0, orig.start + pos.beat - start.beat))
        note.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, orig.pitch + pos.pitch - start.pitch))
      } else {
        note.dur = Math.min(this.clip.length - note.start, Math.max(SNAP, orig.dur + pos.beat - start.beat))
        this.lastDur = note.dur
      }
      place()
    })
    const up = (): void => {
      if (!mode) return
      const pitchChanged = note.pitch !== orig.pitch
      mode = null
      if (pitchChanged) this.audition(note.pitch)
      this.app.emit('clips')
    }
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('dblclick', e => {
      e.stopPropagation()
      if (!this.clip) return
      const i = this.clip.notes.indexOf(note)
      if (i !== -1) this.clip.notes.splice(i, 1)
      this.app.emit('clips')
      this.render()
    })
    return el
  }
}
