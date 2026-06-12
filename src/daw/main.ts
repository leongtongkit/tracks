// Tracks DAW entry: arrangement view + transport + bottom editor panel.
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/ibm-plex-sans-condensed/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import { analyzeBuffer } from '../test/offline'
import { KeyboardInput } from '../input/keyboard'
import { buildInstrumentEditor } from '../ui/panels'
import { PresetBrowser } from '../ui/preset-browser'
import { DawApp } from './daw-app'
import { exportMidi } from './midi'
import { demoSong, downloadBlob, downloadProjectJson, importProjectJson, loadSession, saveSession } from './persist'
import { defaultProject, newId, newTrack } from './project'
import { sampleStore } from './samples'
import { buildAudioTrackEditor } from './ui/audio-editor'
import { buildDrumEditor } from './ui/drum-editor'
import { buildPadsEditor } from './ui/pads-editor'
import { buildSamplerEditor } from './ui/sampler-editor'
import { renderProjectToWav } from './render'
import { renderProject } from './render'
import { ArrangeView } from './ui/arrange'
import { BottomPanel } from './ui/bottom'

const app = new DawApp()
// recover persisted samples (recordings/imports) before anything plays
void sampleStore.loadAll()
// boot: last session if it exists, otherwise the demo song
app.project = loadSession() ?? demoSong()
app.armedTrackId = app.project.tracks[0]?.id ?? null
const root = document.getElementById('app')!
const daw = document.createElement('div')
daw.className = 'daw'

const arrange = new ArrangeView(app)
daw.appendChild(arrange.el)

const bottom = new BottomPanel(app)
daw.appendChild(bottom.el)

// synth editors are cached: knob subscriptions live on the track's store, so
// rebuilding each render would leak listeners. Drum/sampler editors hold no
// subscriptions and rebuild from live project data on every mount.
const instrumentCache = new Map<string, HTMLElement>()
bottom.setInstrumentMount((host, trackId) => {
  const track = app.track(trackId)
  if (!track) return
  app.ensureAudio()
  if (track.kind === 'drums') {
    host.appendChild(buildDrumEditor(app, trackId))
    return
  }
  if (track.kind === 'sampler') {
    host.appendChild(buildSamplerEditor(app, trackId))
    return
  }
  if (track.kind === 'pads') {
    host.appendChild(buildPadsEditor(app, trackId))
    return
  }
  if (track.kind === 'audio') {
    host.appendChild(buildAudioTrackEditor(app, trackId))
    return
  }
  const store = app.song?.store(trackId)
  if (!store) return
  let editor = instrumentCache.get(trackId)
  if (!editor) {
    editor = document.createElement('div')
    editor.className = 'instrument-host'
    const browser = new PresetBrowser(store)
    browser.el.classList.add('instrument-presets')
    editor.appendChild(browser.el)
    editor.appendChild(buildInstrumentEditor(store))
    instrumentCache.set(trackId, editor)
  }
  host.appendChild(editor)
})

root.appendChild(daw)

// musical keyboard (same two-manual layout as the synth) plays the armed track
new KeyboardInput({
  noteOn: n => app.liveNoteOn(n),
  noteOff: n => app.liveNoteOff(n),
  allNotesOff: () => app.song?.allNotesOff(),
  bend: s => app.liveBend(s),
})

export { bottom }

// autosave on every document change, debounced
let saveTimer: ReturnType<typeof setTimeout> | undefined
for (const ev of ['project', 'tracks', 'clips', 'mixer'] as const) {
  app.on(ev, () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveSession(app), 900)
  })
}
window.addEventListener('beforeunload', () => saveSession(app))

