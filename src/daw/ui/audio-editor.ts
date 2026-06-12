// Audio track + audio clip editors. The track editor (Instrument tab) covers
// importing and how to record; the clip editor (Clip tab) covers per-clip
// gain and processing. Autotune mounts into the clip editor.

import type { DawApp } from '../daw-app'
import { autotuneChannel, normalizeChannels, reverseChannels } from '../dsp/autotune'
import { newId, type Clip } from '../project'
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

// Bake a processing function into a NEW sample and point the clip at it.
// The old sample stays in the store, so undo (which restores the old
// sampleId) still resolves.
function replaceSample(
  app: DawApp,
  clip: Clip,
  label: string,
  nameSuffix: string,
  fn: (channels: Float32Array<ArrayBuffer>[], rate: number) => void,
): void {
  const region = clip.audio
  const buffer = region ? sampleStore.get(region.sampleId) : undefined
  if (!region || !buffer) return
  const channels: Float32Array<ArrayBuffer>[] = []
  for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i).slice())
  fn(channels, buffer.sampleRate)
  const out = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate: buffer.sampleRate })
  channels.forEach((ch, i) => out.copyToChannel(ch, i))
  app.checkpoint(label)
  const name = `${(sampleStore.name(region.sampleId) ?? 'audio').replace(/ \(.*\)$/, '')} (${nameSuffix})`
  const id = newId()
  sampleStore.put(id, name, out)
  app.project.samples[id] = { name, duration: out.duration }
  region.sampleId = id
  app.emit('clips')
}

export function buildAudioClipEditor(app: DawApp, _trackId: string, clip: Clip): HTMLElement {
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
  const procBtn = (text: string, title: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'seg-btn'
    b.textContent = text
    b.title = title
    b.addEventListener('click', fn)
    row.appendChild(b)
    return b
  }
  procBtn('Normalize', 'Raise the clip to full level', () =>
    replaceSample(app, clip, 'normalize', 'norm', chs => normalizeChannels(chs)))
  procBtn('Reverse', 'Flip the audio backwards', () =>
    replaceSample(app, clip, 'reverse', 'rev', chs => reverseChannels(chs)))
  root.appendChild(row)

  // ---------- autotune ----------

  const tune = document.createElement('div')
  tune.className = 'autotune'
  const tag = document.createElement('span')
  tag.className = 'mix-tag'
  tag.textContent = 'Autotune'
  tune.appendChild(tag)

  const keyNote = document.createElement('span')
  keyNote.className = 'audio-hint'
  const keyName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][app.project.key.root]
  keyNote.textContent = `Snaps to the song key (${keyName} ${app.project.key.scale}) — set it in the transport bar.`
  tune.appendChild(keyNote)

  const tuneRow = document.createElement('div')
  tuneRow.className = 'sampler-row'
  let retuneMs = 20
  let amount = 1
  tuneRow.appendChild(
    miniDial({
      label: 'Speed',
      get: () => retuneMs,
      set: v => {
        retuneMs = v
      },
      min: 5,
      max: 250,
      reset: 20,
      fmt: v => `${v.toFixed(0)}ms`,
    }),
  )
  tuneRow.appendChild(
    miniDial({
      label: 'Amount',
      get: () => amount,
      set: v => {
        amount = v
      },
      min: 0,
      max: 1,
      reset: 1,
      fmt: v => `${Math.round(v * 100)}%`,
    }),
  )
  const apply = document.createElement('button')
  apply.type = 'button'
  apply.className = 'seg-btn'
  apply.textContent = 'Apply Autotune'
  apply.title = 'Pitch-correct this clip to the song key (5ms speed = hard snap)'
  apply.addEventListener('click', () => {
    apply.disabled = true
    apply.textContent = 'Tuning...'
    setTimeout(() => {
      try {
        replaceSample(app, clip, 'autotune', 'tuned', (chs, rate) => {
          const opts = { root: app.project.key.root, scale: app.project.key.scale, retuneMs, amount }
          for (let i = 0; i < chs.length; i++) {
            chs[i].set(autotuneChannel(chs[i], rate, opts))
          }
        })
      } finally {
        apply.disabled = false
        apply.textContent = 'Apply Autotune'
      }
    }, 30)
  })
  tuneRow.appendChild(apply)
  tune.appendChild(tuneRow)
  root.appendChild(tune)
  return root
}
