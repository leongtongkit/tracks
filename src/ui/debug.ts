// Throwaway Phase 2/3 control surface, auto-generated from the param registry.
// Replaced wholesale by the real UI in Phase 4.

import { CONTINUOUS, STRUCTURAL, denormalize, normalize } from '../params/registry'
import type { Store } from '../state/store'

export function buildDebugUI(root: HTMLElement, store: Store): void {
  const wrap = document.createElement('div')
  wrap.id = 'debug-ui'

  const groups = new Map<string, HTMLElement>()
  const groupEl = (name: string): HTMLElement => {
    let el = groups.get(name)
    if (!el) {
      el = document.createElement('fieldset')
      const legend = document.createElement('legend')
      legend.textContent = name
      el.appendChild(legend)
      groups.set(name, el)
      wrap.appendChild(el)
    }
    return el
  }

  for (const p of STRUCTURAL) {
    const row = document.createElement('label')
    row.className = 'debug-row'
    const span = document.createElement('span')
    span.textContent = p.label
    row.appendChild(span)

    if (p.options.length === 0) {
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = store.get(p.path) as boolean
      box.addEventListener('change', () => store.set(p.path, box.checked))
      store.subscribe(p.path, v => {
        box.checked = v as boolean
      })
      row.appendChild(box)
    } else {
      const sel = document.createElement('select')
      for (const opt of p.options) {
        const o = document.createElement('option')
        o.value = String(opt)
        o.textContent = String(opt)
        sel.appendChild(o)
      }
      sel.value = String(store.get(p.path))
      sel.addEventListener('change', () => store.set(p.path, sel.value))
      store.subscribe(p.path, v => {
        sel.value = String(v)
      })
      row.appendChild(sel)
    }
    groupEl(p.group).appendChild(row)
  }

  for (const p of CONTINUOUS) {
    const row = document.createElement('label')
    row.className = 'debug-row'
    const span = document.createElement('span')
    const readout = document.createElement('em')
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '1000'
    const show = (value: number): void => {
      slider.value = String(Math.round(normalize(p, value) * 1000))
      readout.textContent = `${value.toFixed(value >= 100 ? 0 : 3)}${p.unit}`
    }
    show(store.get(p.path) as number)
    span.textContent = p.label
    slider.addEventListener('input', () => {
      const value = denormalize(p, Number(slider.value) / 1000)
      store.set(p.path, value)
      readout.textContent = `${value.toFixed(value >= 100 ? 0 : 3)}${p.unit}`
    })
    store.subscribe(p.path, v => show(v as number))
    row.appendChild(span)
    row.appendChild(slider)
    row.appendChild(readout)
    groupEl(p.group).appendChild(row)
  }

  root.appendChild(wrap)
}
