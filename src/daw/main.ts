// Tracks DAW entry: arrangement view + transport + bottom editor panel.
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/ibm-plex-sans-condensed/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import { analyzeBuffer } from '../test/offline'
import { KeyboardInput } from '../input/keyboard'
import { initMidi, type MidiSession } from '../input/midi'
import { registerMidiControl } from './midi-control'
import { buildInstrumentEditor, fxRack } from '../ui/panels'
import { PresetBrowser } from '../ui/preset-browser'
import { DawApp } from './daw-app'
import { exportMidi, importMidi } from './midi'
import { encodeMp3 } from './mp3'
import {
  demoSong,
  downloadBlob,
  downloadProjectJson,
  importProjectJson,
  loadSession,
  saveSession,
} from './persist'
import { defaultEqBands, defaultMixer, defaultProject, newId, newTrack, projectEndBeat } from './project'
import { collectEvents } from './transport'
import { settings } from './settings'
import { sampleStore } from './samples'
import { buildAudioTrackEditor } from './ui/audio-editor'
import { buildDrumEditor } from './ui/drum-editor'
import { buildPadsEditor } from './ui/pads-editor'
import { buildSamplerEditor } from './ui/sampler-editor'
import { buildSoundFontEditor } from './ui/soundfont-editor'
import { soundFontStore } from './soundfont-store'
import { renderProjectToWav } from './render'
import { renderProject } from './render'
import { detectPitch } from './dsp/autotune'
import { ArrangeView } from './ui/arrange'
import { BottomPanel } from './ui/bottom'
import { buildHelpOverlay } from './ui/help'
import { buildSettingsPanel } from './ui/settings-panel'

const app = new DawApp()
// recover persisted samples (recordings/imports) before anything plays
void sampleStore.loadAll()
// recover persisted SoundFonts so loaded instruments survive a reload
void soundFontStore.loadAll()
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

const help = buildHelpOverlay()
const settingsPanel = buildSettingsPanel(app)

