// Arrangement view: transport bar, track headers with mixer, beat-ruler with
// loop region, the clip grid with drag/move/resize, and the playhead.

import { AUTO_TARGETS, autoTargetMeta } from '../automation-targets'
import type { DawApp } from '../daw-app'
import { beatsPerBar, projectEndBeat, warpRate, type AutoTarget, type Clip, type TrackData } from '../project'
import { sampleStore } from '../samples'
import { settings } from '../settings'
import { miniDial } from './mini-dial'

const ROW_H = 56
const AUTO_H = 44
// clip drag/resize + ruler snap comes from app settings (Settings panel)
const SNAP = (): number => settings.arrangeSnap
const AUTO_SNAP = 0.25

export class ArrangeView {
  readonly el: HTMLElement
  private readonly app: DawApp
  private ppb = 26 // pixels per beat (zoom)
  private readonly autoOpen = new Map<string, AutoTarget>()
  private ruler!: HTMLElement
  private lanes!: HTMLElement
  private headers!: HTMLElement
  private scroller!: HTMLElement
  private playhead!: HTMLElement
  private positionChip!: HTMLElement
  private playBtn!: HTMLButtonElement
  private recBtn!: HTMLButtonElement
  private loopBtn!: HTMLButtonElement
  private metroBtn!: HTMLButtonElement
  private writeBtn!: HTMLButtonElement

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
    app.on('project', () => {
      // bpm/time-sig/markers all affect the ruler + grid (and waveforms scale with bpm)
      this.renderTransport()
      this.renderRuler()
      this.renderLanes()
    })
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

    const recBtn = btn('Rec', 'Record what you play into the armed track')
    recBtn.classList.add('transport-rec')
    recBtn.addEventListener('click', () => this.app.toggleRecord())
    this.recBtn = recBtn

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

    this.writeBtn = btn('W', 'Automation write: move a mixer knob while playing to record it')
    this.writeBtn.addEventListener('click', () => this.app.toggleAutomationWrite())

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

