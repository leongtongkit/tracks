import { denormalize, normalize, type ContinuousParam } from '../params/registry'
import type { Store } from '../state/store'

export type KnobSize = 'sm' | 'md' | 'lg'
export type KnobAccent = 'coral' | 'teal' | 'amber' | 'ink'

const SWEEP_DEG = 270 // -135° .. +135°
const ARC_R = 24
const ARC_C = 2 * Math.PI * ARC_R * (SWEEP_DEG / 360)

export interface KnobOptions {
  size?: KnobSize
  accent?: KnobAccent
  label?: string // override registry label
}

// The one knob. SVG value arc + ridged cap with a position line.
// Drag vertically (Shift = fine), double-click to reset, wheel to nudge,
// focus + arrow keys for accessibility.
export class Knob {
  readonly el: HTMLDivElement
  private readonly param: ContinuousParam
  private readonly store: Store
  private readonly cap: HTMLDivElement
  private readonly arcFill: SVGPathElement
  private readonly readout: HTMLOutputElement
  private norm = 0
  private dragNorm = 0

  constructor(param: ContinuousParam, store: Store, opts: KnobOptions = {}) {
    this.param = param
    this.store = store
    const size = opts.size ?? 'md'
    const accent = opts.accent ?? 'coral'

    this.el = document.createElement('div')
    this.el.className = `knob knob-${size} knob-${accent}`

    const dial = document.createElement('div')
    dial.className = 'knob-dial'
    dial.tabIndex = 0
    dial.setAttribute('role', 'slider')
    dial.setAttribute('aria-label', opts.label ?? param.label)
    dial.setAttribute('aria-valuemin', String(param.min))
    dial.setAttribute('aria-valuemax', String(param.max))

    dial.innerHTML = `
      <svg class="knob-arc" viewBox="0 0 56 56" aria-hidden="true">
        <path class="knob-arc-track" d="${arcPath()}" pathLength="${ARC_C}"/>
        <path class="knob-arc-fill" d="${arcPath()}" pathLength="${ARC_C}"/>
      </svg>
      <div class="knob-cap"><div class="knob-line"></div></div>
    `
    this.arcFill = dial.querySelector('.knob-arc-fill')!
    this.cap = dial.querySelector('.knob-cap')!

    const label = document.createElement('span')
    label.className = 'knob-label'
    label.textContent = opts.label ?? param.label

    this.readout = document.createElement('output')
    this.readout.className = 'knob-readout'

    this.el.appendChild(dial)
    this.el.appendChild(label)
    this.el.appendChild(this.readout)

    this.render(store.get(param.path) as number)
    store.subscribe(param.path, v => this.render(v as number))

    this.bindPointer(dial)
    this.bindKeys(dial)
    dial.addEventListener('dblclick', () => this.set(normalize(param, param.default)))
    dial.addEventListener(
      'wheel',
      e => {
        e.preventDefault()
        this.set(this.norm + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.005 : 0.03))
      },
      { passive: false },
    )
  }

  private bindPointer(dial: HTMLElement): void {
    let lastY = 0
    let draggingId: number | null = null
    dial.addEventListener('pointerdown', e => {
      e.preventDefault()
      try {
        dial.setPointerCapture(e.pointerId)
      } catch {
        // synthetic events / exotic browsers: drag still works via draggingId
      }
      dial.classList.add('knob-active')
      draggingId = e.pointerId
      lastY = e.clientY
      this.dragNorm = this.norm
    })
    dial.addEventListener('pointermove', e => {
      if (draggingId !== e.pointerId) return
      const dy = lastY - e.clientY
      lastY = e.clientY
      this.dragNorm += dy * (e.shiftKey ? 0.0008 : 0.005)
      this.dragNorm = Math.min(1, Math.max(0, this.dragNorm))
      this.set(this.dragNorm)
    })
    const end = (e: PointerEvent): void => {
      if (draggingId !== e.pointerId) return
      draggingId = null
      try {
        dial.releasePointerCapture(e.pointerId)
      } catch {
        // capture may never have been taken
      }
      dial.classList.remove('knob-active')
    }
    dial.addEventListener('pointerup', end)
    dial.addEventListener('pointercancel', end)
  }

  private bindKeys(dial: HTMLElement): void {
    dial.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.005 : 0.02
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault()
        this.set(this.norm + step)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault()
        this.set(this.norm - step)
      } else if (e.key === 'Home') {
        e.preventDefault()
        this.set(normalize(this.param, this.param.default))
      }
    })
  }

  private set(norm: number): void {
    const clamped = Math.min(1, Math.max(0, norm))
    this.store.set(this.param.path, denormalize(this.param, clamped))
  }

  private render(value: number): void {
    this.norm = normalize(this.param, value)
    const deg = -135 + this.norm * SWEEP_DEG
    this.cap.style.transform = `rotate(${deg}deg)`
    this.arcFill.style.strokeDasharray = `${this.norm * ARC_C} ${ARC_C}`
    this.readout.textContent = formatValue(this.param, value)
    ;(this.el.querySelector('.knob-dial') as HTMLElement).setAttribute(
      'aria-valuenow',
      value.toPrecision(3),
    )
  }
}

function arcPath(): string {
  // 270° arc centered in a 56×56 box, gap at the bottom
  const cx = 28
  const cy = 28
  const start = polar(cx, cy, ARC_R, -135)
  const end = polar(cx, cy, ARC_R, 135)
  return `M ${start} A ${ARC_R} ${ARC_R} 0 1 1 ${end}`
}

function polar(cx: number, cy: number, r: number, deg: number): string {
  const rad = ((deg - 90) * Math.PI) / 180
  return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`
}

export function formatValue(p: ContinuousParam, v: number): string {
  if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(v < 10 ? 1 : 0)}`
  if (p.unit === 's') return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`
  if (p.unit === 'ct' || p.unit === 'st' || p.unit === 'oct') return `${Math.round(v)}`
  if (p.unit === 'x') return `${v.toFixed(2)}x`
  if (p.max <= 1 && p.min >= -1) return `${Math.round(v * 100)}`
  return v >= 100 ? `${Math.round(v)}` : `${v.toFixed(1)}`
}
