// Drum machine editor: kit picker, master level, and a row per drum voice —
// pad to audition, dials for level/tune/decay. Edits write straight into the
// project's DrumPatch; the machine reads it live at trigger time.

import type { DawApp } from '../daw-app'
import { DRUM_ORDER } from '../instruments/drums'
import { miniDial } from './mini-dial'

export function buildDrumEditor(app: DawApp, trackId: string): HTMLElement {
  const track = app.track(trackId)
  const root = document.createElement('div')
  root.className = 'drum-editor'
  if (!track) return root
  const drums = track.drums

  const top = document.createElement('div')
  top.className = 'drum-editor-top'
  for (const kit of ['808', '909'] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'seg-btn'
    b.textContent = kit
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
  root.appendChild(top)

  const grid = document.createElement('div')
  grid.className = 'drum-grid'
  for (const { id, pitch, label } of DRUM_ORDER) {
    const row = document.createElement('div')
    row.className = 'drum-row'

    const pad = document.createElement('button')
    pad.type = 'button'
    pad.className = 'drum-pad'
    pad.textContent = label
    pad.title = 'Click to hear'
    pad.addEventListener('pointerdown', () => {
      app.ensureAudio().noteOn(trackId, pitch, 0.9)
      pad.classList.add('drum-pad-hit')
      setTimeout(() => pad.classList.remove('drum-pad-hit'), 120)
    })
    row.appendChild(pad)

    const params = [
      { key: 'level' as const, label: 'Lvl', min: 0, max: 1.5, reset: 1, fmt: (v: number) => String(Math.round(v * 100)) },
      { key: 'tune' as const, label: 'Tune', min: -12, max: 12, reset: 0, fmt: (v: number) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0)) },
      { key: 'decay' as const, label: 'Dec', min: 0.2, max: 3, reset: 1, fmt: (v: number) => v.toFixed(2) },
    ]
    for (const p of params) {
      row.appendChild(
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
    grid.appendChild(row)
  }
  root.appendChild(grid)
  return root
}
