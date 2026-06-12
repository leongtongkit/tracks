// Sampler editor: load an audio file, set the root note and envelope, and
// play it across the keyboard. The sample lands in the shared SampleStore
// (persisted to IndexedDB) and its metadata in project.samples.

import type { DawApp } from '../daw-app'
import { newId } from '../project'
import { sampleStore } from '../samples'
import { miniDial } from './mini-dial'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function noteName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

export function buildSamplerEditor(app: DawApp, trackId: string): HTMLElement {
  const track = app.track(trackId)
  const root = document.createElement('div')
  root.className = 'sampler-editor'
  if (!track) return root
  const sp = track.sampler

  const info = document.createElement('div')
  info.className = 'sampler-info'
  const renderInfo = (): void => {
    if (sp.sampleId && sampleStore.has(sp.sampleId)) {
      const buf = sampleStore.get(sp.sampleId)!
      info.textContent = `${sampleStore.name(sp.sampleId) ?? 'sample'} — ${buf.duration.toFixed(2)}s, ${buf.numberOfChannels === 2 ? 'stereo' : 'mono'}`
    } else {
      info.textContent = 'No sample loaded. Load any audio file (wav/mp3/m4a/ogg) and play it across the keyboard.'
    }
  }
  renderInfo()

  const row = document.createElement('div')
  row.className = 'sampler-row'

  const load = document.createElement('button')
  load.type = 'button'
  load.className = 'seg-btn'
  load.textContent = 'Load sample'
  const file = document.createElement('input')
  file.type = 'file'
  file.accept = 'audio/*,.wav,.mp3,.m4a,.ogg,.flac'
  file.style.display = 'none'
  file.addEventListener('change', () => {
    const f = file.files?.[0]
    if (!f) return
    app.ensureAudio()
    const ctx = app.audioCtx()
    if (!ctx) return
    void f
      .arrayBuffer()
      .then(data => ctx.decodeAudioData(data))
      .then(buffer => {
        app.checkpoint('load sample')
        const id = newId()
        sampleStore.put(id, f.name, buffer)
        sp.sampleId = id
        app.project.samples[id] = { name: f.name, duration: buffer.duration }
        renderInfo()
        app.ensureAudio().noteOn(trackId, sp.root, 0.9)
        setTimeout(() => app.song?.noteOff(trackId, sp.root), 400)
      })
      .catch(() => alert('Could not decode that audio file.'))
    file.value = ''
  })
  load.addEventListener('click', () => file.click())

  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'seg-btn'
  play.textContent = 'Audition'
  play.addEventListener('pointerdown', () => {
    app.ensureAudio().noteOn(trackId, sp.root, 0.9)
  })
  play.addEventListener('pointerup', () => app.song?.noteOff(trackId, sp.root))
  play.addEventListener('pointerleave', () => app.song?.noteOff(trackId, sp.root))

  const loop = document.createElement('button')
  loop.type = 'button'
  loop.className = 'seg-btn'
  loop.textContent = 'Loop'
  loop.classList.toggle('seg-on', sp.loop)
  loop.addEventListener('click', () => {
    app.checkpoint('sampler loop')
    sp.loop = !sp.loop
    loop.classList.toggle('seg-on', sp.loop)
  })

  row.appendChild(load)
  row.appendChild(file)
  row.appendChild(play)
  row.appendChild(loop)
  row.appendChild(
    miniDial({
      label: 'Root',
      get: () => sp.root,
      set: v => {
        app.checkpoint('sampler root')
        sp.root = Math.round(v)
      },
      min: 12,
      max: 96,
      reset: 60,
      fmt: v => noteName(Math.round(v)),
    }),
  )
  row.appendChild(
    miniDial({
      label: 'Gain',
      get: () => sp.gain,
      set: v => {
        app.checkpoint('sampler gain')
        sp.gain = v
      },
      min: 0,
      max: 2,
      reset: 0.9,
      fmt: v => String(Math.round(v * 100)),
    }),
  )
  row.appendChild(
    miniDial({
      label: 'Att',
      get: () => sp.attack,
      set: v => {
        app.checkpoint('sampler att')
        sp.attack = v
      },
      min: 0,
      max: 2,
      reset: 0.003,
      fmt: v => `${(v * 1000).toFixed(0)}ms`,
    }),
  )
  row.appendChild(
    miniDial({
      label: 'Rel',
      get: () => sp.release,
      set: v => {
        app.checkpoint('sampler rel')
        sp.release = v
      },
      min: 0.005,
      max: 4,
      reset: 0.08,
      fmt: v => `${v.toFixed(2)}s`,
    }),
  )

  root.appendChild(info)
  root.appendChild(row)
  return root
}
