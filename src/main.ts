// self-hosted fonts: Google Fonts is unreliable for visitors in China
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/ibm-plex-sans-condensed/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
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

// Auto-fit on every resolution and orientation: first pick a layout mode that
// matches the viewport's shape (wide / square / tall — CSS rearranges the
// panel grid, FX rack, sequencer, and keyboard per mode), then iterate the
// device width until its aspect ratio is close to the viewport's, and finally
// transform-scale it to fill the screen with no scrolling.
const deviceEl = document.querySelector<HTMLElement>('.device')!
const LAYOUT_BOUNDS: Record<string, [number, number]> = {
  l: [1280, 2400],
  m: [860, 1500],
  p: [600, 950],
}
let fitting = false

function fitDevice(): void {
  if (fitting) return
  fitting = true
  try {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const va = vw / vh
    const mode = va >= 1.25 ? 'l' : va >= 0.62 ? 'm' : 'p'
    if (deviceEl.dataset.layout !== mode) {
      deviceEl.dataset.layout = mode
      deviceEl.style.width = ''
    }
    const [minW, maxW] = LAYOUT_BOUNDS[mode]
    let width = Math.min(maxW, Math.max(minW, deviceEl.offsetWidth || minW))

    // nudge width so the device's aspect approaches the viewport's; height
    // responds sub-linearly to width (grids reflow), so sqrt-damp the step
    for (let i = 0; i < 4; i++) {
      deviceEl.style.width = `${Math.round(width)}px`
      const h = deviceEl.offsetHeight
      if (!h) break
      const ratio = va / (width / h)
      if (Math.abs(ratio - 1) < 0.03) break
      const next = Math.min(maxW, Math.max(minW, width * Math.sqrt(ratio)))
      if (Math.abs(next - width) < 4) break
      width = next
    }

    const w = deviceEl.offsetWidth
    const h = deviceEl.offsetHeight
    if (!w || !h) return
    const s = Math.min((vw * 0.985) / w, (vh * 0.985) / h)
    // the grid track is sized by the unscaled layout box, so center manually
    // on both axes: scale from the top-left, then shift the scaled box
    const offsetX = (vw - w * s) / 2 - deviceEl.offsetLeft
    const offsetY = (vh - h * s) / 2 - deviceEl.offsetTop
    deviceEl.style.transformOrigin = 'top left'
    deviceEl.style.transform = `translate(${offsetX.toFixed(1)}px, ${offsetY.toFixed(1)}px) scale(${s.toFixed(4)})`
  } finally {
    fitting = false
  }
}
window.addEventListener('resize', fitDevice)
window.addEventListener('orientationchange', fitDevice)
document.fonts?.ready.then(fitDevice).catch(() => {})
fitDevice()

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