    // song key (drives autotune)
    const key = document.createElement('span')
    key.className = 'mini-dial'
    const keyLabel = document.createElement('span')
    keyLabel.textContent = 'Key'
    const rootSel = document.createElement('select')
    rootSel.className = 'seg-select'
    ;['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].forEach((n, i) => {
      const o = document.createElement('option')
      o.value = String(i)
      o.textContent = n
      if (this.app.project.key.root === i) o.selected = true
      rootSel.appendChild(o)
    })
    rootSel.addEventListener('change', () => this.app.setKey({ root: Number(rootSel.value) }))
    const scaleSel = document.createElement('select')
    scaleSel.className = 'seg-select'
    for (const [v, label] of [['chromatic', 'Chrom'], ['major', 'Major'], ['minor', 'Minor']] as const) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = label
      if (this.app.project.key.scale === v) o.selected = true
      scaleSel.appendChild(o)
    }
    scaleSel.addEventListener('change', () => this.app.setKey({ scale: scaleSel.value as 'chromatic' | 'major' | 'minor' }))
    key.appendChild(keyLabel)
    key.appendChild(rootSel)
    key.appendChild(scaleSel)

    // time signature (display: bar grouping on the ruler/grid)
    const sig = document.createElement('span')
    sig.className = 'mini-dial'
    sig.title = 'Time signature (sets the bar length shown on the ruler)'
    const sigLabel = document.createElement('span')
    sigLabel.textContent = 'Sig'
    const sigSel = document.createElement('select')
    sigSel.className = 'seg-select'
    for (const [num, den] of [[4, 4], [3, 4], [2, 4], [5, 4], [6, 8], [7, 8], [12, 8]] as const) {
      const o = document.createElement('option')
      o.value = `${num}/${den}`
      o.textContent = `${num}/${den}`
      if (this.app.project.timeSig.num === num && this.app.project.timeSig.den === den) o.selected = true
      sigSel.appendChild(o)
    }
    sigSel.addEventListener('change', () => {
      const [num, den] = sigSel.value.split('/').map(Number)
      this.app.setTimeSig({ num, den })
    })
    sig.appendChild(sigLabel)
    sig.appendChild(sigSel)

    const zoomOut = btn('-', 'Zoom out')
    zoomOut.addEventListener('click', () => this.setZoom(this.ppb / 1.4))
    const zoomIn = btn('+', 'Zoom in')
    zoomIn.addEventListener('click', () => this.setZoom(this.ppb * 1.4))

    const spacer = document.createElement('span')
    spacer.className = 'bar-space'

    bar.appendChild(brand)
    bar.appendChild(rewind)
    bar.appendChild(this.playBtn)
    bar.appendChild(this.recBtn)
    bar.appendChild(this.loopBtn)
    bar.appendChild(this.metroBtn)
    bar.appendChild(this.writeBtn)
    bar.appendChild(this.positionChip)
    bar.appendChild(bpm)
    bar.appendChild(sig)
    bar.appendChild(key)
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
      if (Math.abs(beat - dragStart) >= SNAP() / 2) {
        if (!dragged) this.app.checkpoint('loop region')
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
    // double-click the ruler to drop a marker; Shift+double-click for a tempo change
    this.ruler.addEventListener('dblclick', e => {
      const tgt = e.target as HTMLElement
      if (tgt.classList.contains('ruler-marker') || tgt.classList.contains('ruler-tempo')) return
      const beat = Math.round(this.beatAt(e) * 4) / 4
      if (e.shiftKey) {
        const next = prompt('Tempo (BPM) from this point', String(Math.round(this.app.project.bpm)))
        const bpm = Number(next)
        if (next && Number.isFinite(bpm) && bpm > 0) this.app.addTempo(beat, bpm)
      } else {
        const name = prompt('Marker name', `Section ${this.app.project.markers.length + 1}`)
        if (name?.trim()) this.app.addMarker(beat, name.trim())
      }
    })
  }

  private beatAt(e: MouseEvent): number {
    const rect = this.lanes.getBoundingClientRect()
    const beat = (e.clientX - rect.left) / this.ppb
    return Math.max(0, Math.round(beat / SNAP()) * SNAP())
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
    this.recBtn.classList.toggle('rec-live', this.app.recording)
    this.loopBtn.classList.toggle('seg-on', this.app.project.loop.on)
    this.writeBtn.classList.toggle('seg-on', this.app.automationWrite)
  }

  private renderHeaders(): void {
    this.headers.innerHTML = ''
    for (const track of this.app.project.tracks) {
      this.headers.appendChild(this.trackHeader(track))
    }
    const add = document.createElement('div')
    add.className = 'add-track-row'
    for (const [label, kind, title] of [
      ['+ Synth', 'synth', 'Add a synthesizer track'],
      ['+ Drums', 'drums', 'Add an 808/909 drum machine track'],
      ['+ Sampler', 'sampler', 'Add a sampler track (load any audio, play it across the keys)'],
      ['+ Pads', 'pads', 'Add a 16-pad sample bank (drop audio on pads, finger-drum them)'],
      ['+ Audio', 'audio', 'Add an audio track (record mic / import files)'],
      ['+ SoundFont', 'soundfont', 'Add a SoundFont track — load a .sf2 bank of multisampled instruments'],
      ['+ Group', 'bus', 'Add a group bus — route other tracks into it for shared EQ/comp/FX and one fader'],
    ] as const) {
      const b = btn(label, title)
      b.addEventListener('click', () => this.app.addTrack(kind))
      add.appendChild(b)
    }
    this.headers.appendChild(add)
  }

  private trackHeader(track: TrackData): HTMLElement {
    const el = document.createElement('div')
    el.className = 'track-head'
    if (this.app.armedTrackId === track.id) el.classList.add('track-armed')
    if (track.frozen) el.classList.add('track-frozen')
    el.title = 'Click to select this track and open its instrument'
    // clicking anywhere that isn't a control arms the track + shows its instrument
    el.addEventListener('click', e => {
      const t = e.target as HTMLElement
      if (t.closest('button, select, .mini-dial')) return
      this.app.armTrack(track.id)
    })

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
      if (next?.trim()) this.app.renameTrack(track.id, next)
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
    if (track.kind !== 'bus') {
      const busy = this.app.freezing === track.id
      const frz = document.createElement('button')
      frz.type = 'button'
      frz.className = 'track-freeze' + (track.frozen ? ' seg-on' : '')
      frz.textContent = busy ? '…' : track.frozen ? 'Frozen' : 'Freeze'
      frz.disabled = busy
      frz.title = track.frozen
        ? 'Unfreeze — edit this track live again'
        : 'Freeze — bounce this track to audio to save CPU (unfreeze to edit)'
      frz.addEventListener('click', () => {
        if (track.frozen) this.app.unfreezeTrack(track.id)
        else void this.app.freezeTrack(track.id)
      })
      top.appendChild(frz)
    }
    top.appendChild(del)

    if (this.autoOpen.has(track.id)) el.style.height = `${ROW_H + AUTO_H}px`

    const controls = document.createElement('div')
    controls.className = 'track-head-controls'
    const auto = btn('A', 'Show the automation lane (any channel parameter)')
    auto.classList.toggle('seg-on', this.autoOpen.has(track.id))
    auto.addEventListener('click', () => {
      if (this.autoOpen.has(track.id)) this.autoOpen.delete(track.id)
      else this.autoOpen.set(track.id, 'volume')
      this.renderHeaders()
      this.renderLanes()
    })
    controls.appendChild(auto)
    if (this.autoOpen.has(track.id)) {
      const sel = document.createElement('select')
      sel.className = 'seg-select'
      for (const meta of AUTO_TARGETS) {
        const o = document.createElement('option')
        o.value = meta.key
        o.textContent = meta.label + ((track.auto[meta.key]?.length ?? 0) > 0 ? ' •' : '')
        if (this.autoOpen.get(track.id) === meta.key) o.selected = true
        sel.appendChild(o)
      }
      sel.addEventListener('change', () => {
        this.autoOpen.set(track.id, sel.value as AutoTarget)
        this.renderLanes()
      })
      controls.appendChild(sel)
    }
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
    const bpb = beatsPerBar(this.app.project.timeSig)
    let bar = 1
    for (let b = 0; b < beats; b += bpb) {
      const tick = document.createElement('span')
      tick.className = 'ruler-bar'
      tick.style.left = `${b * this.ppb}px`
      tick.textContent = String(bar++)
      this.ruler.appendChild(tick)
    }
    // tempo events — click to edit bpm, alt-click to delete
    this.app.project.tempoMap.forEach((ev, i) => {
      const flag = document.createElement('span')
      flag.className = 'ruler-tempo'
      flag.style.left = `${ev.beat * this.ppb}px`
      flag.textContent = `${Math.round(ev.bpm)}`
      flag.title = `Tempo ${Math.round(ev.bpm)} BPM — click to change, ${altKey()}-click to delete`
      flag.addEventListener('pointerdown', e => {
        e.stopPropagation()
        if (e.altKey) {
          this.app.removeTempo(i)
        } else {
          const next = prompt('Tempo (BPM) at this point', String(Math.round(ev.bpm)))
          const bpm = Number(next)
          if (next && Number.isFinite(bpm) && bpm > 0) this.app.addTempo(ev.beat, bpm)
        }
      })
      this.ruler.appendChild(flag)
    })
    // section markers — click to jump, alt-click to delete
    this.app.project.markers.forEach((m, i) => {
      const flag = document.createElement('span')
      flag.className = 'ruler-marker'
      flag.style.left = `${m.beat * this.ppb}px`
      flag.textContent = m.name
      flag.title = `${m.name} — click to jump, ${altKey()}-click to delete`
      flag.addEventListener('pointerdown', e => {
        e.stopPropagation()
        if (e.altKey) {
          this.app.removeMarker(i)
        } else {
          this.app.transport.setPosition(m.beat)
          this.app.emit('transport')
        }
      })
      this.ruler.appendChild(flag)
    })
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
    this.lanes.style.backgroundSize = `${this.ppb * beatsPerBar(this.app.project.timeSig)}px 100%, ${this.ppb}px 100%`

    this.app.project.tracks.forEach(track => {
      const lane = document.createElement('div')
      lane.className = 'lane'
      lane.style.height = `${ROW_H}px`
      lane.dataset.trackId = track.id
      lane.addEventListener('dblclick', e => {
        const rect = this.lanes.getBoundingClientRect()
        const beat = Math.floor((e.clientX - rect.left) / this.ppb / SNAP()) * SNAP()
        if (track.kind !== 'audio' && track.kind !== 'bus') this.app.addClip(track.id, beat)
      })
      if (track.kind === 'audio' || track.kind === 'sampler' || track.kind === 'pads') {
        lane.addEventListener('dragover', e => {
          e.preventDefault()
          lane.classList.add('lane-drop')
        })
        lane.addEventListener('dragleave', () => lane.classList.remove('lane-drop'))
        lane.addEventListener('drop', e => {
          e.preventDefault()
          lane.classList.remove('lane-drop')
          const file = e.dataTransfer?.files?.[0]
          if (!file) return
          const fail = (): void => alert('Could not decode that audio file.')
          if (track.kind === 'audio') {
            const rect = this.lanes.getBoundingClientRect()
            const beat = Math.max(0, Math.floor((e.clientX - rect.left) / this.ppb / SNAP()) * SNAP())
            void this.app.importAudioFile(file, track.id, beat).catch(fail)
          } else if (track.kind === 'sampler') {
            void this.app.loadSamplerFile(track.id, file).catch(fail)
          } else {
            const empty = track.pads.pads.findIndex(p => !p.sampleId)
            void this.app.loadPadFile(track.id, empty === -1 ? 0 : empty, file).catch(fail)
          }
        })
      }
      for (const clip of track.clips) {
        lane.appendChild(this.clipEl(track, clip))
      }
      this.lanes.appendChild(lane)
      if (this.autoOpen.has(track.id)) {
        this.lanes.appendChild(this.autoLaneEl(track))
      }
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

    if (clip.audio) {
      el.classList.add('clip-audio')
      const wave = document.createElement('canvas')
      wave.className = 'clip-wave'
      const w = Math.max(2, Math.round(clip.length * this.ppb))
      wave.width = w
      wave.height = ROW_H - 12
      drawWave(wave, clip, this.app.project.bpm)
      el.appendChild(wave)
    }
    const label = document.createElement('span')
    label.className = 'clip-label'
    label.textContent = clip.audio
      ? (sampleStore.name(clip.audio.sampleId) ?? 'audio')
      : clip.notes.length
        ? `${clip.notes.length} notes`
        : 'empty'
    el.appendChild(label)

    const grip = document.createElement('div')
    grip.className = 'clip-grip'
    el.appendChild(grip)

    // audio clips also get a left grip to trim the start (moves the content)
    const lgrip = document.createElement('div')
    lgrip.className = 'clip-grip clip-grip-left'
    if (clip.audio) el.appendChild(lgrip)

    // body drag = move; right grip = resize; left grip = trim start; click = select
    let mode: 'move' | 'size' | 'trim' | null = null
    let startX = 0
    let origStart = 0
    let origLen = 0
    let origOffset = 0
    let moved = false
    el.addEventListener('pointerdown', e => {
      e.stopPropagation()
      e.preventDefault()
      mode = e.target === grip ? 'size' : e.target === lgrip ? 'trim' : 'move'
      startX = e.clientX
      origStart = clip.start
      origLen = clip.length
      origOffset = clip.audio?.offsetSec ?? 0
      moved = false
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // synthetic
      }
    })
    el.addEventListener('pointermove', e => {
      if (!mode) return
      const dBeats = Math.round((e.clientX - startX) / this.ppb / SNAP()) * SNAP()
      if (dBeats !== 0 && !moved) {
        moved = true
        this.app.checkpoint(`${mode} clip ${clip.id}`)
      }
      if (mode === 'move') {
        clip.start = Math.max(0, origStart + dBeats)
        el.style.left = `${clip.start * this.ppb}px`
      } else if (mode === 'size') {
        clip.length = Math.max(1, origLen + dBeats)
        el.style.width = `${clip.length * this.ppb}px`
      } else {
        // trim start: move start right, shorten, and advance the source offset
        // so the audio under the cursor stays put
        const d = Math.min(Math.max(dBeats, -origStart), origLen - 1)
        clip.start = origStart + d
        clip.length = origLen - d
        if (clip.audio) {
          const rate = warpRate(clip.audio, this.app.project.bpm)
          clip.audio.offsetSec = Math.max(0, origOffset + d * (60 / this.app.project.bpm) * rate)
        }
        el.style.left = `${clip.start * this.ppb}px`
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

  // ---------- automation lane ----------

  private autoLaneEl(track: TrackData): HTMLElement {
    const target = this.autoOpen.get(track.id) ?? 'volume'
    const meta = autoTargetMeta(target)
    const points = (track.auto[target] ??= []) // lazily create on first interaction
    const range = meta.max - meta.min
    const toY = (v: number): number => (1 - (v - meta.min) / range) * AUTO_H
    const fromY = (y: number): number => {
      const n = Math.min(1, Math.max(0, y / AUTO_H))
      return meta.min + (1 - n) * range
    }
    const idleV = meta.staticValue(track.mixer)

    const lane = document.createElement('div')
    lane.className = 'auto-lane'
    lane.style.height = `${AUTO_H}px`
    lane.style.width = `${this.widthBeats() * this.ppb}px`

    const draw = (): void => {
      lane.querySelector('svg')?.remove()
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', String(this.widthBeats() * this.ppb))
      svg.setAttribute('height', String(AUTO_H))
      if (points.length > 0) {
        const sorted = [...points].sort((a, b) => a.beat - b.beat)
        // step segments (hold) draw flat-then-jump; others are straight
        const coords = [`0,${toY(sorted[0].value)}`]
        for (let i = 0; i < sorted.length; i++) {
          const p = sorted[i]
          coords.push(`${p.beat * this.ppb},${toY(p.value)}`)
          if (p.shape === 'hold' && i + 1 < sorted.length) {
            coords.push(`${sorted[i + 1].beat * this.ppb},${toY(p.value)}`)
          }
        }
        coords.push(`${this.widthBeats() * this.ppb},${toY(sorted[sorted.length - 1].value)}`)
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
        line.setAttribute('points', coords.join(' '))
        line.setAttribute('class', 'auto-line')
        svg.appendChild(line)
      } else {
        const mid = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        mid.setAttribute('x1', '0')
        mid.setAttribute('x2', String(this.widthBeats() * this.ppb))
        mid.setAttribute('y1', String(toY(idleV)))
        mid.setAttribute('y2', String(toY(idleV)))
        mid.setAttribute('class', 'auto-line auto-line-idle')
        svg.appendChild(mid)
      }
      lane.prepend(svg)
    }

    const dotEl = (p: { beat: number; value: number; shape?: 'linear' | 'hold' | 'exp' }): HTMLElement => {
      const dot = document.createElement('div')
      dot.className = 'auto-dot'
      const place = (): void => {
        dot.style.left = `${p.beat * this.ppb - 4}px`
        dot.style.top = `${toY(p.value) - 4}px`
        dot.classList.toggle('auto-dot-hold', p.shape === 'hold')
        dot.classList.toggle('auto-dot-exp', p.shape === 'exp')
        dot.title = `${meta.fmt(p.value)} — alt-click cycles curve shape (${p.shape ?? 'linear'}), double-click deletes`
      }
      place()
      let dragging = false
      let touched = false
      dot.addEventListener('pointerdown', e => {
        e.preventDefault()
        e.stopPropagation()
        if (e.altKey) {
          // cycle the segment shape leaving this point
          this.app.checkpoint(`automation ${track.id}`)
          p.shape = p.shape === undefined ? 'hold' : p.shape === 'hold' ? 'exp' : undefined
          place()
          draw()
          this.app.automationEdited()
          return
        }
        dragging = true
        touched = false
        try {
          dot.setPointerCapture(e.pointerId)
        } catch {
          // synthetic
        }
      })
      dot.addEventListener('pointermove', e => {
        if (!dragging) return
        if (!touched) {
          touched = true
          this.app.checkpoint(`automation ${track.id}`)
        }
        const rect = lane.getBoundingClientRect()
        p.beat = Math.max(0, Math.round((e.clientX - rect.left) / this.ppb / AUTO_SNAP) * AUTO_SNAP)
        p.value = fromY(e.clientY - rect.top)
        place()
        draw()
      })
      const up = (): void => {
        if (dragging && touched) {
          points.sort((a, b) => a.beat - b.beat)
          this.app.automationEdited()
        }
        dragging = false
      }
      dot.addEventListener('pointerup', up)
      dot.addEventListener('pointercancel', up)
      dot.addEventListener('dblclick', e => {
        e.stopPropagation()
        this.app.checkpoint(`automation ${track.id}`)
        const i = points.indexOf(p)
        if (i !== -1) points.splice(i, 1)
        this.app.automationEdited()
      })
      return dot
    }

    lane.addEventListener('pointerdown', e => {
      if (e.target !== lane && (e.target as HTMLElement).tagName !== 'svg') return
      const rect = lane.getBoundingClientRect()
      this.app.checkpoint(`automation ${track.id}`)
      points.push({
        beat: Math.max(0, Math.round((e.clientX - rect.left) / this.ppb / AUTO_SNAP) * AUTO_SNAP),
        value: fromY(e.clientY - rect.top),
      })
      points.sort((a, b) => a.beat - b.beat)
      this.app.automationEdited()
    })

    draw()
    for (const p of points) lane.appendChild(dotEl(p))
    return lane
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

// min/max peak columns of the clip's slice of its sample
function drawWave(canvas: HTMLCanvasElement, clip: Clip, bpm: number): void {
  const region = clip.audio
  if (!region) return
  const buffer = sampleStore.get(region.sampleId)
  const g = canvas.getContext('2d')
  if (!buffer || !g) return
  const data = buffer.getChannelData(0)
  const spb = 60 / bpm
  const rate = warpRate(region, bpm)
  const i0 = Math.floor(region.offsetSec * buffer.sampleRate)
  const i1 = Math.min(data.length, i0 + Math.floor(clip.length * spb * rate * buffer.sampleRate))
  const span = Math.max(1, i1 - i0)
  const w = canvas.width
  const h = canvas.height
  const mid = h / 2
  g.clearRect(0, 0, w, h)
  g.fillStyle = 'rgba(29, 29, 27, 0.55)'
  const step = span / w
  for (let x = 0; x < w; x++) {
    let min = 1
    let max = -1
    const from = i0 + Math.floor(x * step)
    const to = Math.min(i1, from + Math.ceil(step))
    for (let i = from; i < to; i += Math.max(1, Math.floor(step / 24))) {
      const v = data[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    if (max < min) continue
    g.fillRect(x, mid + min * mid, 1, Math.max(1, (max - min) * mid))
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

function altKey(): string {
  return typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'Option' : 'Alt'
}
