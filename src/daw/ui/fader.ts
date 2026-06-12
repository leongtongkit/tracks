// Vertical channel fader: drag the handle (or click anywhere on the track),
// double-click resets. The most-touched mixer control gets a real physical
// affordance instead of a drag-strip chip.

export interface FaderOpts {
  get(): number
  set(v: number): void
  min: number
  max: number
  reset: number
  fmt(v: number): string
}

export function fader(opts: FaderOpts): HTMLElement {
  const el = document.createElement('div')
  el.className = 'fader'
  el.title = 'Volume: drag, double-click to reset'
  const rail = document.createElement('div')
  rail.className = 'fader-rail'
  const fill = document.createElement('div')
  fill.className = 'fader-fill'
  const handle = document.createElement('div')
  handle.className = 'fader-handle'
  rail.appendChild(fill)
  rail.appendChild(handle)
  const chip = document.createElement('output')
  chip.className = 'mini-dial-chip fader-chip'
  el.appendChild(rail)
  el.appendChild(chip)

  const render = (): void => {
    const frac = (opts.get() - opts.min) / (opts.max - opts.min)
    handle.style.bottom = `calc(${(frac * 100).toFixed(2)}% - 7px)`
    fill.style.height = `${(frac * 100).toFixed(2)}%`
    chip.textContent = opts.fmt(opts.get())
  }
  render()

  const applyFromY = (clientY: number): void => {
    const r = rail.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height))
    opts.set(opts.min + frac * (opts.max - opts.min))
    render()
  }

  let dragging = false
  rail.addEventListener('pointerdown', e => {
    e.preventDefault()
    dragging = true
    try {
      rail.setPointerCapture(e.pointerId)
    } catch {
      // synthetic
    }
    applyFromY(e.clientY)
  })
  rail.addEventListener('pointermove', e => {
    if (dragging) applyFromY(e.clientY)
  })
  const end = (): void => {
    dragging = false
  }
  rail.addEventListener('pointerup', end)
  rail.addEventListener('pointercancel', end)
  el.addEventListener('dblclick', () => {
    opts.set(opts.reset)
    render()
  })
  return el
}
