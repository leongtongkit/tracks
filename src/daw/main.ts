// Tracks DAW entry. P1: live shell so the domain is up; the studio lands next.
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/ibm-plex-sans-condensed/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

const app = document.getElementById('app')!

function unlock(): void {
  document.getElementById('scrim')?.classList.add('hidden')
  document.removeEventListener('pointerdown', unlock, true)
  document.removeEventListener('keydown', unlock, true)
}
document.addEventListener('pointerdown', unlock, true)
document.addEventListener('keydown', unlock, true)

const shell = document.createElement('div')
shell.className = 'daw-shell'
shell.innerHTML = `
  <h1>TRACKS</h1>
  <p>browser studio / under construction today</p>
  <p><a href="https://synth.jfound.net" style="color:inherit">the synth lives here meanwhile</a></p>
`
app.appendChild(shell)

// Verification harness: renders a small real project offline and returns
// measurable stats; driven from the browser test rig.
import { analyzeBuffer } from '../test/offline'
import { defaultProject } from './project'
import { renderProject } from './render'

declare global {
  interface Window {
    __tracksRenderTest: (over?: Record<string, unknown>) => Promise<unknown>
  }
}

window.__tracksRenderTest = async () => {
  const p = defaultProject()
  // a bar of bass + a pad chord, two tracks sounding together
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