// file actions live on the transport bar's right side
const fileBar = document.querySelector('.bar-space')!
const wavBtn = document.createElement('button')
wavBtn.type = 'button'
wavBtn.className = 'seg-btn'
wavBtn.textContent = 'Export WAV'
wavBtn.title = 'Render the whole song to a WAV file'
wavBtn.addEventListener('click', () => {
  void (async () => {
    wavBtn.disabled = true
    wavBtn.textContent = 'Rendering...'
    try {
      app.song?.collectPatches(app.project)
      const blob = await renderProjectToWav(app.project)
      downloadBlob(blob, `${app.project.name.replaceAll(/\W+/g, '-') || 'tracks'}.wav`)
    } finally {
      wavBtn.disabled = false
      wavBtn.textContent = 'Export WAV'
    }
  })()
})
const midiBtn = document.createElement('button')
midiBtn.type = 'button'
midiBtn.className = 'seg-btn'
midiBtn.textContent = 'MIDI'
midiBtn.title = 'Export all note tracks as a standard MIDI file'
midiBtn.addEventListener('click', () => {
  const bytes = exportMidi(app.project)
  downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/midi' }), `${app.project.name.replaceAll(/\W+/g, '-') || 'tracks'}.mid`)
})
const stemsBtn = document.createElement('button')
stemsBtn.type = 'button'
stemsBtn.className = 'seg-btn'
stemsBtn.textContent = 'Stems'
stemsBtn.title = 'Render each track to its own WAV file'
stemsBtn.addEventListener('click', () => {
  void (async () => {
    stemsBtn.disabled = true
    try {
      app.song?.collectPatches(app.project)
      const base = app.project.name.replaceAll(/\W+/g, '-') || 'tracks'
      const tracks = app.project.tracks.filter(t => t.clips.length > 0)
      for (let i = 0; i < tracks.length; i++) {
        stemsBtn.textContent = `Stem ${i + 1}/${tracks.length}`
        const solo = structuredClone(app.project)
        for (const t of solo.tracks) {
          t.mixer.mute = t.id !== tracks[i].id
          t.mixer.solo = false
        }
        const blob = await renderProjectToWav(solo)
        downloadBlob(blob, `${base}-${tracks[i].name.replaceAll(/\W+/g, '-')}.wav`)
        await new Promise(r => setTimeout(r, 400)) // keep the browser's download UI happy
      }
    } finally {
      stemsBtn.disabled = false
      stemsBtn.textContent = 'Stems'
    }
  })()
})
const saveBtn = document.createElement('button')
saveBtn.type = 'button'
saveBtn.className = 'seg-btn'
saveBtn.textContent = 'Save'
saveBtn.title = 'Download the project as a file'
saveBtn.addEventListener('click', () => downloadProjectJson(app))
const openBtn = document.createElement('button')
openBtn.type = 'button'
openBtn.className = 'seg-btn'
openBtn.textContent = 'Open'
openBtn.title = 'Open a saved project file'
const fileInput = document.createElement('input')
fileInput.type = 'file'
fileInput.accept = '.json,application/json'
fileInput.style.display = 'none'
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  if (!f) return
  void importProjectJson(f)
    .then(project => {
      app.transport.stop()
      app.song?.allNotesOff()
      app.history.clear()
      app.project = project
      app.selectedClip = null
      app.armedTrackId = project.tracks[0]?.id ?? null
      void app.song?.syncTracks(project)
      app.emit('tracks', 'clips', 'project', 'selection')
    })
    .catch(() => alert('That file is not a Tracks project.'))
  fileInput.value = ''
})
openBtn.addEventListener('click', () => fileInput.click())
fileBar.appendChild(wavBtn)
fileBar.appendChild(stemsBtn)
fileBar.appendChild(midiBtn)
fileBar.appendChild(saveBtn)
fileBar.appendChild(openBtn)
fileBar.appendChild(fileInput)

// ---------- global keys ----------

