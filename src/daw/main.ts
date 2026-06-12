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
import { demoSong, downloadBlob, downloadProjectJson, importProjectJson, loadSession, saveSession } from './persist'
import { defaultProject } from './project'
import { renderProjectToWav } from './render'
import { renderProject } from './render'
import { ArrangeView } from './ui/arrange'
import { BottomPanel } from './ui/bottom'

const app = new DawApp()
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

// per-track instrument editors are cached: knob subscriptions live on the
// track's store, so rebuilding each render would leak listeners
const instrumentCache = new Map<string, HTMLElement>()
bottom.setInstrumentMount((host, trackId) => {
  app.ensureAudio()
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
    __tracksApp: DawApp
  }
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
