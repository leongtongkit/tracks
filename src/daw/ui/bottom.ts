// Bottom editor panel: Clip (piano roll) / Instrument / Mixer tabs for the
// current selection.

import type { DawApp } from '../daw-app'
import { buildAudioClipEditor } from './audio-editor'
import { MixerView } from './mixer'
import { PianoRoll } from './piano-roll'

type Tab = 'clip' | 'instrument' | 'mixer'

export class BottomPanel {
  readonly el: HTMLElement
  private readonly app: DawApp
  private readonly roll: PianoRoll
  private readonly mixer: MixerView
  private tab: Tab = 'clip'
  private readonly tabs: HTMLElement
  private readonly body: HTMLElement
  private mountInstrument: ((host: HTMLElement, trackId: string) => void) | null = null

  constructor(app: DawApp) {
    this.app = app
    this.roll = new PianoRoll(app)
    this.mixer = new MixerView(app)
    this.el = document.createElement('div')
    this.el.className = 'bottom-panel'

    // drag handle: resize the whole bottom panel
    const grip = document.createElement('div')
    grip.className = 'bottom-resize'
    grip.title = 'Drag to resize'
    grip.addEventListener('pointerdown', e => {
      e.preventDefault()
      try {
        grip.setPointerCapture(e.pointerId)
      } catch {
        // synthetic
      }
      const move = (ev: PointerEvent): void => {
        const h = Math.min(Math.round(window.innerHeight * 0.7), Math.max(140, window.innerHeight - ev.clientY))
        const daw = this.el.parentElement
        if (daw) daw.style.gridTemplateRows = `1fr ${h}px`
      }
      const up = (): void => {
        grip.removeEventListener('pointermove', move)
        grip.removeEventListener('pointerup', up)
        grip.removeEventListener('pointercancel', up)
      }
      grip.addEventListener('pointermove', move)
      grip.addEventListener('pointerup', up)
      grip.addEventListener('pointercancel', up)
    })
    this.el.appendChild(grip)

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

  // main.ts plugs the per-kind instrument editors in through this hook.
  setInstrumentMount(fn: (host: HTMLElement, trackId: string) => void): void {
    this.mountInstrument = fn
    this.render()
  }

  private setTab(tab: Tab): void {
    this.tab = tab
    this.render()
  }

  private render(): void {
    const sel = this.app.selectedClip
    const clip = this.app.clip(sel)
    const trackId = sel?.trackId ?? this.app.armedTrackId

    this.tabs.innerHTML = ''
    for (const [t, label] of [['clip', 'Clip'], ['instrument', 'Instrument'], ['mixer', 'Mixer']] as const) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'seg-btn'
      b.textContent = label
      b.classList.toggle('seg-on', this.tab === t)
      b.addEventListener('click', () => this.setTab(t))
      this.tabs.appendChild(b)
    }
    const trackName = this.app.track(trackId ?? '')?.name
    if (trackName && this.tab !== 'mixer') {
      const label = document.createElement('span')
      label.className = 'bottom-track-label'
      label.textContent = trackName
      this.tabs.appendChild(label)
    }

    this.mixer.unmount()
    this.body.innerHTML = ''
    if (this.tab === 'clip') {
      if (clip?.audio && sel) {
        this.body.appendChild(buildAudioClipEditor(this.app, sel.trackId, clip))
      } else if (clip && sel) {
        this.roll.show(sel.trackId, clip)
        this.body.appendChild(this.roll.el)
      } else {
        this.hint('Select a clip to edit notes. Double-click an empty lane to create one. Draw notes by dragging; double-click a note to delete it.')
      }
    } else if (this.tab === 'mixer') {
      this.app.ensureAudio()
      this.body.appendChild(this.mixer.mount())
    } else if (trackId && this.mountInstrument) {
      this.mountInstrument(this.body, trackId)
    } else {
      this.hint('Arm or select a track to edit its instrument.')
    }
  }

  private hint(text: string): void {
    const p = document.createElement('p')
    p.className = 'bottom-hint'
    p.textContent = text
    this.body.appendChild(p)
  }
}
