import { Engine } from './engine/engine'
import { KeyboardInput } from './input/keyboard'
import { hashToPatch } from './patch/serialize'
import { loadSession, saveSession } from './patch/storage'
import { Store } from './state/store'
import { buildApp } from './ui/panels'
import { Piano } from './ui/piano'
import { PresetBrowser } from './ui/preset-browser'
import { buildSaveShare } from './ui/save-share'
import { buildRecordMidi } from './ui/record-midi'
import { buildSequencer } from './ui/sequencer-grid'
import { Sequencer } from './sequencer/sequencer'
import { toast } from './ui/toast'
import { installRenderTest } from './test/offline'

const store = new Store()
let engine: Engine | null = null

function ensureEngine(): Engine {
  if (!engine) {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    engine = new Engine(ctx, store)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && ctx.state !== 'running') {
        ctx.resume().catch(() => {})
      }
    })
  }
  const ctx = engine.ctx as AudioContext
  if (ctx.state !== 'running') ctx.resume().catch(() => {})
  return engine
}

const piano = new Piano({
  noteOn: n => ensureEngine().noteOn(n),
  noteOff: n => engine?.noteOff(n),
})

const keyboard = new KeyboardInput({
  noteOn: n => {
    ensureEngine().noteOn(n)
    piano.highlight(n, true)
  },
  noteOff: n => {
    engine?.noteOff(n)
    piano.highlight(n, false)
  },
  allNotesOff: () => {
    engine?.allNotesOff()
    piano.clearHighlights()
  },
  bend: semis => engine?.setBend(semis),
  octaveChanged: o => {
    piano.setOctave(o)
    refs.octaveReadout.textContent = `C${o}`
  },
})

const refs = buildApp(document.getElementById('app')!, store, {
  octaveDown: () => keyboard.setOctave(keyboard.octave - 1),
  octaveUp: () => keyboard.setOctave(keyboard.octave + 1),
})
refs.pianoSlot.appendChild(piano.el)

const presets = new PresetBrowser(store)
refs.presetSlot.appendChild(presets.el)
refs.presetSlot.appendChild(buildSaveShare(store, presets))

const sequencer = new Sequencer({
  events: {
    noteOn: (n, t) => ensureEngine().noteOn(n, t),
    noteOff: (n, t) => engine?.noteOff(n, t),
  },
  getNow: () => (engine ? engine.ctx.currentTime : 0),
  getBpm: () => store.getPatch().master.bpm,
  getBaseNote: () => (keyboard.octave + 1) * 12,
})
refs.seqSlot.appendChild(buildSequencer(store, sequencer))

refs.presetSlot.appendChild(
  buildRecordMidi({
    getAudio: () => {
      const e = ensureEngine()
      return { ctx: e.ctx as AudioContext, tap: e.masterGain }
    },
    midi: {
      noteOn: (n, vel) => {
        ensureEngine().noteOn(n, undefined, vel)
        piano.highlight(n, true)
      },
      noteOff: n => {
        engine?.noteOff(n)
        piano.highlight(n, false)
      },
      bend: semis => engine?.setBend(semis),
    },
  }),
)

// Boot priority: shared link in the URL → autosaved session → first preset.
async function loadInitialPatch(): Promise<void> {
  try {
    const fromHash = await hashToPatch(location.hash)
    if (fromHash) {
      store.loadPatch(fromHash)
      presets.showLoaded(fromHash)
      toast(`Loaded shared sound "${fromHash.name}"`)
      return
    }
  } catch {
    toast('That share link is damaged. Starting fresh.')
  }
  const session = loadSession()
  if (session) {
    store.loadPatch(session)
    presets.showLoaded(session)
    return
  }
  presets.load(0)
}
void loadInitialPatch()

window.addEventListener('hashchange', () => {
  void hashToPatch(location.hash)
    .then(patch => {
      if (patch) {
        store.loadPatch(patch)
        presets.showLoaded(patch)
        toast(`Loaded shared sound "${patch.name}"`)
      }
    })
    .catch(() => toast('That share link is damaged.'))
})

// Autosave the working patch so a reload comes back where you left off.
let autosaveTimer: ReturnType<typeof setTimeout> | undefined
store.subscribeAll(() => {
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => saveSession(store.getPatch()), 800)
})

function unlock(): void {
  document.getElementById('scrim')?.classList.add('hidden')
  document.removeEventListener('pointerdown', unlock, true)
  document.removeEventListener('keydown', unlock, true)
  ensureEngine()
}

document.addEventListener('pointerdown', unlock, true)
document.addEventListener('keydown', unlock, true)

installRenderTest()

export { store, keyboard }
