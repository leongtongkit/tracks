// Audio track + audio clip editors. The track editor (Instrument tab) covers
// importing and how to record; the clip editor (Clip tab) covers per-clip
// gain and processing. Autotune mounts into the clip editor.

import type { DawApp } from '../daw-app'
import type { Clip } from '../project'
import { sampleStore } from '../samples'
import { miniDial } from './mini-dial'

export function buildAudioTrackEditor(app: DawApp, trackId: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'audio-editor'

  const info = document.createElement('p')
  info.className = 'audio-hint'
  info.textContent =
    'Record: arm this track, hit Rec, sing or play — the take lands on the timeline when you stop. ' +
    'Import: drop an audio file on this track’s lane, or use the button.'
  root.appendChild(info)

  if (app.micError) {
    const err = document.createElement('p')
    err.className = 'audio-error'
    err.textContent = app.micError
    root.appendChild(err)
  }

  const row = document.createElement('div')
  row.className = 'sampler-row'
  const importBtn = document.createElement('button')
  importBtn.type = 'button'
  importBtn.className = 'seg-btn'
  importBtn.textContent = 'Import audio'
  const file = document.createElement('input')
  file.type = 'file'
  file.accept = 'audio/*,.wav,.mp3,.m4a,.ogg,.flac'
  file.style.display = 'none'
  file.addEventListener('change', () => {
    const f = file.files?.[0]
    if (!f) return
    const at = Math.floor(app.transport.positionBeat())
    void app.importAudioFile(f, trackId, at).catch(() => alert('Could not decode that audio file.'))
    file.value = ''
  })
  importBtn.addEventListener('click', () => file.click())
  row.appendChild(importBtn)
  row.appendChild(file)
  root.appendChild(row)
  return root
}

export type ClipProcessor = (host: HTMLElement, app: DawApp, trackId: string, clip: Clip) => void
let clipProcessor: ClipProcessor | null = null

// P5 (autotune & co.) plugs extra processing UI in through this hook.
export function setClipProcessor(fn: ClipProcessor): void {
  clipProcessor = fn
}

export function buildAudioClipEditor(app: DawApp, trackId: string, clip: Clip): HTMLElement {
  const root = document.createElement('div')
  root.className = 'audio-editor'
  const region = clip.audio
  if (!region) return root

  const buffer = sampleStore.get(region.sampleId)
  const info = document.createElement('p')
  info.className = 'audio-hint'
  info.textContent = buffer
    ? `${sampleStore.name(region.sampleId) ?? 'audio'} — ${buffer.duration.toFixed(2)}s @ ${buffer.sampleRate} Hz. Drag the clip to move it; drag its right edge to trim.`
    : 'Sample missing (it was not embedded in this project file).'
  root.appendChild(info)

  const row = document.createElement('div')
  row.className = 'sampler-row'
  row.appendChild(
    miniDial({
      label: 'Gain',
      get: () => region.gain,
      set: v => {
        app.checkpoint('clip gain')
        region.gain = v
      },
      min: 0,
      max: 2,
      reset: 1,
      fmt: v => String(Math.round(v * 100)),
    }),
  )
  root.appendChild(row)

  clipProcessor?.(root, app, trackId, clip)
  return root
}
