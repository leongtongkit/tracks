// Tiny drag-strip value control for mixer rows: drag vertically, double-click
// to reset. Reads like an LED chip, costs almost no space.

export interface MiniDialOpts {
  label: string
  get(): number
  set(v: number): void
  min: number
  max: number
  reset: number
  fmt(v: number): string
}

export function miniDial(opts: MiniDialOpts): HTMLElement {
  const el = document.createElement('div')
  el.className = 'mini-dial'
  const label = document.createElement('span')
  label.textContent = opts.label
  const chip = document.createElement('output')
  chip.className = 'mini-dial-chip'
  el.appendChild(label)
  el.appendChild(chip)

  const render = (): void => {
    chip.textContent = opts.fmt(opts.get())
  }
  render()

  let dragId: number | null = null
  let lastY = 0
  chip.addEventListener('pointerdown', e => {
    e.preventDefault()
    dragId = e.pointerId
    lastY = e.clientY
    try {
      chip.setPointerCapture(e.pointerId)
    } catch {
      // synthetic events
    }
  })
  chip.addEventListener('pointermove', e => {
    if (dragId !== e.pointerId) return
    const dy = lastY - e.clientY
    lastY = e.clientY
    const range = opts.max - opts.min
    const next = Math.min(opts.max, Math.max(opts.min, opts.get() + dy * (range / 150)))
    opts.set(next)
    render()
  })
  const end = (e: PointerEvent): void => {
    if (dragId === e.pointerId) dragId = null
  }
  chip.addEventListener('pointerup', end)
  chip.addEventListener('pointercancel', end)
  chip.addEventListener('dblclick', () => {
    opts.set(opts.reset)
    render()
  })
  chip.style.cursor = 'ns-resize'
  chip.style.touchAction = 'none'
  return el
}
