// Audio track + audio clip editors. The track editor (Instrument tab) covers
// importing and how to record; the clip editor (Clip tab) covers per-clip
// gain and processing. Autotune mounts into the clip editor.

import type { DawApp } from '../daw-app'
import { autotuneChannel, normalizeChannels, reverseChannels } from '../dsp/autotune'
import { extractStems } from '../dsp/stems'
import { newId, newTrack, type Clip } from '../project'
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

  // tempo warp: follow the song BPM by repitching
  const warpBtn = document.createElement('button')
  warpBtn.type = 'button'
  warpBtn.className = 'seg-btn'
  warpBtn.textContent = 'Warp'
  warpBtn.title = 'Follow the song tempo: playback speeds up/slows down with BPM (repitch)'
  warpBtn.classList.toggle('seg-on', region.warp)
  warpBtn.addEventListener('click', () => {
    app.checkpoint('warp')
    region.warp = !region.warp
    warpBtn.classList.toggle('seg-on', region.warp)
    app.emit('clips')
  })
  row.appendChild(warpBtn)
  row.appendChild(
    miniDial({
      label: 'Orig BPM',
      get: () => region.origBpm,
      set: v => {
        app.checkpoint('warp bpm')
        region.origBpm = Math.round(v)
      },
      min: 40,
      max: 240,
      reset: app.project.bpm,
      fmt: v => String(Math.round(v)),
    }),
  )
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

  // ---------- stem extraction ----------

  const ext = document.createElement('div')
  ext.className = 'autotune'
  const extTag = document.createElement('span')
  extTag.className = 'mix-tag'
  extTag.textContent = 'Extract'
  ext.appendChild(extTag)
  const extNote = document.createElement('span')
  extNote.className = 'audio-hint'
  extNote.textContent = 'Split this clip into vocals / drums / bass / other — each lands on its own new track.'
  ext.appendChild(extNote)
  const extRow = document.createElement('div')
  extRow.className = 'sampler-row'
  const extBtn = document.createElement('button')
  extBtn.type = 'button'
  extBtn.className = 'seg-btn'
  extBtn.textContent = 'Extract stems'
  extBtn.title = 'Separate vocal, drum, bass, and remaining components of this clip'
  extBtn.addEventListener('click', () => {
    void (async () => {
      const buffer = sampleStore.get(region.sampleId)
      if (!buffer) return
      extBtn.disabled = true
      try {
        const spb = 60 / app.project.bpm
        const i0 = Math.floor(region.offsetSec * buffer.sampleRate)
        const i1 = Math.min(buffer.length, i0 + Math.ceil(clip.length * spb * buffer.sampleRate))
        const channels: Float32Array<ArrayBuffer>[] = []
        for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
          channels.push(buffer.getChannelData(c).slice(i0, i1))
        }
        const stems = await extractStems(channels, buffer.sampleRate, frac => {
          extBtn.textContent = `Extracting ${Math.round(frac * 100)}%`
        })
        app.checkpoint('extract stems')
        const base = (sampleStore.name(region.sampleId) ?? 'audio').replace(/ \(.*\)$/, '')
        let made = 0
        for (const stem of stems) {
          if (stem.rms < 2e-4) continue // skip stems the source doesn't contain
          const out = new AudioBuffer({ length: stem.channels[0].length, numberOfChannels: 2, sampleRate: buffer.sampleRate })
          out.copyToChannel(stem.channels[0], 0)
          out.copyToChannel(stem.channels[1], 1)
          const id = newId()
          const name = `${base} (${stem.name})`
          sampleStore.put(id, name, out)
          app.project.samples[id] = { name, duration: out.duration }
          const trackName = stem.name[0].toUpperCase() + stem.name.slice(1)
          const t = newTrack(trackName, { kind: 'audio' })
          t.clips = [{ id: newId(), start: clip.start, length: clip.length, notes: [], audio: { sampleId: id, offsetSec: 0, gain: 1, warp: region.warp, origBpm: region.origBpm } }]
          app.project.tracks.push(t)
          made++
        }
        void app.song?.syncTracks(app.project)
        app.emit('tracks', 'clips')
        extBtn.textContent = made > 0 ? `Done — ${made} tracks added` : 'Nothing to extract'
        setTimeout(() => {
          extBtn.textContent = 'Extract stems'
          extBtn.disabled = false
        }, 1800)
      } catch {
        extBtn.textContent = 'Extract stems'
        extBtn.disabled = false
      }
    })()
  })
  extRow.appendChild(extBtn)
  ext.appendChild(extRow)
  root.appendChild(ext)
  return root
}
