// Drum step grid: one row per drum sound, 16 sixteenth-note steps per bar.
// Click a step to switch a hit on or off; click a row name to hear that drum.
// Edits go straight into the clip's notes, so the piano roll shows the same beat.

import { STEP_COUNT } from '../../sequencer/sequencer'
import type { DawApp } from '../daw-app'
import type { Clip } from '../project'
import { trackOnce } from '../analytics'
import { drumRows, isStepOn, pageCount, stepAtBeat, stepInClip, toggleStep } from '../step-grid'

export class StepGrid {
  readonly el: HTMLElement
  private readonly app: DawApp
  private trackId = ''
  private clip: Clip | null = null
  private builtKey = ''
  private page = 0
  private cells: HTMLButtonElement[][] = [] // [row][step]
  private readonly rows = drumRows()
  private lit: { page: number; step: number } | null = null
  private running = false
  private scrollTop = 0

  constructor(app: DawApp) {
    this.app = app
    this.el = document.createElement('div')
    this.el.className = 'sgrid'
  }

  show(trackId: string, clip: Clip): void {
    if (this.clip?.id !== clip.id || this.trackId !== trackId) this.page = 0
    this.trackId = trackId
    this.clip = clip
    this.page = Math.min(this.page, pageCount(clip.length) - 1)
    const key = `${trackId}:${clip.id}:${clip.length}:${this.page}`
    if (key !== this.builtKey || !this.cells.length) this.build(key)
    else this.refresh()
    this.startPlayhead()
  }

  private build(key: string): void {
    const clip = this.clip
    if (!clip) return
    const old = this.el.querySelector('.sgrid-scroll')
    if (old) this.scrollTop = old.scrollTop
    this.builtKey = key
    this.el.innerHTML = ''
    this.cells = []
    this.lit = null

    const pages = pageCount(clip.length)
    const bar = document.createElement('div')
    bar.className = 'sgrid-bar'
    const hint = document.createElement('span')
    hint.className = 'sgrid-hint'
    hint.textContent = 'Click a square to add or remove a hit. Click a name to hear it.'
    bar.appendChild(hint)
    if (pages > 1) {
      const label = document.createElement('span')
      label.className = 'sgrid-bar-label'
      label.textContent = 'Bar'
      bar.appendChild(label)
      for (let p = 0; p < pages; p++) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'seg-btn'
        b.textContent = String(p + 1)
        b.title = `Show bar ${p + 1} of this clip`
        b.setAttribute('aria-label', `Show bar ${p + 1}`)
        b.classList.toggle('seg-on', p === this.page)
        b.addEventListener('click', () => {
          this.page = p
          this.show(this.trackId, clip)
        })
        bar.appendChild(b)
      }
    }
    this.el.appendChild(bar)

    const scroll = document.createElement('div')
    scroll.className = 'sgrid-scroll'
    const grid = document.createElement('div')
    grid.className = 'sgrid-grid'
    this.rows.forEach(({ pitch, label }, r) => {
      const name = document.createElement('button')
      name.type = 'button'
      name.className = 'sgrid-name'
      name.textContent = label
      name.title = `Click to hear ${label}`
      name.addEventListener('click', () => this.audition(pitch))
      grid.appendChild(name)
      const rowCells: HTMLButtonElement[] = []
      for (let s = 0; s < STEP_COUNT; s++) {
        const cell = document.createElement('button')
        cell.type = 'button'
        cell.className = 'seq-cell sgrid-cell'
        if (s % 4 === 0) cell.classList.add('seq-beat', 'sgrid-group')
        if (s % 4 === 0 && s > 0) cell.classList.add('sgrid-group-gap')
        const free = stepInClip(clip.length, this.page, s)
        if (!free) {
          cell.disabled = true
          cell.classList.add('sgrid-past')
        } else {
          cell.addEventListener('click', () => this.toggle(r, s))
        }
        cell.setAttribute('aria-label', `${label}, bar ${this.page + 1}, step ${s + 1}`)
        grid.appendChild(cell)
        rowCells.push(cell)
      }
      this.cells.push(rowCells)
    })
    scroll.appendChild(grid)
    this.el.appendChild(scroll)
    this.refresh()
    const restore = (): void => {
      scroll.scrollTop = this.scrollTop
    }
    if (this.el.isConnected) restore()
    else requestAnimationFrame(restore)
  }

  // sync every cell's on/off state from the clip's notes
  private refresh(): void {
    const clip = this.clip
    if (!clip) return
    this.rows.forEach(({ pitch }, r) => {
      for (let s = 0; s < STEP_COUNT; s++) {
        const on = isStepOn(clip.notes, pitch, this.page, s)
        const cell = this.cells[r][s]
        cell.classList.toggle('seq-on', on)
        cell.setAttribute('aria-pressed', String(on))
      }
    })
  }

  private toggle(row: number, step: number): void {
    const clip = this.clip
    if (!clip) return
    const { pitch } = this.rows[row]
    const out = toggleStep(clip.notes, pitch, this.page, step, clip.length)
    if (out.result === 'none') return
    this.app.checkpoint(out.result === 'added' ? 'add drum hit' : 'remove drum hit', false)
    clip.notes = out.notes
    if (out.result === 'added') {
      trackOnce('first_note')
      this.audition(pitch)
    }
    this.refresh()
    this.app.emit('clips')
  }

  private audition(pitch: number): void {
    this.app.ensureAudio().noteOn(this.trackId, pitch, 0.9)
  }

  // one frame loop moves a CSS class between columns; nothing is rebuilt
  private startPlayhead(): void {
    if (this.running) return
    this.running = true
    const tick = (): void => {
      if (!this.el.isConnected) {
        this.running = false
        this.setLit(null)
        return
      }
      const clip = this.clip
      let pos: { page: number; step: number } | null = null
      if (clip && this.app.transport.playing) {
        pos = stepAtBeat(clip.length, this.app.transport.positionBeat() - clip.start)
        if (pos && pos.page !== this.page) pos = null
      }
      this.setLit(pos)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  private setLit(pos: { page: number; step: number } | null): void {
    if (this.lit?.step === pos?.step && this.lit?.page === pos?.page) return
    if (this.lit) for (const row of this.cells) row[this.lit.step]?.classList.remove('sgrid-head')
    this.lit = pos
    if (pos) for (const row of this.cells) row[pos.step]?.classList.add('sgrid-head')
  }
}
