// Arrangement view: transport bar, track headers with mixer, beat-ruler with
// loop region, the clip grid with drag/move/resize, and the playhead.

import type { DawApp } from '../daw-app'
import { projectEndBeat, type Clip, type TrackData } from '../project'
import { miniDial } from './mini-dial'

const ROW_H = 56
const SNAP = 1 // beats

export class ArrangeView {
  readonly el: HTMLElement
  private readonly app: DawApp
  private ppb = 26 // pixels per beat (zoom)
  private ruler!: HTMLElement
  private lanes!: HTMLElement
  private headers!: HTMLElement
  private scroller!: HTMLElement
  private playhead!: HTMLElement
  private positionChip!: HTMLElement
  private playBtn!: HTMLButtonElement
  private loopBtn!: HTMLButtonElement
  private metroBtn!: HTMLButtonElement

  constructor(app: DawApp) {
    this.app = app
    this.el = document.createElement('div')
    this.el.className = 'arrange'
    this.el.appendChild(this.buildTransportBar())
    this.el.appendChild(this.buildBody())

    app.on('tracks', () => this.renderAll())
    app.on('clips', () => this.renderLanes())
    app.on('mixer', () => this.renderHeaders())
    app.on('selection', () => this.renderLanes())
    app.on('project', () => this.renderTransport())
    app.on('transport', () => this.renderTransport())

    this.renderAll()
    this.tickPlayhead()
  }

  // ---------- transport bar ----------

  private buildTransportBar(): HTMLElement {
    const bar = document.createElement('header')
    bar.className = 'transport-bar'

    const brand = document.createElement('span')
    brand.className = 'brand'
    brand.innerHTML = 'TRA<b>CKS</b>'

    this.playBtn = btn('Play', 'Play / stop (Space)')
    this.playBtn.classList.add('transport-play')
    this.playBtn.addEventListener('click', () => this.app.togglePlay())

    const rewind = btn('|<', 'Back to start (Enter)')
    rewind.addEventListener('click', () => this.app.rewind())

    this.loopBtn = btn('Loop', 'Loop the marked region (drag on the ruler)')
    this.loopBtn.addEventListener('click', () => {
      this.app.project.loop.on = !this.app.project.loop.on
      this.app.emit('project')
      this.renderRuler()
    })

    this.metroBtn = btn('Click', 'Metronome')
    this.metroBtn.addEventListener('click', () => {
      this.app.transport.metronome = !this.app.transport.metronome
      this.metroBtn.classList.toggle('seg-on', this.app.transport.metronome)
    })

    this.positionChip = document.createElement('output')
    this.positionChip.className = 'pos-chip'
    this.positionChip.textContent = '1.1'

    const bpm = miniDial({
      label: 'BPM',
      get: () => this.app.project.bpm,
      set: v => this.app.setBpm(v),
      min: 40,
      max: 240,
      reset: 120,
      fmt: v => String(Math.round(v)),
    })

    const zoomOut = btn('-', 'Zoom out')
    zoomOut.addEventListener('click', () => this.setZoom(this.ppb / 1.4))
    const zoomIn = btn('+', 'Zoom in')
    zoomIn.addEventListener('click', () => this.setZoom(this.ppb * 1.4))

    const spacer = document.createElement('span')
    spacer.className = 'bar-space'

    bar.appendChild(brand)
    bar.appendChild(rewind)
    bar.appendChild(this.playBtn)
    bar.appendChild(this.loopBtn)
    bar.appendChild(this.metroBtn)
    bar.appendChild(this.positionChip)
    bar.appendChild(bpm)
    bar.appendChild(spacer)
    bar.appendChild(zoomOut)
    bar.appendChild(zoomIn)
    return bar
  }

  // ---------- body ----------

  private buildBody(): HTMLElement {
    const body = document.createElement('div')
    body.className = 'arrange-body'

    this.headers = document.createElement('div')
    this.headers.className = 'track-headers'

    this.scroller = document.createElement('div')
    this.scroller.className = 'lane-scroll'

    const inner = document.createElement('div')
    inner.className = 'lane-inner'
    this.ruler = document.createElement('div')
    this.ruler.className = 'ruler'
    this.lanes = document.createElement('div')
    this.lanes.className = 'lanes'
    this.playhead = document.createElement('div')
    this.playhead.className = 'playhead'
    inner.appendChild(this.ruler)
    inner.appendChild(this.lanes)
    inner.appendChild(this.playhead)
    this.scroller.appendChild(inner)

    this.bindRuler()

    body.appendChild(this.headers)
    body.appendChild(this.scroller)
    return body
  }

  private widthBeats(): number {
    return Math.max(projectEndBeat(this.app.project) + 16, 64)
  }

