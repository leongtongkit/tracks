// Tracks DAW entry: arrangement view + transport + bottom editor panel.
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/ibm-plex-sans-condensed/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import { analyzeBuffer } from '../test/offline'
import { DawApp } from './daw-app'
import { defaultProject } from './project'
import { renderProject } from './render'
import { ArrangeView } from './ui/arrange'

const app = new DawApp()
const root = document.getElementById('app')!
const daw = document.createElement('div')
daw.className = 'daw'

const arrange = new ArrangeView(app)
daw.appendChild(arrange.el)

// bottom editor panel: piano roll / instrument land in the next phases
const bottom = document.createElement('div')
bottom.className = 'bottom-panel'
bottom.innerHTML = `<p class="bottom-hint">Select a clip to edit notes. Double-click an empty lane to create one.</p>`
daw.appendChild(bottom)

root.appendChild(daw)

// ---------- global keys ----------

window.addEventListener('keydown', e => {
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (e.code === 'Space') {
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
