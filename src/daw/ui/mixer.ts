// Mixer view: one channel strip per track (meter, 3-band EQ, compressor,
// sends, pan, fader, mute/solo) plus a master strip. Lives in the bottom
// panel's Mixer tab; meters animate only while mounted.

import type { DawApp } from '../daw-app'
import type { TrackData } from '../project'
import { miniDial } from './mini-dial'

export class MixerView {
  readonly el: HTMLElement
  private readonly app: DawApp
  private meters: { canvas: HTMLCanvasElement; peak: () => number; hold: number }[] = []
  private raf = 0

  constructor(app: DawApp) {
    this.app = app
    this.el = document.createElement('div')
    this.el.className = 'mixer'
  }

  mount(): HTMLElement {
    this.render()
    this.startMeters()
    return this.el
  }

  unmount(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  render(): void {
    this.el.innerHTML = ''
    this.meters = []
    for (const track of this.app.project.tracks) {
      this.el.appendChild(this.strip(track))
    }
    this.el.appendChild(this.masterStrip())
  }

  private dial(
    label: string,
    track: TrackData,
    opts: { min: number; max: number; reset: number; fmt?: (v: number) => string },
    get: () => number,
    apply: (v: number) => Partial<TrackData['mixer']>,
  ): HTMLElement {
    return miniDial({
      label,
      get,
      set: v => this.app.setMixer(track.id, apply(v)),
      min: opts.min,
      max: opts.max,
      reset: opts.reset,
      fmt: opts.fmt ?? (v => v.toFixed(1)),
    })
  }

  private strip(track: TrackData): HTMLElement {
    const m = track.mixer
    const strip = document.createElement('div')
    strip.className = 'mix-strip'

    const name = document.createElement('div')
    name.className = 'mix-name'
    name.textContent = track.name
    strip.appendChild(name)

    // meter
    const canvas = document.createElement('canvas')
    canvas.className = 'mix-meter'
    canvas.width = 10
    canvas.height = 64
    strip.appendChild(canvas)
    this.meters.push({
      canvas,
      peak: () => this.app.song?.channel(track.id)?.meterPeak() ?? 0,
      hold: 0,
    })

    const eq = document.createElement('div')
    eq.className = 'mix-section'
    eq.appendChild(sectionTag('EQ'))
    eq.appendChild(this.dial('Hi', track, { min: -12, max: 12, reset: 0, fmt: db }, () => m.eq.high, v => ({ eq: { ...m.eq, high: v } })))
    eq.appendChild(this.dial('Mid', track, { min: -12, max: 12, reset: 0, fmt: db }, () => m.eq.mid, v => ({ eq: { ...m.eq, mid: v } })))
    eq.appendChild(this.dial('Lo', track, { min: -12, max: 12, reset: 0, fmt: db }, () => m.eq.low, v => ({ eq: { ...m.eq, low: v } })))
    strip.appendChild(eq)

    const comp = document.createElement('div')
    comp.className = 'mix-section'
    const compBtn = document.createElement('button')
    compBtn.type = 'button'
    compBtn.className = 'seg-btn mix-comp-on'
    compBtn.textContent = 'Comp'
    compBtn.classList.toggle('seg-on', m.comp.on)
    compBtn.addEventListener('click', () => {
      this.app.setMixer(track.id, { comp: { ...m.comp, on: !m.comp.on } })
      compBtn.classList.toggle('seg-on', m.comp.on)
    })
    comp.appendChild(compBtn)
    comp.appendChild(this.dial('Thr', track, { min: -60, max: 0, reset: -18, fmt: db }, () => m.comp.threshold, v => ({ comp: { ...m.comp, threshold: v } })))
    comp.appendChild(this.dial('Rat', track, { min: 1, max: 20, reset: 3, fmt: v => `${v.toFixed(1)}:1` }, () => m.comp.ratio, v => ({ comp: { ...m.comp, ratio: v } })))
    comp.appendChild(this.dial('Atk', track, { min: 0.001, max: 0.3, reset: 0.01, fmt: ms }, () => m.comp.attack, v => ({ comp: { ...m.comp, attack: v } })))
    comp.appendChild(this.dial('Rel', track, { min: 0.02, max: 1, reset: 0.18, fmt: ms }, () => m.comp.release, v => ({ comp: { ...m.comp, release: v } })))
    comp.appendChild(this.dial('Mk', track, { min: 0.25, max: 4, reset: 1, fmt: x100 }, () => m.comp.makeup, v => ({ comp: { ...m.comp, makeup: v } })))
    strip.appendChild(comp)

    const sends = document.createElement('div')
    sends.className = 'mix-section'
    sends.appendChild(sectionTag('Send'))
    sends.appendChild(this.dial('Rev', track, { min: 0, max: 1, reset: 0, fmt: x100 }, () => m.sendA, v => ({ sendA: v })))
    sends.appendChild(this.dial('Dly', track, { min: 0, max: 1, reset: 0, fmt: x100 }, () => m.sendB, v => ({ sendB: v })))
    strip.appendChild(sends)

    const out = document.createElement('div')
    out.className = 'mix-section'
    out.appendChild(this.dial('Pan', track, {
      min: -1, max: 1, reset: 0,
      fmt: v => (Math.abs(v) < 0.05 ? 'C' : v < 0 ? `L${Math.round(-v * 50)}` : `R${Math.round(v * 50)}`),
    }, () => m.pan, v => ({ pan: v })))
    out.appendChild(this.dial('Vol', track, { min: 0, max: 1, reset: 0.8, fmt: x100 }, () => m.volume, v => ({ volume: v })))
    const ms2 = document.createElement('div')
    ms2.className = 'mix-ms'
    const mute = document.createElement('button')
    mute.type = 'button'
    mute.className = 'seg-btn'
    mute.textContent = 'M'
    mute.classList.toggle('seg-on', m.mute)
    mute.addEventListener('click', () => this.app.setMixer(track.id, { mute: !m.mute }))
    const solo = document.createElement('button')
    solo.type = 'button'
    solo.className = 'seg-btn'
    solo.textContent = 'S'
    solo.classList.toggle('seg-on', m.solo)
    solo.addEventListener('click', () => this.app.setMixer(track.id, { solo: !m.solo }))
    ms2.appendChild(mute)
    ms2.appendChild(solo)
    out.appendChild(ms2)
    strip.appendChild(out)

    return strip
  }

  private masterStrip(): HTMLElement {
    const strip = document.createElement('div')
    strip.className = 'mix-strip mix-master'
    const name = document.createElement('div')
    name.className = 'mix-name'
    name.textContent = 'MASTER'
    strip.appendChild(name)
    const canvas = document.createElement('canvas')
    canvas.className = 'mix-meter'
    canvas.width = 10
    canvas.height = 64
    strip.appendChild(canvas)
    this.meters.push({ canvas, peak: () => this.app.song?.masterPeak() ?? 0, hold: 0 })
    const note = document.createElement('div')
    note.className = 'mix-note'
    note.textContent = 'Send buses: Rev = plate reverb, Dly = dark 1/8 delay. Limiter on the 2-bus.'
    strip.appendChild(note)
    return strip
  }

  private startMeters(): void {
    cancelAnimationFrame(this.raf)
    const step = (): void => {
      for (const m of this.meters) {
        const peak = m.peak()
        m.hold = Math.max(peak, m.hold * 0.94)
        const g = m.canvas.getContext('2d')
        if (!g) continue
        const h = m.canvas.height
        g.clearRect(0, 0, m.canvas.width, h)
        g.fillStyle = '#2a2a2d'
        g.fillRect(0, 0, m.canvas.width, h)
        const lvl = Math.min(1, m.hold)
        g.fillStyle = lvl > 0.92 ? '#ff4d00' : '#ff6a2b'
        g.fillRect(0, h - lvl * h, m.canvas.width, lvl * h)
      }
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }
}

function sectionTag(text: string): HTMLElement {
  const s = document.createElement('span')
  s.className = 'mix-tag'
  s.textContent = text
  return s
}

const db = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`
const ms = (v: number): string => `${(v * 1000).toFixed(0)}ms`
const x100 = (v: number): string => String(Math.round(v * 100))