  private setZoom(ppb: number): void {
    this.ppb = Math.min(80, Math.max(8, ppb))
    this.renderLanes()
    this.renderRuler()
  }

  // ---------- ruler (position click + loop drag) ----------

  private bindRuler(): void {
    let dragStart: number | null = null
    let dragged = false
    this.ruler.addEventListener('pointerdown', e => {
      e.preventDefault()
      try {
        this.ruler.setPointerCapture(e.pointerId)
      } catch {
        // synthetic
      }
      dragStart = this.beatAt(e)
      dragged = false
    })
    this.ruler.addEventListener('pointermove', e => {
      if (dragStart === null) return
      const beat = this.beatAt(e)
      if (Math.abs(beat - dragStart) >= SNAP / 2) {
        dragged = true
        const loop = this.app.project.loop
        loop.start = Math.min(dragStart, beat)
        loop.end = Math.max(dragStart, beat)
        loop.on = true
        this.renderRuler()
      }
    })
    const up = (e: PointerEvent): void => {
      if (dragStart === null) return
      if (!dragged) {
        this.app.transport.setPosition(this.beatAt(e))
        this.app.emit('transport')
      } else {
        this.app.emit('project')
      }
      dragStart = null
    }
    this.ruler.addEventListener('pointerup', up)
    this.ruler.addEventListener('pointercancel', () => (dragStart = null))
  }

  private beatAt(e: PointerEvent): number {
    const rect = this.lanes.getBoundingClientRect()
    const beat = (e.clientX - rect.left) / this.ppb
    return Math.max(0, Math.round(beat / SNAP) * SNAP)
  }

  // ---------- rendering ----------

  renderAll(): void {
    this.renderHeaders()
    this.renderLanes()
    this.renderRuler()
    this.renderTransport()
  }

  private renderTransport(): void {
    this.playBtn.textContent = this.app.transport.playing ? 'Stop' : 'Play'
    this.playBtn.classList.toggle('seg-on', this.app.transport.playing)
    this.loopBtn.classList.toggle('seg-on', this.app.project.loop.on)
  }

  private renderHeaders(): void {
    this.headers.innerHTML = ''
    for (const track of this.app.project.tracks) {
      this.headers.appendChild(this.trackHeader(track))
    }
    const add = btn('+ Track', 'Add a track')
    add.className = 'seg-btn add-track'
    add.addEventListener('click', () => this.app.addTrack())
    this.headers.appendChild(add)
  }

  private trackHeader(track: TrackData): HTMLElement {
    const el = document.createElement('div')
    el.className = 'track-head'
    if (this.app.armedTrackId === track.id) el.classList.add('track-armed')

    const top = document.createElement('div')
    top.className = 'track-head-top'
    const arm = document.createElement('button')
    arm.type = 'button'
    arm.className = 'arm-dot'
    arm.title = 'Arm: your keyboard plays this track'
    arm.addEventListener('click', () => this.app.armTrack(track.id))
    const name = document.createElement('span')
    name.className = 'track-name'
    name.textContent = track.name
    name.title = 'Double-click to rename'
    name.addEventListener('dblclick', () => {
      const next = prompt('Track name', track.name)
      if (next?.trim()) {
        track.name = next.trim().slice(0, 24)
        this.renderHeaders()
      }
    })
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'track-del'
    del.textContent = 'x'
    del.title = 'Delete track'
    del.addEventListener('click', () => {
      if (confirm(`Delete track "${track.name}" and its clips?`)) this.app.removeTrack(track.id)
    })
    top.appendChild(arm)
    top.appendChild(name)
    top.appendChild(del)

    const controls = document.createElement('div')
    controls.className = 'track-head-controls'
    const mute = btn('M', 'Mute')
    mute.classList.toggle('seg-on', track.mixer.mute)
    mute.addEventListener('click', () => this.app.setMixer(track.id, { mute: !track.mixer.mute }))
    const solo = btn('S', 'Solo')
    solo.classList.toggle('seg-on', track.mixer.solo)
    solo.addEventListener('click', () => this.app.setMixer(track.id, { solo: !track.mixer.solo }))
    const vol = miniDial({
      label: 'Vol',
      get: () => track.mixer.volume,
      set: v => this.app.setMixer(track.id, { volume: v }),
      min: 0,
      max: 1,
      reset: 0.8,
      fmt: v => String(Math.round(v * 100)),
    })
    const pan = miniDial({
      label: 'Pan',
      get: () => track.mixer.pan,
      set: v => this.app.setMixer(track.id, { pan: v }),
      min: -1,
      max: 1,
      reset: 0,
      fmt: v => (Math.abs(v) < 0.05 ? 'C' : v < 0 ? `L${Math.round(-v * 50)}` : `R${Math.round(v * 50)}`),
    })
    controls.appendChild(mute)
    controls.appendChild(solo)
    controls.appendChild(vol)
    controls.appendChild(pan)

    el.appendChild(top)
    el.appendChild(controls)
    return el
  }

