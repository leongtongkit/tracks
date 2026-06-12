// Piano roll: click-drag to draw a note, drag to move (pitch + time), right
// edge to resize, double-click to delete. Snaps to 16ths. A toolbar offers
// quantize/humanize/transpose, and a velocity lane under the grid lets each
// note's velocity be dragged.

import type { DawApp } from '../daw-app'
import type { Clip, Note } from '../project'

const KEY_H = 13
const PPB = 64 // pixels per beat
const SNAP = 0.25
const PITCH_MAX = 107 // B7 at the top
const PITCH_MIN = 24 // C1 at the bottom
const KEYS_W = 46
const VEL_H = 56
const BLACK = new Set([1, 3, 6, 8, 10])

// GM-ish drum names shown on drum tracks instead of piano keys
export const DRUM_NAMES: Record<number, string> = {
  36: 'Kick',
  37: 'Rim',
  38: 'Snare',
  39: 'Clap',
  41: 'Tom Lo',
  42: 'Hat Cl',
  45: 'Tom Mid',
  46: 'Hat Op',
  48: 'Tom Hi',
  49: 'Crash',
  51: 'Ride',
  56: 'Cowbell',
  70: 'Shaker',
  75: 'Clave',
}

export class PianoRoll {
  readonly el: HTMLElement
  private readonly app: DawApp
  private trackId = ''
  private clip: Clip | null = null
  private notesLayer!: HTMLElement
  private scroller!: HTMLElement
  private velBars!: HTMLElement
  private velViewport!: HTMLElement
  private lastDur = 1
  private gridBeats = 0.25
  private readonly selection = new Set<Note>()
  private readonly noteEls = new Map<Note, HTMLElement>()

  // reposition the selection's elements from note data (group drag)
  private placeAll(): void {
    for (const [n, el] of this.noteEls) {
      if (!this.selection.has(n)) continue
      el.style.left = `${n.start * PPB}px`
      el.style.top = `${(PITCH_MAX - n.pitch) * KEY_H}px`
    }
  }

  constructor(app: DawApp) {
    this.app = app
    this.el = document.createElement('div')
    this.el.className = 'proll'
    this.el.tabIndex = -1 // focusable so Delete targets notes, not the clip
    this.el.addEventListener('keydown', e => {
      if ((e.code === 'Delete' || e.code === 'Backspace') && this.selection.size > 0 && this.clip) {
        e.preventDefault()
        e.stopPropagation()
        this.app.checkpoint('delete notes')
        this.clip.notes = this.clip.notes.filter(n => !this.selection.has(n))
        this.selection.clear()
        this.app.emit('clips')
        this.render()
      } else if (e.code === 'Escape') {
        this.selection.clear()
        this.render()
      }
    })
  }

