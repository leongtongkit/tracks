import type { Store } from '../state/store'

// TE-pad-style segmented selector bound to a structural param.
export function segmented(
  store: Store,
  path: string,
  options: readonly (string | number)[],
  labels?: Record<string, string>,
): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'seg'
  el.setAttribute('role', 'radiogroup')
  const buttons = new Map<string, HTMLButtonElement>()

  for (const opt of options) {
    const key = String(opt)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'seg-btn'
    btn.textContent = labels?.[key] ?? key
    btn.setAttribute('role', 'radio')
    btn.addEventListener('click', () => store.set(path, opt))
    buttons.set(key, btn)
    el.appendChild(btn)
  }

  const sync = (value: unknown): void => {
    for (const [key, btn] of buttons) {
      const on = key === String(value)
      btn.classList.toggle('seg-on', on)
      btn.setAttribute('aria-checked', String(on))
    }
  }
  sync(store.get(path))
  store.subscribe(path, sync)
  return el
}

// Chunky power button bound to a boolean param.
export function power(store: Store, path: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'power'
  btn.setAttribute('role', 'switch')
  btn.setAttribute('aria-label', label)
  btn.innerHTML = `<span class="power-dot" aria-hidden="true"></span>`
  btn.addEventListener('click', () => store.set(path, !(store.get(path) as boolean)))
  const sync = (v: unknown): void => {
    btn.classList.toggle('power-on', Boolean(v))
    btn.setAttribute('aria-checked', String(Boolean(v)))
  }
  sync(store.get(path))
  store.subscribe(path, sync)
  return btn
}

// Module panel scaffold: a cream card with a printed header strip.
export function panel(title: string, accent: string, ...children: HTMLElement[]): HTMLElement {
  const el = document.createElement('section')
  el.className = `panel panel-${accent}`
  const head = document.createElement('header')
  head.className = 'panel-head'
  const name = document.createElement('h2')
  name.textContent = title
  head.appendChild(name)
  el.appendChild(head)
  const body = document.createElement('div')
  body.className = 'panel-body'
  for (const child of children) body.appendChild(child)
  el.appendChild(body)
  return el
}

// Header slot helper: stick a control (power button, selector) in the strip.
export function panelHeadExtra(panelEl: HTMLElement, extra: HTMLElement): void {
  panelEl.querySelector('.panel-head')?.appendChild(extra)
}

export function knobRow(...children: HTMLElement[]): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'knob-row'
  for (const child of children) el.appendChild(child)
  return el
}
