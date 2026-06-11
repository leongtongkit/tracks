import { Engine } from './engine/engine'
import { KeyboardInput } from './input/keyboard'
import { Store } from './state/store'
import { buildDebugUI } from './ui/debug'
import { installRenderTest } from './test/offline'

const store = new Store()
let engine: Engine | null = null
let keyboard: KeyboardInput | null = null

function startAudio(): Engine {
  if (!engine) {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    engine = new Engine(ctx, store)
    keyboard = new KeyboardInput({
      noteOn: n => {
        if (ctx.state !== 'running') ctx.resume().catch(() => {})
        engine!.noteOn(n)
      },
      noteOff: n => engine!.noteOff(n),
      allNotesOff: () => engine!.allNotesOff(),
      octaveChanged: o => {
        const el = document.getElementById('octave-readout')
        if (el) el.textContent = `octave: C${o} (Z/X to shift)`
      },
    })
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

function unlock(e: Event): void {
  document.getElementById('scrim')?.classList.add('hidden')
  document.removeEventListener('pointerdown', unlock, true)
  document.removeEventListener('keydown', unlock, true)
  startAudio()
  // If the unlocking gesture was a playable key, sound it immediately:
  // re-dispatch so KeyboardInput (registered inside startAudio) sees it.
  if (e instanceof KeyboardEvent && !e.repeat) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: e.code }))
  }
}

document.addEventListener('pointerdown', unlock, true)
document.addEventListener('keydown', unlock, true)

const app = document.getElementById('app')!
const help = document.createElement('p')
help.id = 'octave-readout'
help.textContent = 'octave: C4 (Z/X to shift) — play with A-row/W-row keys'
app.appendChild(help)
buildDebugUI(app, store)
installRenderTest()

export { store, keyboard }