  show(trackId: string, clip: Clip): void {
    const fresh = this.clip?.id !== clip.id
    if (fresh) this.selection.clear()
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

  private isDrumTrack(): boolean {
    return this.app.track(this.trackId)?.kind === 'drums'
  }

  private render(): void {
    const clip = this.clip
    if (!clip) return
    this.el.innerHTML = ''
    this.el.appendChild(this.buildToolbar())
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
    const drums = this.isDrumTrack()
    const pads = this.app.track(this.trackId)?.kind === 'pads'
    const keys = document.createElement('div')
    keys.className = 'proll-keys'
    keys.style.width = `${KEYS_W}px`
    for (let pitch = PITCH_MAX; pitch >= PITCH_MIN; pitch--) {
      const row = document.createElement('div')
      row.className = 'proll-key'
      if (BLACK.has(pitch % 12)) row.classList.add('proll-key-black')
      row.style.height = `${KEY_H}px`
      if (drums) {
        if (DRUM_NAMES[pitch]) {
          row.textContent = DRUM_NAMES[pitch]
          row.classList.add('proll-key-drum')
        }
      } else if (pads) {
        if (pitch >= 36 && pitch < 52) {
          row.textContent = `P${pitch - 35}`
          row.classList.add('proll-key-drum')
        }
      } else if (pitch % 12 === 0) {
        row.textContent = `C${pitch / 12 - 1}`
      }
      keys.appendChild(row)
    }
    inner.appendChild(keys)

    this.notesLayer = document.createElement('div')
    this.notesLayer.className = 'proll-notes'
    this.notesLayer.style.left = `${KEYS_W}px`
    this.noteEls.clear()
    for (const note of clip.notes) this.notesLayer.appendChild(this.noteEl(note))
    inner.appendChild(this.notesLayer)

    this.scroller.appendChild(inner)
    this.el.appendChild(this.scroller)
    this.el.appendChild(this.buildVelLane())
    this.scroller.addEventListener('scroll', () => {
      this.velViewport.scrollLeft = this.scroller.scrollLeft
    })
  }

  // ---------- toolbar ----------

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'proll-bar'

    const mk = (text: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'seg-btn'
      b.textContent = text
      b.title = title
      b.addEventListener('click', fn)
      return b
    }

    const label = document.createElement('span')
    label.className = 'proll-bar-label'
    label.textContent = 'Grid'
    const grid = document.createElement('select')
    grid.className = 'seg-select'
    for (const [text, val] of [['1/4', '1'], ['1/8', '0.5'], ['1/16', '0.25'], ['1/32', '0.125']] as const) {
      const o = document.createElement('option')
      o.value = val
      o.textContent = text
      if (Number(val) === this.gridBeats) o.selected = true
      grid.appendChild(o)
    }
    grid.addEventListener('change', () => {
      this.gridBeats = Number(grid.value)
    })

    bar.appendChild(label)
    bar.appendChild(grid)
    bar.appendChild(mk('Quantize', 'Snap every note start to the grid', () => {
      if (this.clip) this.app.quantizeClip(this.trackId, this.clip.id, this.gridBeats)
    }))
    bar.appendChild(mk('Humanize', 'Add subtle timing and velocity variation', () => {
      if (this.clip) this.app.humanizeClip(this.trackId, this.clip.id)
    }))
    bar.appendChild(mk('Repeat x2', 'Double the clip and tile its notes into the new half', () => {
      if (this.clip) this.app.repeatClip(this.trackId, this.clip.id)
    }))
    for (const [text, semi] of [['-12', -12], ['-1', -1], ['+1', 1], ['+12', 12]] as const) {
      bar.appendChild(mk(text, `Transpose ${semi > 0 ? 'up' : 'down'} ${Math.abs(semi)} semitone${Math.abs(semi) > 1 ? 's' : ''} (selection if any, else all)`, () => {
        if (!this.clip) return
        if (this.selection.size > 0) {
          this.app.checkpoint('transpose selection')
          for (const n of this.selection) n.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, n.pitch + semi))
          this.app.emit('clips')
          this.render()
        } else {
          this.app.transposeClip(this.trackId, this.clip.id, semi)
        }
      }))
    }
    const hint = document.createElement('span')
    hint.className = 'proll-bar-hint'
    hint.textContent = this.selection.size > 0
      ? `${this.selection.size} of ${this.clip?.notes.length ?? 0} notes selected — shift-drag to select, Delete removes`
      : `${this.clip?.notes.length ?? 0} notes — shift-drag selects`
    bar.appendChild(hint)
    return bar
  }

  // ---------- velocity lane ----------

  private buildVelLane(): HTMLElement {
    const lane = document.createElement('div')
    lane.className = 'proll-vel'
    const tag = document.createElement('span')
    tag.className = 'proll-vel-tag'
    tag.textContent = 'VEL'
    lane.appendChild(tag)

    this.velViewport = document.createElement('div')
    this.velViewport.className = 'proll-vel-viewport'
    const inner = document.createElement('div')
    inner.className = 'proll-vel-inner'
    inner.style.width = `${KEYS_W + (this.clip?.length ?? 0) * PPB}px`
    this.velBars = document.createElement('div')
    this.velBars.className = 'proll-vel-bars'
    this.velBars.style.left = `${KEYS_W}px`
    for (const note of this.clip?.notes ?? []) this.velBars.appendChild(this.velBarEl(note))
    inner.appendChild(this.velBars)
    this.velViewport.appendChild(inner)
    lane.appendChild(this.velViewport)
    return lane
  }

  private velBarEl(note: Note): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'proll-vel-bar'
    const place = (): void => {
      bar.style.left = `${note.start * PPB}px`
      bar.style.height = `${Math.max(2, note.vel * (VEL_H - 8))}px`
    }
    place()
    let dragging = false
    let touched = false
    bar.addEventListener('pointerdown', e => {
      e.preventDefault()
      dragging = true
      touched = false
      try {
        bar.setPointerCapture(e.pointerId)
      } catch {
        // synthetic
      }
    })
    bar.addEventListener('pointermove', e => {
      if (!dragging) return
      if (!touched) {
        touched = true
        this.app.checkpoint(`velocity ${this.clip?.id ?? ''}`)
      }
      const rect = this.velViewport.getBoundingClientRect()
      const frac = 1 - (e.clientY - rect.top - 4) / (VEL_H - 8)
      note.vel = Math.min(1, Math.max(0.05, frac))
      place()
    })
    const up = (): void => {
      if (dragging && touched) this.app.emit('clips')
      dragging = false
    }
    bar.addEventListener('pointerup', up)
    bar.addEventListener('pointercancel', up)
    return bar
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

  // draw a new note by pressing on empty grid and dragging right;
  // shift-drag sweeps a marquee selection instead
  private bindGrid(grid: HTMLElement): void {
    let draft: Note | null = null
    let draftEl: HTMLElement | null = null
    let marqueeFrom: { beat: number; pitch: number } | null = null
    let marqueeEl: HTMLElement | null = null
    grid.addEventListener('pointerdown', e => {
      e.preventDefault()
      this.el.focus()
      const clip = this.clip
      if (!clip) return
      try {
        grid.setPointerCapture(e.pointerId)
      } catch {
        // synthetic
      }
      const { beat, pitch } = this.posOf(e)
      if (e.shiftKey) {
        marqueeFrom = { beat, pitch }
        marqueeEl = document.createElement('div')
        marqueeEl.className = 'proll-marquee'
        this.notesLayer.appendChild(marqueeEl)
        return
      }
      this.selection.clear()
      if (beat >= clip.length) return
      draft = { start: beat, dur: Math.min(this.lastDur, clip.length - beat), pitch, vel: 0.8 }
      draftEl = this.noteEl(draft)
      this.notesLayer.appendChild(draftEl)
    })
    grid.addEventListener('pointermove', e => {
      if (marqueeFrom && marqueeEl) {
        const to = this.posOf(e)
        const b0 = Math.min(marqueeFrom.beat, to.beat)
        const b1 = Math.max(marqueeFrom.beat, to.beat) + SNAP
        const p0 = Math.min(marqueeFrom.pitch, to.pitch)
        const p1 = Math.max(marqueeFrom.pitch, to.pitch)
        marqueeEl.style.left = `${b0 * PPB}px`
        marqueeEl.style.width = `${(b1 - b0) * PPB}px`
        marqueeEl.style.top = `${(PITCH_MAX - p1) * KEY_H}px`
        marqueeEl.style.height = `${(p1 - p0 + 1) * KEY_H}px`
        return
      }
      if (!draft || !draftEl || !this.clip) return
      const { beat } = this.posOf(e)
      const dur = Math.max(SNAP, beat + SNAP - draft.start)
      draft.dur = Math.min(dur, this.clip.length - draft.start)
      draftEl.style.width = `${draft.dur * PPB - 1}px`
    })
    const up = (e: PointerEvent): void => {
      if (marqueeFrom && this.clip) {
        const to = this.posOf(e)
        const b0 = Math.min(marqueeFrom.beat, to.beat)
        const b1 = Math.max(marqueeFrom.beat, to.beat) + SNAP
        const p0 = Math.min(marqueeFrom.pitch, to.pitch)
        const p1 = Math.max(marqueeFrom.pitch, to.pitch)
        this.selection.clear()
        for (const n of this.clip.notes) {
          if (n.start < b1 && n.start + n.dur > b0 && n.pitch >= p0 && n.pitch <= p1) this.selection.add(n)
        }
        marqueeEl?.remove()
        marqueeFrom = null
        marqueeEl = null
        this.render()
        return
      }
      if (!draft || !this.clip) return
      this.app.checkpoint('add note')
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
      marqueeEl?.remove()
      draft = null
      draftEl = null
      marqueeFrom = null
      marqueeEl = null
    })
  }

  private noteEl(note: Note): HTMLElement {
    const el = document.createElement('div')
    el.className = 'proll-note'
    this.noteEls.set(note, el)
    if (this.selection.has(note)) el.classList.add('proll-note-sel')
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
    let group: Map<Note, { start: number; pitch: number }> | null = null
    let touched = false
    let start = { beat: 0, pitch: 0 }
    let orig = { start: 0, pitch: 0, dur: 0 }
    el.addEventListener('pointerdown', e => {
      e.preventDefault()
      e.stopPropagation()
      this.el.focus()
      if (e.shiftKey) {
        // shift-click toggles membership
        if (this.selection.has(note)) this.selection.delete(note)
        else this.selection.add(note)
        this.render()
        return
      }
      mode = e.target === grip ? 'size' : 'move'
      touched = false
      start = this.posOf(e)
      orig = { start: note.start, pitch: note.pitch, dur: note.dur }
      // dragging a selected note moves the whole selection
      group = this.selection.has(note) && this.selection.size > 1
        ? new Map([...this.selection].map(n => [n, { start: n.start, pitch: n.pitch }]))
        : null
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // synthetic
      }
    })
    el.addEventListener('pointermove', e => {
      if (!mode || !this.clip) return
      const pos = this.posOf(e)
      if (!touched && (pos.beat !== start.beat || pos.pitch !== start.pitch)) {
        touched = true
        this.app.checkpoint(`edit note ${this.clip.id}`)
      }
      if (mode === 'move') {
        const dBeat = pos.beat - start.beat
        const dPitch = pos.pitch - start.pitch
        if (group) {
          for (const [n, o] of group) {
            n.start = Math.min(this.clip.length - n.dur, Math.max(0, o.start + dBeat))
            n.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, o.pitch + dPitch))
          }
          this.placeAll()
        } else {
          note.start = Math.min(this.clip.length - note.dur, Math.max(0, orig.start + dBeat))
          note.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, orig.pitch + dPitch))
          place()
        }
      } else {
        note.dur = Math.min(this.clip.length - note.start, Math.max(SNAP, orig.dur + pos.beat - start.beat))
        this.lastDur = note.dur
        place()
      }
    })
    const up = (): void => {
      if (!mode) return
      const pitchChanged = note.pitch !== orig.pitch
      const wasGroup = group !== null
      mode = null
      group = null
      if (pitchChanged && !wasGroup) this.audition(note.pitch)
      this.app.emit('clips')
      if (wasGroup) this.render()
    }
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('dblclick', e => {
      e.stopPropagation()
      if (!this.clip) return
      this.app.checkpoint('delete note')
      const i = this.clip.notes.indexOf(note)
      if (i !== -1) this.clip.notes.splice(i, 1)
      this.app.emit('clips')
      this.render()
    })
    return el
  }
}
