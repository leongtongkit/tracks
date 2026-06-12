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
