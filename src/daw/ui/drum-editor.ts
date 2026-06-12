// Drum machine editor: kit picker, master level, and a pad grid — tap a pad
// to hear it and select it; the selected drum's level/tune/decay dials sit
// below the grid. Edits write straight into the project's DrumPatch; the
// machine reads it live at trigger time.

import type { DawApp } from '../daw-app'
import { DRUM_ORDER } from '../instruments/drums'
import { miniDial } from './mini-dial'

export function buildDrumEditor(app: DawApp, trackId: string): HTMLElement {
  const track = app.track(trackId)
  const root = document.createElement('div')
  root.className = 'drum-editor'
  if (!track) return root
  const drums = track.drums
  let selected = 0

  const top = document.createElement('div')
  top.className = 'drum-editor-top'
  for (const kit of ['808', '909'] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'seg-btn'
    b.textContent = kit
    b.title = kit === '808' ? 'Deep, boomy kit' : 'Punchy, bright kit'
    b.classList.toggle('seg-on', drums.kit === kit)
    b.addEventListener('click', () => {
      app.checkpoint(`drum kit ${trackId}`)
      drums.kit = kit
      for (const el of top.querySelectorAll('.seg-btn')) el.classList.toggle('seg-on', el.textContent === kit)
    })
    top.appendChild(b)
  }
  top.appendChild(
    miniDial({
      label: 'Level',
      get: () => drums.level,
      set: v => {
        app.checkpoint(`drum level ${trackId}`)
        drums.level = v
      },
      min: 0,
      max: 1.5,
      reset: 0.9,
      fmt: v => String(Math.round(v * 100)),
    }),
  )
  const hint = document.createElement('span')
  hint.className = 'audio-hint'
  hint.textContent = 'Tap a pad to hear it. Drums live on the labeled piano-roll rows, so draw beats in a clip.'
  top.appendChild(hint)
  root.appendChild(top)

  const grid = document.createElement('div')
  grid.className = 'pads-grid drum-pads-grid'

  const params = document.createElement('div')
  params.className = 'sampler-row'

  const renderParams = (): void => {
    const { id, label } = DRUM_ORDER[selected]
    params.innerHTML = ''
    const tag = document.createElement('span')
    tag.className = 'mix-tag pads-param-tag'
    tag.textContent = label
    params.appendChild(tag)
    const defs = [
      { key: 'level' as const, label: 'Level', min: 0, max: 1.5, reset: 1, fmt: (v: number) => String(Math.round(v * 100)) },
      { key: 'tune' as const, label: 'Tune', min: -12, max: 12, reset: 0, fmt: (v: number) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0)) },
      { key: 'decay' as const, label: 'Decay', min: 0.2, max: 3, reset: 1, fmt: (v: number) => v.toFixed(2) },
    ]
    for (const p of defs) {
      params.appendChild(
        miniDial({
          label: p.label,
          get: () => drums.drums[id]?.[p.key] ?? p.reset,
          set: v => {
            app.checkpoint(`drum ${id} ${trackId}`)
            drums.drums[id] = { ...drums.drums[id], [p.key]: v }
          },
          min: p.min,
          max: p.max,
          reset: p.reset,
          fmt: p.fmt,
        }),
      )
    }
  }

  DRUM_ORDER.forEach(({ pitch, label }, i) => {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = 'pad-cell'
    cell.classList.toggle('pad-cell-on', i === selected)
    const name = document.createElement('span')
    name.className = 'pad-name'
    name.textContent = label
    cell.appendChild(name)
    cell.title = 'Tap to play, select to edit'
    cell.addEventListener('pointerdown', () => {
      selected = i
      renderParams()
      for (const el of grid.children) el.classList.remove('pad-cell-on')
      cell.classList.add('pad-cell-on')
      app.ensureAudio().noteOn(trackId, pitch, 0.9)
      cell.classList.add('pad-cell-hit')
      setTimeout(() => cell.classList.remove('pad-cell-hit'), 130)
    })
    grid.appendChild(cell)
  })

  renderParams()
  root.appendChild(grid)
  root.appendChild(params)
  return root
}