// synth editors are cached: knob subscriptions live on the track's store, so
// rebuilding each render would leak listeners. Drum/sampler editors hold no
// subscriptions and rebuild from live project data on every mount.
const instrumentCache = new Map<string, HTMLElement>()
// FX racks hold knob subscriptions on the track store → cache them too
const fxCache = new Map<string, HTMLElement>()
// evict editors for deleted tracks so their stores (and knob subscriptions) die
app.on('tracks', () => {
  for (const cache of [instrumentCache, fxCache]) {
    for (const id of cache.keys()) {
      if (!app.track(id)) cache.delete(id)
    }
  }
})
const trackFxRack = (trackId: string): HTMLElement | null => {
  const store = app.song?.store(trackId)
  if (!store) return null
  let rack = fxCache.get(trackId)
  if (!rack) {
    rack = document.createElement('div')
    rack.className = 'track-fx'
    const tag = document.createElement('span')
    tag.className = 'mix-tag'
    tag.textContent = 'Insert FX'
    rack.appendChild(tag)
    rack.appendChild(fxRack(store))
    fxCache.set(trackId, rack)
  }
  return rack
}
bottom.setInstrumentMount((host, trackId) => {
  const track = app.track(trackId)
  if (!track) return
  app.ensureAudio()
  if (track.kind === 'bus') {
    const note = document.createElement('p')
    note.className = 'bottom-hint'
    note.textContent = 'Group bus — route other tracks into it (their mixer “Out” menu). Shape the whole group with this strip’s EQ, dynamics, and insert FX, then ride one fader.'
    host.appendChild(note)
    const rack = trackFxRack(trackId)
    if (rack) host.appendChild(rack)
    return
  }
  if (track.kind !== 'synth') {
    const editor =
      track.kind === 'drums'
        ? buildDrumEditor(app, trackId)
        : track.kind === 'sampler'
          ? buildSamplerEditor(app, trackId)
          : track.kind === 'pads'
            ? buildPadsEditor(app, trackId)
            : track.kind === 'soundfont'
              ? buildSoundFontEditor(app, trackId)
              : buildAudioTrackEditor(app, trackId)
    host.appendChild(editor)
    const rack = trackFxRack(trackId)
    if (rack) editor.appendChild(rack)
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

// hardware MIDI keyboard plays + records into the armed track (velocity +
// pitch-bend + sustain pedal). Requested once, on the first user gesture.
let midiSession: MidiSession | null = null
let midiInitStarted = false
registerMidiControl(
  () => midiSession?.inputs ?? [],
  name => midiSession?.setActiveInput(name),
)
async function initDawMidi(): Promise<void> {
  if (midiInitStarted) return
  midiInitStarted = true
  midiSession = await initMidi({
    noteOn: (n, v) => app.liveNoteOn(n, v),
    noteOff: n => app.liveNoteOff(n),
    bend: s => app.liveBend(s),
  })
  midiSession.setActiveInput(settings.midiInput)
}

export { bottom }

// autosave on every document change, debounced
let saveTimer: ReturnType<typeof setTimeout> | undefined
for (const ev of ['project', 'tracks', 'clips', 'mixer'] as const) {
  app.on(ev, () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (settings.autosave) saveSession(app)
    }, 900)
  })
}
window.addEventListener('beforeunload', () => {
  if (settings.autosave) saveSession(app)
})

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
      const blob = await renderProjectToWav(app.project, settings.exportRate)
      downloadBlob(blob, `${app.project.name.replaceAll(/\W+/g, '-') || 'tracks'}.wav`)
    } finally {
      wavBtn.disabled = false
      wavBtn.textContent = 'Export WAV'
    }
  })()
})
const mp3Btn = document.createElement('button')
mp3Btn.type = 'button'
mp3Btn.className = 'seg-btn'
mp3Btn.textContent = 'MP3'
mp3Btn.title = 'Render the song to a small MP3 (bitrate in Settings)'
mp3Btn.addEventListener('click', () => {
  void (async () => {
    mp3Btn.disabled = true
    mp3Btn.textContent = 'Rendering...'
    try {
      app.song?.collectPatches(app.project)
      const buf = await renderProject(app.project, settings.exportRate)
      mp3Btn.textContent = 'Encoding...'
      await new Promise(r => setTimeout(r, 30)) // let the label paint
      const blob = encodeMp3(buf, settings.mp3Kbps)
      downloadBlob(blob, `${app.project.name.replaceAll(/\W+/g, '-') || 'tracks'}.mp3`)
    } finally {
      mp3Btn.disabled = false
      mp3Btn.textContent = 'MP3'
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
        const blob = await renderProjectToWav(solo, settings.exportRate)
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
openBtn.title = 'Open a saved project (.tracks.json) or a MIDI file (.mid)'
const fileInput = document.createElement('input')
fileInput.type = 'file'
fileInput.accept = '.json,application/json,.mid,.midi,audio/midi'
fileInput.style.display = 'none'
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  if (!f) return
  const loader = /\.midi?$/i.test(f.name)
    ? f.arrayBuffer().then(buf => importMidi(new Uint8Array(buf)))
    : importProjectJson(f)
  void loader
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
    .catch(() => alert('That file is not a Tracks project or readable MIDI file.'))
  fileInput.value = ''
})
openBtn.addEventListener('click', () => fileInput.click())
const helpBtn = document.createElement('button')
helpBtn.type = 'button'
helpBtn.className = 'seg-btn'
helpBtn.textContent = '?'
helpBtn.title = 'Keyboard shortcuts'
helpBtn.addEventListener('click', () => help.toggle())
fileBar.appendChild(helpBtn)
const settingsBtn = document.createElement('button')
settingsBtn.type = 'button'
settingsBtn.className = 'seg-btn'
settingsBtn.textContent = 'Settings'
settingsBtn.title = 'App settings (sound, recording, editing, export)'
settingsBtn.addEventListener('click', () => settingsPanel.toggle())
fileBar.appendChild(settingsBtn)
fileBar.appendChild(wavBtn)
fileBar.appendChild(mp3Btn)
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
  if (e.key === '?') {
    e.preventDefault()
    help.toggle()
  } else if (cmd && e.code === 'KeyZ') {
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
    if (target?.closest('.proll')) return // the roll handles note deletion itself
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
  void initDawMidi()
}
document.addEventListener('pointerdown', unlock, true)
document.addEventListener('keydown', unlock, true)

// ---------- verification harness ----------

declare global {
  interface Window {
    __tracksRenderTest: () => Promise<unknown>
    __tracksKitTest: () => Promise<unknown>
    __tracksMixTest: () => Promise<unknown>
    __tracksEqTest: () => Promise<unknown>
    __tracksRoutingTest: () => Promise<unknown>
    __tracksFreezeTest: () => Promise<unknown>
    __tracksSf2Test: () => Promise<unknown>
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
  t.clips = [{ id: 'a1', start: 2, length: 2, notes: [], audio: { sampleId: sid, offsetSec: 0, gain: 1, warp: 'off', origBpm: 120, fadeIn: 0, fadeOut: 0 } }]
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
  eq.tracks[0].mixer.eq[0].gain = 12
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

// parametric EQ: a lowpass band must cut high-frequency energy, a band beyond
// the default three must still process, and an all-flat stack must be ~transparent.
window.__tracksEqTest = async () => {
  const mk = (): ReturnType<typeof defaultProject> => {
    const p = defaultProject()
    p.tracks = [newTrack('Saw', { preset: 'Fat Saw', kind: 'synth' })] // bright, harmonic-rich
    p.tracks[0].clips = [{
      id: 'e1', start: 0, length: 4,
      notes: [0, 1, 2, 3].map(i => ({ start: i, dur: 0.6, pitch: 50, vel: 0.95 })),
    }]
    return p
  }
  // high-frequency energy proxy: mean squared first-difference of the signal
  const hf = (b: AudioBuffer): number => {
    const d = b.getChannelData(0)
    let s = 0
    for (let i = 1; i < d.length; i++) {
      const diff = d[i] - d[i - 1]
      s += diff * diff
    }
    return s / d.length
  }
  const rms = (b: AudioBuffer): number => {
    const d = b.getChannelData(0)
    let s = 0
    for (let i = 0; i < d.length; i++) s += d[i] * d[i]
    return Math.sqrt(s / d.length)
  }
  const dry = await renderProject(mk())

  const lp = mk()
  lp.tracks[0].mixer.eq = [{ type: 'lowpass', freq: 350, gain: 0, q: 0.7, on: true }]
  const lpBuf = await renderProject(lp)

  // a high-shelf in slot 5 (beyond the default three) must still process
  const hi = mk()
  hi.tracks[0].mixer.eq = [
    ...defaultEqBands(),
    { type: 'peaking', freq: 2000, gain: 0, q: 1, on: true },
    { type: 'highshelf', freq: 3500, gain: 15, q: 0.7, on: true },
  ]
  const hiBuf = await renderProject(hi)

  const flat = mk()
  flat.tracks[0].mixer.eq = defaultEqBands() // all 0 dB → transparent
  const flatBuf = await renderProject(flat)

  // gate fully closed (threshold above any envelope) → near silence;
  // gate wide open (threshold below the envelope) → ~unchanged
  const gateClosed = mk()
  gateClosed.tracks[0].mixer.gate = { on: true, threshold: 0.5, floor: 0 }
  const gateClosedBuf = await renderProject(gateClosed)
  const gateOpen = mk()
  gateOpen.tracks[0].mixer.gate = { on: true, threshold: 0.001, floor: 0 }
  const gateOpenBuf = await renderProject(gateOpen)

  // de-esser tames sibilance: on a noise-rich (sibilant) source, engaging it
  // should pull high-frequency energy down versus de-ess off. Audio clip of
  // white noise = a faithful stand-in for harsh "sss" content.
  const noiseProject = (deEssOn: boolean): ReturnType<typeof defaultProject> => {
    const p = defaultProject()
    const fs = 44100
    const nb = new AudioBuffer({ length: fs * 2, numberOfChannels: 1, sampleRate: fs })
    const nd = nb.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.4
    const nid = newId()
    sampleStore.put(nid, 'sibilance', nb)
    const at = newTrack('Noise', { kind: 'audio' })
    at.clips = [{ id: 'nz', start: 0, length: 4, notes: [], audio: { sampleId: nid, offsetSec: 0, gain: 1, warp: 'off', origBpm: 120, fadeIn: 0, fadeOut: 0 } }]
    if (deEssOn) at.mixer.deEss = { on: true, amount: 1, freq: 6000 }
    p.tracks = [at]
    return p
  }
  const deEssOffBuf = await renderProject(noiseProject(false))
  const deEssBuf = await renderProject(noiseProject(true))

  return {
    dryHf: hf(dry),
    lpHf: hf(lpBuf),
    lowpassCutsHighs: hf(lpBuf) < hf(dry) * 0.5,
    hiHf: hf(hiBuf),
    band6BoostsHighs: hf(hiBuf) > hf(dry) * 1.15,
    flatTransparent: Math.abs(rms(flatBuf) - rms(dry)) / rms(dry) < 0.02,
    gateClosedRms: rms(gateClosedBuf),
    gateClosesWhenBelowThreshold: rms(gateClosedBuf) < rms(dry) * 0.2,
    gateOpenPasses: rms(gateOpenBuf) > rms(dry) * 0.8,
    deEssOffHf: hf(deEssOffBuf),
    deEssOnHf: hf(deEssBuf),
    deEssTamesHarshHighs: hf(deEssBuf) < hf(deEssOffBuf) * 0.9,
  }
}

// group/bus routing: a track routed into a bus is processed by that bus's strip;
// a routing cycle must fall back to master (no feedback loop, finite output).
window.__tracksRoutingTest = async () => {
  const mk = (configure: (a: ReturnType<typeof newTrack>, bus: ReturnType<typeof newTrack>) => void): ReturnType<typeof defaultProject> => {
    const p = defaultProject()
    const a = newTrack('Saw', { preset: 'Fat Saw', kind: 'synth' })
    a.clips = [{ id: 'r1', start: 0, length: 4, notes: [0, 1, 2, 3].map(i => ({ start: i, dur: 0.6, pitch: 50, vel: 0.95 })) }]
    const bus = newTrack('Group', { kind: 'bus' })
    configure(a, bus)
    p.tracks = [a, bus]
    return p
  }
  const rms = (b: AudioBuffer): number => {
    const d = b.getChannelData(0)
    let s = 0
    for (let i = 0; i < d.length; i++) s += d[i] * d[i]
    return Math.sqrt(s / d.length)
  }
  const hf = (b: AudioBuffer): number => {
    const d = b.getChannelData(0)
    let s = 0
    for (let i = 1; i < d.length; i++) s += (d[i] - d[i - 1]) * (d[i] - d[i - 1])
    return s / d.length
  }
  const finite = (b: AudioBuffer): boolean => {
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) return false
    return true
  }

  const toMaster = await renderProject(mk(a => { a.mixer.output = 'master' }))
  const busSilent = await renderProject(mk((a, bus) => { a.mixer.output = bus.id; bus.mixer.volume = 0 }))
  const busLp = await renderProject(mk((a, bus) => { a.mixer.output = bus.id; bus.mixer.eq = [{ type: 'lowpass', freq: 350, gain: 0, q: 0.7, on: true }] }))
  const cycle = await renderProject(mk((a, bus) => { a.mixer.output = bus.id; bus.mixer.output = a.id }))

  return {
    masterRms: rms(toMaster),
    busSilentRms: rms(busSilent),
    busFaderControlsRoutedTrack: rms(busSilent) < rms(toMaster) * 0.05,
    busLpCutsHighs: hf(busLp) < hf(toMaster) * 0.6,
    cycleRms: rms(cycle),
    cycleStaysFiniteAndAudible: finite(cycle) && rms(cycle) > rms(toMaster) * 0.5,
  }
}

// track freeze: bouncing a track (neutral strip) then playing it back frozen
// must reproduce the live-synthesised sound, and frozen tracks must skip notes.
window.__tracksFreezeTest = async () => {
  const mk = (): ReturnType<typeof defaultProject> => {
    const p = defaultProject()
    const t = newTrack('Saw', { preset: 'Fat Saw', kind: 'synth' })
    t.clips = [{ id: 'f1', start: 0, length: 4, notes: [0, 1, 2, 3].map(i => ({ start: i, dur: 0.6, pitch: 50, vel: 0.9 })) }]
    p.tracks = [t]
    return p
  }
  const rms = (b: AudioBuffer, from: number, to: number): number => {
    const d = b.getChannelData(0)
    const i0 = Math.floor(from * b.sampleRate)
    const i1 = Math.min(d.length, Math.floor(to * b.sampleRate))
    let s = 0
    for (let i = i0; i < i1; i++) s += d[i] * d[i]
    return Math.sqrt(s / Math.max(1, i1 - i0))
  }
  const spb = 60 / 120
  const live = await renderProject(mk())

  // freeze: bounce with a neutral strip, then mark the track frozen
  const p2 = mk()
  const endBeat = projectEndBeat(p2)
  const clone = structuredClone(p2.tracks[0])
  clone.mixer = { ...defaultMixer(), volume: 1, output: 'master' }
  const bounce = await renderProject({ ...p2, tracks: [clone], loop: { on: false, start: 0, end: endBeat } }, 44100, { neutralMaster: true })
  const sid = newId()
  sampleStore.put(sid, 'frozen', bounce)
  p2.samples[sid] = { name: 'frozen', duration: bounce.duration }
  p2.tracks[0].frozen = { sampleId: sid, lengthBeats: endBeat }
  const frozen = await renderProject(p2)

  const liveRms = rms(live, 0, endBeat * spb)
  const frozenRms = rms(frozen, 0, endBeat * spb)
  return {
    liveRms,
    frozenRms,
    frozenMatchesLive: Math.abs(liveRms - frozenRms) / liveRms < 0.15,
    frozenIsAudible: frozenRms > 0.005,
    notesSkippedWhenFrozen: collectEvents(p2.tracks, 0, endBeat).length === 0,
  }
}

// SoundFont end-to-end: build a minimal .sf2 (one looped 220.5 Hz sine at root
// key 57), load it via the store, play notes on a soundfont track, and confirm
// the rendered pitch tracks the key (root → 220 Hz, +12 → 440 Hz).
window.__tracksSf2Test = async () => {
  // --- compact .sf2 builder ---
  const enc = (s: string, n: number): Uint8Array => { const o = new Uint8Array(n); for (let i = 0; i < Math.min(s.length, n); i++) o[i] = s.charCodeAt(i); return o }
  const cat = (...ps: Uint8Array[]): Uint8Array => { const out = new Uint8Array(ps.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of ps) { out.set(p, o); o += p.length } return out }
  const u16 = (v: number): Uint8Array => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b }
  const u32 = (v: number): Uint8Array => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b }
  const s16 = (v: number): Uint8Array => { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v, true); return b }
  const ck = (id: string, body: Uint8Array): Uint8Array => { const h = cat(enc(id, 4), u32(body.length)); return body.length & 1 ? cat(h, body, new Uint8Array(1)) : cat(h, body) }
  const lst = (t: string, ...s: Uint8Array[]): Uint8Array => ck('LIST', cat(enc(t, 4), ...s))
  const gen = (op: number, amt: number): Uint8Array => cat(u16(op), s16(amt))
  const Np = 200 // one period → 220.5 Hz at 44100
  const smplBody = new Uint8Array(Np * 2)
  const dv = new DataView(smplBody.buffer)
  for (let i = 0; i < Np; i++) dv.setInt16(i * 2, Math.round(Math.sin((i / Np) * Math.PI * 2) * 22000), true)
  const sdta = lst('sdta', ck('smpl', smplBody))
  const shdrRec = (name: string, st: number, en: number, ls: number, le: number, sr: number, root: number, type: number): Uint8Array =>
    cat(enc(name, 20), u32(st), u32(en), u32(ls), u32(le), u32(sr), new Uint8Array([root, 0]), u16(0), u16(type))
  const shdr = ck('shdr', cat(shdrRec('sine', 0, Np, 0, Np, 44100, 57, 1), shdrRec('EOS', 0, 0, 0, 0, 0, 0, 0)))
  const igen = ck('igen', cat(gen(43, 0 | (127 << 8)), gen(54, 1), gen(53, 0), gen(0, 0)))
  const ibag = ck('ibag', cat(u16(0), u16(0), u16(3), u16(0)))
  const imod = ck('imod', new Uint8Array(10))
  const inst = ck('inst', cat(cat(enc('inst0', 20), u16(0)), cat(enc('EOI', 20), u16(1))))
  const pgen = ck('pgen', cat(gen(41, 0), gen(0, 0)))
  const pbag = ck('pbag', cat(u16(0), u16(0), u16(1), u16(0)))
  const pmod = ck('pmod', new Uint8Array(10))
  const phdr = ck('phdr', cat(
    cat(enc('Sine', 20), u16(0), u16(0), u16(0), u32(0), u32(0), u32(0)),
    cat(enc('EOP', 20), u16(0), u16(0), u16(1), u32(0), u32(0), u32(0)),
  ))
  const pdta = lst('pdta', phdr, pbag, pmod, pgen, inst, ibag, imod, igen, shdr)
  const info = lst('INFO', ck('ifil', cat(u16(2), u16(1))))
  const sf2 = ck('RIFF', cat(enc('sfbk', 4), info, sdta, pdta)).buffer as ArrayBuffer

  const sfId = newId()
  soundFontStore.put(sfId, 'sine.sf2', sf2)

  const mk = (pitch: number): ReturnType<typeof defaultProject> => {
    const p = defaultProject()
    const t = newTrack('SF', { kind: 'soundfont' })
    t.soundfont = { id: sfId, name: 'sine.sf2', presetIndex: 0 }
    t.clips = [{ id: 's1', start: 0, length: 4, notes: [{ start: 0, dur: 3.5, pitch, vel: 0.9 }] }]
    p.tracks = [t]
    return p
  }
  const rms = (b: AudioBuffer): number => { const d = b.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length) }

  const root = await renderProject(mk(57)) // → ~220 Hz
  const oct = await renderProject(mk(69)) // +12 → ~440 Hz
  const mid = Math.floor(root.length * 0.4)
  const pitchRoot = detectPitch(root.getChannelData(0), mid, 4096, root.sampleRate)
  const pitchOct = detectPitch(oct.getChannelData(0), mid, 4096, oct.sampleRate)
  return {
    presetsParsed: soundFontStore.get(sfId)?.presets.length ?? 0,
    samplesParsed: soundFontStore.get(sfId)?.samples.length ?? 0,
    rootRms: rms(root),
    rootIsAudible: rms(root) > 0.01,
    pitchRoot,
    pitchOct,
    rootPitchOk: Math.abs(pitchRoot - 220.5) < 12,
    octavePitchOk: Math.abs(pitchOct - 441) < 24,
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
