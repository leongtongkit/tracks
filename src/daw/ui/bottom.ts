// Bottom editor panel: Clip (piano roll) / Instrument (synth) tabs for the
// current selection. The instrument editor mounts in the next phase.

import type { DawApp } from '../daw-app'
import { PianoRoll } from './piano-roll'

export class BottomPanel {
  readonly el: HTMLElement
  private readonly app: DawApp
  private readonly roll: PianoRoll
  private tab: 'clip' | 'instrument' = 'clip'
  private readonly tabs: HTMLElement
  private readonly body: HTMLElement
  private mountInstrument: ((host: HTMLElement, trackId: string) => void) | null = null

  constructor(app: DawApp) {
    this.app = app
    this.roll = new PianoRoll(app)
    this.el = document.createElement('div')
    this.el.className = 'bottom-panel'

    this.tabs = document.createElement('div')
    this.tabs.className = 'bottom-tabs'
    this.body = document.createElement('div')
    this.body.className = 'bottom-body'
    this.el.appendChild(this.tabs)
    this.el.appendChild(this.body)

    app.on('selection', () => this.render())
    app.on('clips', () => {
      if (this.tab === 'clip') this.render()
    })
    app.on('tracks', () => this.render())
    this.render()
  }

  // P5 plugs the synth editor in through this hook.
  setInstrumentMount(fn: (host: HTMLElement, trackId: string) => void): void {
    this.mountInstrument = fn
    this.render()
  }

  private setTab(tab: 'clip' | 'instrument'): void {
    this.tab = tab
    this.render()
  }

  private render(): void {
    const sel = this.app.selectedClip
    const clip = this.app.clip(sel)
    const trackId = sel?.trackId ?? this.app.armedTrackId

    this.tabs.innerHTML = ''
    for (const t of ['clip', 'instrument'] as const) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'seg-btn'
      b.textContent = t === 'clip' ? 'Clip' : 'Instrument'
      b.classList.toggle('seg-on', this.tab === t)
      b.addEventListener('click', () => this.setTab(t))
      this.tabs.appendChild(b)
    }
    const trackName = this.app.track(trackId ?? '')?.name
    if (trackName) {
      const label = document.createElement('span')
      label.className = 'bottom-track-label'
      label.textContent = trackName
      this.tabs.appendChild(label)
    }

    this.body.innerHTML = ''
    if (this.tab === 'clip') {
      if (clip && sel) {
        this.roll.show(sel.trackId, clip)
        this.body.appendChild(this.roll.el)
      } else {
        this.hint('Select a clip to edit notes. Double-click an empty lane to create one. Draw notes by dragging; double-click a note to delete it.')
      }
    } else if (trackId && this.mountInstrument) {
      this.mountInstrument(this.body, trackId)
    } else {
      this.hint('The synth editor for the selected track arrives here.')
    }
  }

  private hint(text: string): void {
    const p = document.createElement('p')
    p.className = 'bottom-hint'
    p.textContent = text
    this.body.appendChild(p)
  }
}