window.addEventListener('keydown', e => {
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  const cmd = e.metaKey || e.ctrlKey
  if (cmd && e.code === 'KeyZ') {
    e.preventDefault()
    if (e.shiftKey) app.redo()
    else app.undo()
  } else if (cmd && e.code === 'KeyY') {
    e.preventDefault()
    app.redo()
  } else if (cmd && e.code === 'KeyC') {
    if (app.copyClip()) e.preventDefault()
  } else if (cmd && e.code === 'KeyV') {
    if (app.pasteClip()) e.preventDefault()
  } else if (cmd && e.code === 'KeyD') {
    if (app.selectedClip) {
      e.preventDefault()
      app.duplicateClip(app.selectedClip.trackId, app.selectedClip.clipId)
    }
  } else if (cmd && e.code === 'KeyE') {
    if (app.selectedClip) {
      e.preventDefault()
      app.splitClip(app.selectedClip.trackId, app.selectedClip.clipId, app.transport.positionBeat())
    }
  } else if (e.code === 'Space') {
    e.preventDefault()
    app.togglePlay()
  } else if (e.code === 'Enter') {
    app.rewind()
  } else if (e.code === 'Delete' || e.code === 'Backspace') {
    if (app.selectedClip) {
      e.preventDefault()
      app.deleteClip(app.selectedClip.trackId, app.selectedClip.clipId)
    }
  }
})

// ---------- unlock ----------

function unlock(): void {
  document.getElementById('scrim')?.classList.add('hidden')
  document.removeEventListener('pointerdown', unlock, true)
  document.removeEventListener('keydown', unlock, true)
  app.ensureAudio()
}
document.addEventListener('pointerdown', unlock, true)
document.addEventListener('keydown', unlock, true)

// ---------- verification harness ----------

declare global {
  interface Window {
    __tracksRenderTest: () => Promise<unknown>
    __tracksKitTest: () => Promise<unknown>
    __tracksMixTest: () => Promise<unknown>
    __tracksAudioTest: () => Promise<unknown>
    __tracksAutoTest: () => Promise<unknown>
    __tracksApp: DawApp
  }
}

// a volume automation ramp 1→0 must fade the rendered audio accordingly
window.__tracksAutoTest = async () => {
  const p = defaultProject()
  p.tracks = [p.tracks[3]] // pad: sustained chord exposes the fade
  p.tracks[0].clips = [{
    id: 'au1', start: 0, length: 8,
    notes: [60, 64, 67].map(pitch => ({ start: 0, dur: 8, pitch, vel: 0.9 })),
  }]
  p.tracks[0].auto.volume = [
    { beat: 1, value: 1 },
    { beat: 7, value: 0 },
  ]
  const out = await renderProject(p)
  const rms = (from: number, to: number): number => {
    const ch = out.getChannelData(0)
    let s = 0
    const i0 = Math.floor(from * out.sampleRate)
    const i1 = Math.floor(to * out.sampleRate)
    for (let i = i0; i < i1; i++) s += ch[i] * ch[i]
    return Math.sqrt(s / (i1 - i0))
  }
  const spb = 60 / 120
  const early = rms(1.2 * spb, 2.2 * spb)
  const late = rms(5.8 * spb, 6.8 * spb)
  return { early, late, fades: late < early * 0.45 }
}

// an audio clip placed at beat 2 renders at the right time in the bounce
window.__tracksAudioTest = async () => {
  const rate = 44100
  const buf = new AudioBuffer({ length: rate, numberOfChannels: 1, sampleRate: rate })
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.sin((i / rate) * 330 * 2 * Math.PI) * 0.8
  const sid = newId()
  sampleStore.put(sid, 'tone-1s', buf)
  const p = defaultProject()
  const t = newTrack('A', { kind: 'audio' })
  t.clips = [{ id: 'a1', start: 2, length: 2, notes: [], audio: { sampleId: sid, offsetSec: 0, gain: 1 } }]
  p.tracks = [t]
  const out = await renderProject(p) // 120 bpm → clip spans 1.0s..2.0s
  const rms = (from: number, to: number): number => {
    const ch = out.getChannelData(0)
    let s = 0
    const i0 = Math.floor(from * out.sampleRate)
    const i1 = Math.floor(to * out.sampleRate)
    for (let i = i0; i < i1; i++) s += ch[i] * ch[i]
    return Math.sqrt(s / (i1 - i0))
  }
  return {
    beforeClip: rms(0.2, 0.9),
    duringClip: rms(1.2, 1.9),
    afterClip: rms(2.3, 3),
    placedRight: rms(1.2, 1.9) > 0.1 && rms(0.2, 0.9) < 0.01 && rms(2.3, 3) < 0.01,
  }
}