  private renderRuler(): void {
    const beats = this.widthBeats()
    this.ruler.style.width = `${beats * this.ppb}px`
    this.ruler.innerHTML = ''
    for (let b = 0; b < beats; b += 4) {
      const tick = document.createElement('span')
      tick.className = 'ruler-bar'
      tick.style.left = `${b * this.ppb}px`
      tick.textContent = String(b / 4 + 1)
      this.ruler.appendChild(tick)
    }
    const loop = this.app.project.loop
    if (loop.end > loop.start) {
      const region = document.createElement('div')
      region.className = 'loop-region'
      region.classList.toggle('loop-off', !loop.on)
      region.style.left = `${loop.start * this.ppb}px`
      region.style.width = `${(loop.end - loop.start) * this.ppb}px`
      this.ruler.appendChild(region)
    }
  }

  private renderLanes(): void {
    const beats = this.widthBeats()
    this.lanes.innerHTML = ''
    this.lanes.style.width = `${beats * this.ppb}px`
    this.lanes.style.backgroundSize = `${this.ppb * 4}px 100%, ${this.ppb}px 100%`

    this.app.project.tracks.forEach(track => {
      const lane = document.createElement('div')
      lane.className = 'lane'
      lane.style.height = `${ROW_H}px`
      lane.dataset.trackId = track.id
      lane.addEventListener('dblclick', e => {
        const rect = this.lanes.getBoundingClientRect()
        const beat = Math.floor((e.clientX - rect.left) / this.ppb / SNAP) * SNAP
        this.app.addClip(track.id, beat)
      })
      for (const clip of track.clips) {
        lane.appendChild(this.clipEl(track, clip))
      }
      this.lanes.appendChild(lane)
    })
    this.renderRuler()
  }

  private clipEl(track: TrackData, clip: Clip): HTMLElement {
    const el = document.createElement('div')
    el.className = 'clip'
    const selected = this.app.selectedClip?.clipId === clip.id
    if (selected) el.classList.add('clip-on')
    el.style.left = `${clip.start * this.ppb}px`
    el.style.width = `${clip.length * this.ppb}px`

    const label = document.createElement('span')
    label.className = 'clip-label'
    label.textContent = clip.notes.length ? `${clip.notes.length} notes` : 'empty'
    el.appendChild(label)

    const grip = document.createElement('div')
    grip.className = 'clip-grip'
    el.appendChild(grip)

    // body drag = move; right grip = resize; click = select
    let mode: 'move' | 'size' | null = null
    let startX = 0
    let origStart = 0
    let origLen = 0
    let moved = false
    el.addEventListener('pointerdown', e => {
      e.stopPropagation()
      e.preventDefault()
      mode = e.target === grip ? 'size' : 'move'
      startX = e.clientX
      origStart = clip.start
      origLen = clip.length
      moved = false
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // synthetic
      }
    })
    el.addEventListener('pointermove', e => {
      if (!mode) return
      const dBeats = Math.round((e.clientX - startX) / this.ppb / SNAP) * SNAP
      if (dBeats !== 0) moved = true
      if (mode === 'move') {
        clip.start = Math.max(0, origStart + dBeats)
        el.style.left = `${clip.start * this.ppb}px`
      } else {
        clip.length = Math.max(1, origLen + dBeats)
        el.style.width = `${clip.length * this.ppb}px`
      }
    })
    const up = (): void => {
      if (!mode) return
      mode = null
      this.app.selectClip(track.id, clip.id)
      if (moved) this.app.emit('clips')
    }
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('dblclick', e => e.stopPropagation())
    return el
  }

  // ---------- playhead ----------

  private tickPlayhead(): void {
    const step = (): void => {
      const beat = this.app.transport.positionBeat()
      this.playhead.style.transform = `translateX(${beat * this.ppb}px)`
      const bar = Math.floor(beat / 4) + 1
      const sub = Math.floor(beat % 4) + 1
      this.positionChip.textContent = `${bar}.${sub}`
      if (this.app.transport.playing) {
        const x = beat * this.ppb
        const view = this.scroller
        if (x < view.scrollLeft || x > view.scrollLeft + view.clientWidth - 80) {
          view.scrollLeft = Math.max(0, x - 80)
        }
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
}

function btn(text: string, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'seg-btn'
  b.textContent = text
  b.title = title
  return b
}
