import { Engine } from './engine/engine'
import { KeyboardInput } from './input/keyboard'
import { Store } from './state/store'
import { buildApp } from './ui/panels'
import { Piano } from './ui/piano'
import { PresetBrowser } from './ui/preset-browser'
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
presets.load(0)

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
