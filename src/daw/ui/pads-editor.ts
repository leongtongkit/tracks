// Sampled pads editor: a 4x4 MPC-style grid. Tap a pad to hear it, drop an
// audio file on a pad (or use Load) to fill it, and tweak the selected pad's
// gain/tune/mode below.

import type { DawApp } from '../daw-app'
import { PAD_BASE_PITCH, PAD_COUNT } from '../project'
import { sampleStore } from '../samples'
import { miniDial } from './mini-dial'

export function buildPadsEditor(app: DawApp, trackId: string): HTMLElement {
  const track = app.track(trackId)
  const root = document.createElement('div')
  root.className = 'pads-editor'
  if (!track) return root
  let selected = 0

  const hint = document.createElement('p')
  hint.className = 'audio-hint'
  hint.textContent =
    'Tap a pad to play it. Drop an audio file on any pad (or select one and Load). Pads sit on the piano roll rows P1–P16, so you can sequence them in clips.'

  const grid = document.createElement('div')
  grid.className = 'pads-grid'

  const params = document.createElement('div')
  params.className = 'sampler-row'

  const file = document.createElement('input')
  file.type = 'file'
  file.accept = 'audio/*,.wav,.mp3,.m4a,.ogg,.flac'
  file.style.display = 'none'
  file.addEventListener('change', () => {
    const f = file.files?.[0]
    if (!f) return
    void app
      .loadPadFile(trackId, selected, f)
      .then(() => {
        renderGrid()
        renderParams()
        audition(selected)
      })
      .catch(() => alert('Could not decode that audio file.'))
    file.value = ''
  })

  const audition = (idx: number): void => {
    app.ensureAudio().noteOn(trackId, PAD_BASE_PITCH + idx, 0.9)
    setTimeout(() => app.song?.noteOff(trackId, PAD_BASE_PITCH + idx), 250)
  }

  const renderGrid = (): void => {
    grid.innerHTML = ''
    for (let i = 0; i < PAD_COUNT; i++) {
      const pad = track.pads.pads[i]
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'pad-cell'
      cell.classList.toggle('pad-cell-on', i === selected)
      cell.classList.toggle('pad-cell-empty', !pad.sampleId)
      const num = document.createElement('span')
      num.className = 'pad-num'
      num.textContent = `P${i + 1}`
      const name = document.createElement('span')
      name.className = 'pad-name'
      name.textContent = pad.sampleId ? (sampleStore.name(pad.sampleId) ?? 'sample') : 'drop audio'
      cell.appendChild(num)
      cell.appendChild(name)
      cell.title = pad.sampleId ? 'Tap to play — drop audio to replace' : 'Drop an audio file here, or click then Load'
      cell.addEventListener('pointerdown', () => {
        selected = i
        renderParams()
        for (const el of grid.children) el.classList.remove('pad-cell-on')
        cell.classList.add('pad-cell-on')
        if (pad.sampleId) audition(i)
      })
      cell.addEventListener('dragover', e => {
        e.preventDefault()
        cell.classList.add('pad-cell-drop')
      })
      cell.addEventListener('dragleave', () => cell.classList.remove('pad-cell-drop'))
      cell.addEventListener('drop', e => {
        e.preventDefault()
        cell.classList.remove('pad-cell-drop')
        const f = e.dataTransfer?.files?.[0]
        if (!f) return
        selected = i
        void app
          .loadPadFile(trackId, i, f)
          .then(() => {
            renderGrid()
            renderParams()
            audition(i)
          })
          .catch(() => alert('Could not decode that audio file.'))
      })
      grid.appendChild(cell)
    }
  }

  const renderParams = (): void => {
    const pad = track.pads.pads[selected]
    params.innerHTML = ''
    const tag = document.createElement('span')
    tag.className = 'mix-tag pads-param-tag'
    tag.textContent = `Pad ${selected + 1}`
    params.appendChild(tag)

    const load = document.createElement('button')
    load.type = 'button'
    load.className = 'seg-btn'
    load.textContent = pad.sampleId ? 'Replace' : 'Load'
    load.title = 'Load an audio file onto this pad'
    load.addEventListener('click', () => file.click())
    params.appendChild(load)

    params.appendChild(
      miniDial({
        label: 'Gain',
        get: () => pad.gain,
        set: v => {
          app.checkpoint(`pad gain ${trackId}`)
          pad.gain = v
        },
        min: 0,
        max: 2,
        reset: 1,
        fmt: v => String(Math.round(v * 100)),
      }),
    )
    params.appendChild(
      miniDial({
        label: 'Tune',
        get: () => pad.tune,
        set: v => {
          app.checkpoint(`pad tune ${trackId}`)
          pad.tune = Math.round(v)
        },
        min: -24,
        max: 24,
        reset: 0,
        fmt: v => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0)),
      }),
    )

    const mode = document.createElement('button')
    mode.type = 'button'
    mode.className = 'seg-btn'
    mode.textContent = pad.oneshot ? 'One-shot' : 'Gate'
    mode.title = 'One-shot plays the whole sample; Gate stops when you release'
    mode.classList.toggle('seg-on', !pad.oneshot)
    mode.addEventListener('click', () => {
      app.checkpoint(`pad mode ${trackId}`)
      pad.oneshot = !pad.oneshot
      mode.textContent = pad.oneshot ? 'One-shot' : 'Gate'
      mode.classList.toggle('seg-on', !pad.oneshot)
    })
    params.appendChild(mode)

    if (pad.sampleId) {
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'seg-btn'
      clear.textContent = 'Clear'
      clear.title = 'Empty this pad'
      clear.addEventListener('click', () => {
        app.checkpoint(`pad clear ${trackId}`)
        pad.sampleId = null
        renderGrid()
        renderParams()
      })
      params.appendChild(clear)
    }
  }

  renderGrid()
  renderParams()
  root.appendChild(hint)
  root.appendChild(grid)
  root.appendChild(params)
  root.appendChild(file)
  return root
}