// channel strip + sends shape the rendered audio (EQ boost raises RMS,
// reverb send lengthens the tail)
window.__tracksMixTest = async () => {
  const mk = (): ReturnType<typeof defaultProject> => {
    const p = defaultProject()
    p.tracks = [p.tracks[0]]
    p.tracks[0].clips = [{
      id: 'm1', start: 0, length: 4,
      notes: [0, 1, 2, 3].map(i => ({ start: i, dur: 0.5, pitch: 48, vel: 0.9 })),
    }]
    return p
  }
  const rms = (b: AudioBuffer, from = 0, to = b.duration): number => {
    const d = b.getChannelData(0)
    const i0 = Math.floor(from * b.sampleRate)
    const i1 = Math.min(d.length, Math.floor(to * b.sampleRate))
    let s = 0
    for (let i = i0; i < i1; i++) s += d[i] * d[i]
    return Math.sqrt(s / Math.max(1, i1 - i0))
  }
  const dry = await renderProject(mk())
  const eq = mk()
  eq.tracks[0].mixer.eq.low = 12
  const eqBuf = await renderProject(eq)
  const send = mk()
  send.tracks[0].mixer.sendA = 0.9
  const sendBuf = await renderProject(send)
  const comp = mk()
  comp.tracks[0].mixer.comp = { on: true, threshold: -40, ratio: 12, attack: 0.002, release: 0.15, makeup: 1 }
  const compBuf = await renderProject(comp)
  const spb = 60 / 120
  return {
    dryRms: rms(dry),
    eqRms: rms(eqBuf),
    eqBoosts: rms(eqBuf) > rms(dry) * 1.05,
    tailDry: rms(dry, 4 * spb + 0.8),
    tailSend: rms(sendBuf, 4 * spb + 0.8),
    sendAddsTail: rms(sendBuf, 4 * spb + 0.8) > rms(dry, 4 * spb + 0.8) * 1.5,
    compRms: rms(compBuf),
    compChanges: Math.abs(rms(compBuf) - rms(dry)) / rms(dry) > 0.03,
  }
}

// drums + sampler render end-to-end in an offline context
window.__tracksKitTest = async () => {
  const p = defaultProject()
  const drums = newTrack('D', { kind: 'drums' })
  drums.clips = [{
    id: 'kd', start: 0, length: 4,
    notes: [36, 38, 42, 46, 41, 49, 39, 56].map((pitch, i) => ({ start: i * 0.5, dur: 0.25, pitch, vel: 0.9 })),
  }]
  const smp = newTrack('S', { kind: 'sampler' })
  // synthesize a one-shot so the sampler has something to play
  const rate = 44100
  const buf = new AudioBuffer({ length: rate / 2, numberOfChannels: 1, sampleRate: rate })
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.sin((i / rate) * 440 * 2 * Math.PI) * Math.exp(-i / (rate * 0.2))
  const sid = newId()
  sampleStore.put(sid, 'test-tone', buf)
  smp.sampler.sampleId = sid
  smp.clips = [{
    id: 'ks', start: 0, length: 4,
    notes: [60, 64, 67, 72].map((pitch, i) => ({ start: i, dur: 0.5, pitch, vel: 0.9 })),
  }]
  p.tracks = [drums, smp]
  const t0 = performance.now()
  const out = await renderProject(p)
  return { ...analyzeBuffer(out), renderMs: Math.round(performance.now() - t0) }
}

window.__tracksApp = app
window.__tracksRenderTest = async () => {
  const p = defaultProject()
  p.tracks[0].clips = [{
    id: 'c1', start: 0, length: 4,
    notes: [0, 1, 2, 3].map(i => ({ start: i, dur: 0.5, pitch: 36 + (i % 2) * 12, vel: 0.9 })),
  }]
  p.tracks[3].clips = [{
    id: 'c2', start: 0, length: 4,
    notes: [60, 64, 67].map(pitch => ({ start: 0, dur: 4, pitch, vel: 0.7 })),
  }]
  const t0 = performance.now()
  const buf = await renderProject(p)
  return { ...analyzeBuffer(buf), renderMs: Math.round(performance.now() - t0) }
}
